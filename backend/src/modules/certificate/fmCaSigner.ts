// FM-CA signer. Issues device leaf certs from FM_LOCAL_CA_DIR (default /app/state/tls).

import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {envInt, envStr} from '../../config/envReader';
import RpcError from '../../rpc/RpcError';
import {createAsyncLimit} from '../util/asyncLimit';

const execFileAsync = promisify(execFile);
const limit = createAsyncLimit(envInt('FM_CERT_ISSUE_CONCURRENCY', 2, 1));

// SIGTERM hung openssl subprocesses instead of holding the limit slot.
const OPENSSL_TIMEOUT_MS = envInt('FM_CERT_OPENSSL_TIMEOUT_MS', 10_000, 1_000);
const OPENSSL_EXEC_OPTIONS = {timeout: OPENSSL_TIMEOUT_MS} as const;

interface IssueOptions {
    shellyId: string;
    // Always stamped as O=<org> so ingress can trust the subject's owning org.
    organizationId: string;
    validityDays?: number;
}

export interface IssuedCert {
    pem: string;
    privateKeyPem: string;
    serial: string;
    notBefore: Date;
    notAfter: Date;
}

export class FmCaUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FmCaUnavailableError';
    }
}

function caDir(): string {
    return envStr('FM_LOCAL_CA_DIR', '/app/state/tls');
}

function caPaths(): {crt: string; key: string} {
    const dir = caDir();
    return {crt: join(dir, 'ca.crt'), key: join(dir, 'ca.key')};
}

export function isFmCaAvailable(): boolean {
    const {crt, key} = caPaths();
    return existsSync(crt) && existsSync(key);
}

export function readFmCaCertificatePem(): string {
    const {crt} = caPaths();
    if (!existsSync(crt)) {
        throw new FmCaUnavailableError(
            `FM CA certificate not mounted at ${caDir()}`
        );
    }
    return readFileSync(crt, 'utf8');
}

// Reject truncated input before openssl so noise can't read as "chains".
const CERT_PEM_ENVELOPE =
    /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/;

// Layer 2: true when a leaf cert verifies against the FM CA. Fail-closed — a
// missing CA, malformed PEM, or any openssl error is a clean "no", never a throw.
export function certificateChainsToFmCa(leafPem: string): Promise<boolean> {
    return limit(() => certificateChainsToFmCaImpl(leafPem));
}

async function certificateChainsToFmCaImpl(leafPem: string): Promise<boolean> {
    if (!isFmCaAvailable() || !CERT_PEM_ENVELOPE.test(leafPem)) return false;
    const work = mkdtempSync(join(tmpdir(), 'fm-verify-'));
    try {
        const leafPath = join(work, 'leaf.crt');
        writeFileSync(leafPath, leafPem, 'utf8');
        const {crt: caCrt} = caPaths();
        const {stdout} = await execFileAsync(
            'openssl',
            ['verify', '-purpose', 'sslclient', '-CAfile', caCrt, leafPath],
            OPENSSL_EXEC_OPTIONS
        );
        // Match the exact path we wrote, not a loose /: OK/. openssl echoes the
        // cert's attacker-controlled subject, so a subject like `O=x: OK` would
        // forge a bare /: OK/ pass; the random temp path cannot be forged. On
        // success openssl prints exactly "<path>: OK".
        return stdout.trim() === `${leafPath}: OK`;
    } catch {
        return false;
    } finally {
        rmSync(work, {recursive: true, force: true});
    }
}

function defaultValidityDays(): number {
    return envInt('FM_CERT_DEVICE_VALIDITY_DAYS', 365, 1);
}
function maxValidityDays(): number {
    return envInt('FM_CERT_DEVICE_MAX_VALIDITY_DAYS', 3650, 1);
}

export function issueDeviceCert(opts: IssueOptions): Promise<IssuedCert> {
    return limit(() => issueDeviceCertImpl(opts));
}

async function issueDeviceCertImpl(opts: IssueOptions): Promise<IssuedCert> {
    if (!isFmCaAvailable()) {
        throw new FmCaUnavailableError(
            `FM CA not mounted at ${caDir()} — verify the deploy/state/tls volume mount`
        );
    }
    const {shellyId, organizationId} = opts;
    assertOpensslSafeName(shellyId, 'shellyId');
    assertOpensslSafeName(organizationId, 'organizationId');
    const validityDays = opts.validityDays ?? defaultValidityDays();
    const max = maxValidityDays();
    if (validityDays < 1 || validityDays > max) {
        throw RpcError.InvalidParams(`validityDays out of range (1..${max})`);
    }

    const work = mkdtempSync(join(tmpdir(), 'fm-issue-'));
    try {
        const keyPath = join(work, 'leaf.key');
        const csrPath = join(work, 'leaf.csr');
        const certPath = join(work, 'leaf.crt');

        // EC P-256 — Shelly Gen2+ accepts ecdsa-p256.
        await execFileAsync(
            'openssl',
            [
                'ecparam',
                '-name',
                'prime256v1',
                '-genkey',
                '-noout',
                '-out',
                keyPath
            ],
            OPENSSL_EXEC_OPTIONS
        );

        await execFileAsync(
            'openssl',
            [
                'req',
                '-new',
                '-key',
                keyPath,
                '-subj',
                `/CN=${shellyId}/O=${organizationId}`,
                '-out',
                csrPath
            ],
            OPENSSL_EXEC_OPTIONS
        );

        const serial = `0x${randomBytes(8).toString('hex')}`;
        const {crt: caCrt, key: caKey} = caPaths();
        await execFileAsync(
            'openssl',
            [
                'x509',
                '-req',
                '-in',
                csrPath,
                '-CA',
                caCrt,
                '-CAkey',
                caKey,
                '-set_serial',
                serial,
                '-days',
                String(validityDays),
                '-sha256',
                '-out',
                certPath
            ],
            OPENSSL_EXEC_OPTIONS
        );

        // PKCS#8 unencrypted — device tooling rejects SEC1 + encrypted keys.
        const pk8Path = join(work, 'leaf.pk8.pem');
        await execFileAsync(
            'openssl',
            ['pkcs8', '-topk8', '-nocrypt', '-in', keyPath, '-out', pk8Path],
            OPENSSL_EXEC_OPTIONS
        );

        const pem = readFileSync(certPath, 'utf8');
        const privateKeyPem = readFileSync(pk8Path, 'utf8');
        const notBefore = new Date();
        const notAfter = new Date(
            notBefore.getTime() + validityDays * 86_400_000
        );
        return {pem, privateKeyPem, serial, notBefore, notAfter};
    } finally {
        rmSync(work, {recursive: true, force: true});
    }
}

export interface SignCsrOptions {
    csrPem: string;
    // FM stamps O=<organizationId> into the signed subject, ignoring whatever
    // the device put in its CSR — the CA is authoritative on the subject.
    organizationId: string;
    validityDays?: number;
}

export interface SignedCsr {
    pem: string;
    serial: string;
    notBefore: Date;
    notAfter: Date;
    subjectCn: string;
}

// Operator keeps the private key on the CSR-generating device; FM only sees the public key.
export function signCsr(opts: SignCsrOptions): Promise<SignedCsr> {
    return limit(async () => {
        const {csrPem, subjectCn} = await extractCsrSubjectCnImpl(opts.csrPem);
        return signValidatedCsrImpl({
            csrPem,
            subjectCn,
            organizationId: opts.organizationId,
            validityDays: opts.validityDays
        });
    });
}

// RPC layer needs the CN before authz so it can reject foreign-CN requests without burning FM-CA bytes.
export function extractCsrSubjectCn(csrPem: string): Promise<string> {
    return limit(async () => {
        const result = await extractCsrSubjectCnImpl(csrPem);
        return result.subjectCn;
    });
}

export interface SignValidatedCsrOptions {
    csrPem: string;
    subjectCn: string;
    organizationId: string;
    validityDays?: number;
}

// Skips re-validation so one RPC runs the openssl verify pipeline exactly once — caller MUST have used extractCsrSubjectCn first.
export function signValidatedCsr(
    opts: SignValidatedCsrOptions
): Promise<SignedCsr> {
    return limit(() => signValidatedCsrImpl(opts));
}

async function extractCsrSubjectCnImpl(
    csrPem: string
): Promise<{csrPem: string; subjectCn: string}> {
    assertCsrPemEnvelope(csrPem);
    const work = mkdtempSync(join(tmpdir(), 'fm-csr-subject-'));
    try {
        const csrPath = join(work, 'in.csr');
        writeFileSync(csrPath, csrPem, 'utf8');
        const subjectCn = await validateAndExtractCsrSubject(csrPath);
        assertOpensslSafeName(subjectCn, 'CSR subject CN');
        return {csrPem, subjectCn};
    } finally {
        rmSync(work, {recursive: true, force: true});
    }
}

async function signValidatedCsrImpl(
    opts: SignValidatedCsrOptions
): Promise<SignedCsr> {
    if (!isFmCaAvailable()) {
        throw new FmCaUnavailableError(
            `FM CA not mounted at ${caDir()} — verify the deploy/state/tls volume mount`
        );
    }
    assertOpensslSafeName(opts.subjectCn, 'CSR subject CN');
    assertOpensslSafeName(opts.organizationId, 'organizationId');
    const validityDays = resolveValidityDays(opts.validityDays);

    const work = mkdtempSync(join(tmpdir(), 'fm-sign-csr-'));
    try {
        const csrPath = join(work, 'in.csr');
        writeFileSync(csrPath, opts.csrPem, 'utf8');
        const extPath = writeCsrSignExtensions(work, opts.subjectCn);
        const serial = `0x${randomBytes(8).toString('hex')}`;
        const certPath = await runX509Sign({
            csrPath,
            extPath,
            serial,
            validityDays,
            outDir: work,
            subject: `/CN=${opts.subjectCn}/O=${opts.organizationId}`
        });
        const pem = readFileSync(certPath, 'utf8');
        const notBefore = new Date();
        const notAfter = new Date(
            notBefore.getTime() + validityDays * 86_400_000
        );
        return {pem, serial, notBefore, notAfter, subjectCn: opts.subjectCn};
    } finally {
        rmSync(work, {recursive: true, force: true});
    }
}

function resolveValidityDays(requested: number | undefined): number {
    const days = requested ?? defaultValidityDays();
    const max = maxValidityDays();
    if (days < 1 || days > max) {
        throw RpcError.InvalidParams(`validityDays out of range (1..${max})`);
    }
    return days;
}

// Reject truncated PEM so openssl errors don't leak as "CSR validation failed".
const CSR_PEM_ENVELOPE =
    /-----BEGIN CERTIFICATE REQUEST-----[\s\S]+-----END CERTIFICATE REQUEST-----/;

function assertCsrPemEnvelope(pem: string): void {
    if (!CSR_PEM_ENVELOPE.test(pem)) {
        throw RpcError.InvalidParams(
            'CSR parse failed: PEM envelope must include both BEGIN and END CERTIFICATE REQUEST markers'
        );
    }
}

// A '/', '=', or newline in any value we interpolate into an openssl -subj
// or ext file would inject DN components or directives. One charset for every
// such name (shellyId, CN, org).
const OPENSSL_SAFE_NAME = /^[A-Za-z0-9_-]+$/;

function assertOpensslSafeName(value: string, label: string): void {
    // typeof guard first: regex.test(undefined) coerces to "undefined" and
    // would pass, silently stamping O=undefined. Fail loud instead.
    if (typeof value !== 'string' || !OPENSSL_SAFE_NAME.test(value)) {
        throw RpcError.InvalidParams(
            `${label} must match [A-Za-z0-9_-]+ — refusing to interpolate into openssl args`
        );
    }
}

// Without an extfile openssl x509 -req emits a v1 cert (no EKU/SAN/BC) — pin clientAuth + CA:FALSE so leaves are mTLS-only.
// clientAuth + digitalSignature are load-bearing: certificateChainsToFmCa
// verifies with `-purpose sslclient`, which rejects a leaf lacking them.
function writeCsrSignExtensions(work: string, subjectCn: string): string {
    const extPath = join(work, 'leaf.ext');
    const body =
        '[v3_req]\n' +
        'extendedKeyUsage = clientAuth\n' +
        'keyUsage = critical, digitalSignature, keyEncipherment\n' +
        'basicConstraints = critical, CA:FALSE\n' +
        `subjectAltName = DNS:${subjectCn}\n`;
    writeFileSync(extPath, body, 'utf8');
    return extPath;
}

interface X509SignArgs {
    csrPath: string;
    extPath: string;
    serial: string;
    validityDays: number;
    outDir: string;
    // FM-controlled DN; overrides the CSR subject so O always binds the org.
    subject: string;
}

async function runX509Sign(args: X509SignArgs): Promise<string> {
    const certPath = join(args.outDir, 'leaf.crt');
    const {crt: caCrt, key: caKey} = caPaths();
    await execFileAsync(
        'openssl',
        [
            'x509',
            '-req',
            '-in',
            args.csrPath,
            '-CA',
            caCrt,
            '-CAkey',
            caKey,
            // -subj (not the newer -set_subject alias) so OpenSSL 3.0.x on CI
            // runners accepts it too.
            '-subj',
            args.subject,
            '-set_serial',
            args.serial,
            '-days',
            String(args.validityDays),
            '-sha256',
            '-extfile',
            args.extPath,
            '-extensions',
            'v3_req',
            '-out',
            certPath
        ],
        OPENSSL_EXEC_OPTIONS
    );
    return certPath;
}

// openssl is the validator. Shelly's TLS doc steers customers toward
// ECDSA P-256/P-384/P-521 (P-256 recommended); node-forge would
// reject those at parse with "OID is not RSA". openssl handles RSA +
// all EC curves the device accepts.
async function validateAndExtractCsrSubject(csrPath: string): Promise<string> {
    // openssl writes "verify OK" to stdout and per-error notes to stderr.
    let verifyOutput: string;
    try {
        const r = await execFileAsync(
            'openssl',
            ['req', '-in', csrPath, '-noout', '-verify'],
            OPENSSL_EXEC_OPTIONS
        );
        verifyOutput = `${r.stdout}\n${r.stderr}`;
    } catch (err) {
        const stderr =
            (err as {stderr?: string}).stderr ?? (err as Error).message;
        throw RpcError.InvalidParams(
            `CSR validation failed: ${stderr.toString().trim()}`
        );
    }
    if (!/verify OK/i.test(verifyOutput)) {
        throw RpcError.InvalidParams(
            'CSR signature does not match its public key'
        );
    }

    const {stdout: subjectOut} = await execFileAsync(
        'openssl',
        ['req', '-in', csrPath, '-noout', '-subject', '-nameopt', 'RFC2253'],
        OPENSSL_EXEC_OPTIONS
    );
    // RFC2253: "subject=CN=shellyplus1pm-aabbccddeeff,O=Shelly"
    const m = subjectOut.match(/CN=([^,\n]+)/);
    const cn = m?.[1]?.trim();
    if (!cn) {
        throw RpcError.InvalidParams('CSR subject must include a CN');
    }
    return cn;
}
