// X.509 parser. Returns the metadata bag the cert store persists.
// Reject inputs the Shelly TLS stack can't handle (encrypted keys,
// Ed25519, PFX); warn on chain-includes-root.

import {createPrivateKey, createPublicKey, X509Certificate} from 'node:crypto';
import forge from 'node-forge';
import RpcError from '../../rpc/RpcError';
import type {
    CertificateKeyAlgo,
    CertificateSlot
} from '../../types/api/certificate';

export interface CertificateExtendedMeta {
    // Algorithm name from the X.509 signature OID (e.g.
    // 'sha256WithRSAEncryption', 'ecdsa-with-SHA384'). Useful for the
    // UI to surface "this is a SHA-1 cert" warnings.
    signature_algorithm: string | null;
    // RSA modulus length OR EC curve name ('P-256', 'P-384'…).
    key_bits: number | null;
    key_curve: string | null;
    serial_number: string;
    subject_o: string | null;
    subject_ou: string | null;
    issuer_o: string | null;
    issuer_ou: string | null;
    san_dns: string[];
    san_ip: string[];
    key_usage: string[];
    extended_key_usage: string[];
    // True if the upload included a root CA in the chain (against the
    // Shelly KB recommendation — chain should be leaf + intermediates
    // only). Not fatal; surfaced as an advisory in incompat_reasons.
    chain_includes_root: boolean;
}

export interface ParsedCertMeta {
    fingerprint_sha256: string;
    subject_cn: string | null;
    issuer_cn: string | null;
    sans: string[];
    key_algo: CertificateKeyAlgo;
    chain_depth: number;
    basic_constraints_ca: boolean;
    not_before: Date;
    not_after: Date;
    self_signed: boolean;
    slot_compat: CertificateSlot[];
    device_compatible: boolean;
    incompat_reasons: string[];
    metadata: CertificateExtendedMeta;
}

const PEM_CERT_RE =
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const PEM_KEY_RE =
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/;
const PEM_ENCRYPTED_KEY_RE = /-----BEGIN ENCRYPTED PRIVATE KEY-----/;
const PEM_ED25519_KEY_RE = /-----BEGIN ED25519 PRIVATE KEY-----/i;
// PFX/PKCS#12 starts with the SEQUENCE+OID for pkcs12 — these bytes
// are unmistakable, the KB explicitly rejects them, surface a clear
// error so the operator knows to convert via openssl pkcs12 -in ...
const PFX_MAGIC_HEX = '3082';
// Max certs in an uploaded chain (leaf + intermediates).
const MAX_CHAIN_DEPTH = 8;

function looksLikePfx(input: string | Buffer): boolean {
    if (typeof input === 'string') {
        if (input.includes('-----BEGIN')) return false;
        const head = input.trim().slice(0, 16);
        // Base64 of a DER-encoded PFX starts with 'MII…' — same bytes.
        return /^MII[A-Za-z0-9+/]/.test(head);
    }
    const head = input.subarray(0, 4).toString('hex');
    return head.startsWith(PFX_MAGIC_HEX);
}

// Slot rules: a CA cert occupies root_ca + server_ca; a leaf occupies client/server cert.
function deriveSlotCompat(
    cert: X509Certificate,
    keyAlgo: CertificateKeyAlgo,
    selfSigned: boolean
): {slots: CertificateSlot[]; reasons: string[]} {
    const slots: CertificateSlot[] = [];
    const reasons: string[] = [];
    const isCa = cert.ca === true;
    const subjectCn = extractCn(cert.subject);

    if (keyAlgo === 'ecdsa-p521') {
        reasons.push('ecdsa-p521 not supported by Shelly TLS stack');
    }

    if (isCa) {
        slots.push('root_ca', 'server_ca');
    } else {
        if (subjectCn) {
            slots.push('client_cert', 'server_cert');
        } else {
            reasons.push(
                'leaf cert has no subject CN — required for client/server slots'
            );
        }
    }
    if (selfSigned && !isCa) {
        reasons.push('self-signed leaf — devices typically reject');
    }
    return {slots, reasons};
}

function extractCn(dn: string): string | null {
    return extractDnField(dn, 'CN');
}

// Ingress trust boundary: CN binds the device id, O is the owning org, isCa
// flags a CA cert that must never be accepted as a device leaf. Null on error.
export function extractLeafSubject(pem: string): {
    commonName: string | null;
    organization: string | null;
    isCa: boolean;
} | null {
    try {
        const cert = new X509Certificate(pem);
        return {
            commonName: extractCn(cert.subject),
            organization: extractDnField(cert.subject, 'O'),
            isCa: cert.ca
        };
    } catch {
        return null;
    }
}

function extractDnField(dn: string, field: string): string | null {
    // X509Certificate.subject/issuer formats one component per line:
    //   CN=foo\nO=bar\nOU=baz
    // We accept both newline and comma separators (older Node prints
    // comma-separated) to stay robust across Node versions.
    // Escaped commas (\,) stay part of the value, e.g. O=Foo\, Inc.
    const re = new RegExp(`(?:^|[,\\n])${field}=((?:\\\\,|[^,\\n])+)`);
    const m = dn.match(re);
    return m ? m[1].replace(/\\,/g, ',').trim() : null;
}

function deriveKeyAlgo(cert: X509Certificate): CertificateKeyAlgo | null {
    // X509Certificate.publicKey is already a KeyObject — using it directly.
    const pub = cert.publicKey;
    const details = pub.asymmetricKeyDetails;
    if (pub.asymmetricKeyType === 'rsa') {
        const bits = details?.modulusLength;
        if (bits === 2048) return 'rsa-2048';
        if (bits === 3072) return 'rsa-3072';
        if (bits === 4096) return 'rsa-4096';
        return null;
    }
    if (pub.asymmetricKeyType === 'ec') {
        const curve = details?.namedCurve;
        if (curve === 'prime256v1' || curve === 'P-256') return 'ecdsa-p256';
        if (curve === 'secp384r1' || curve === 'P-384') return 'ecdsa-p384';
        if (curve === 'secp521r1' || curve === 'P-521') return 'ecdsa-p521';
        return null;
    }
    return null;
}

// Per Shelly TLS KB: Ed25519 explicitly unsupported. Returning a
// dedicated error makes the operator-facing fix actionable ("regen
// the key as ECDSA P-256") instead of a generic "unsupported".
function isEd25519(cert: X509Certificate): boolean {
    return cert.publicKey.asymmetricKeyType === 'ed25519';
}

function extractSansSplit(cert: X509Certificate): {
    combined: string[];
    dns: string[];
    ip: string[];
} {
    const raw = cert.subjectAltName;
    if (!raw) return {combined: [], dns: [], ip: []};
    const dns: string[] = [];
    const ip: string[] = [];
    const combined: string[] = [];
    for (const entry of raw.split(',')) {
        const trimmed = entry.trim();
        if (!trimmed) continue;
        combined.push(trimmed.replace(/^DNS:|^IP Address:/, ''));
        if (trimmed.startsWith('DNS:')) {
            dns.push(trimmed.slice(4));
        } else if (trimmed.startsWith('IP Address:')) {
            ip.push(trimmed.slice('IP Address:'.length));
        }
    }
    return {combined, dns, ip};
}

function extractKeyMeta(cert: X509Certificate): {
    bits: number | null;
    curve: string | null;
} {
    const pub = cert.publicKey;
    const details = pub.asymmetricKeyDetails;
    if (pub.asymmetricKeyType === 'rsa') {
        return {bits: details?.modulusLength ?? null, curve: null};
    }
    if (pub.asymmetricKeyType === 'ec') {
        const raw = details?.namedCurve ?? null;
        const friendly =
            raw === 'prime256v1'
                ? 'P-256'
                : raw === 'secp384r1'
                  ? 'P-384'
                  : raw === 'secp521r1'
                    ? 'P-521'
                    : raw;
        return {bits: null, curve: friendly};
    }
    return {bits: null, curve: null};
}

// cert.keyUsage is a documented public field; undefined when absent.
function extractKeyUsage(cert: X509Certificate): string[] {
    return cert.keyUsage ? [...cert.keyUsage] : [];
}

// node-forge reads sigOid + extKeyUsage that Node's X509Certificate
// omits. Failures here are non-fatal — return nulls/[] so the rest
// of the metadata still ships.
function readForgeMeta(pemBlock: string): {
    signatureAlgorithm: string | null;
    extendedKeyUsage: string[];
} {
    try {
        const cert = forge.pki.certificateFromPem(pemBlock);
        return {
            signatureAlgorithm: forgeSignatureAlgorithm(cert),
            extendedKeyUsage: forgeExtendedKeyUsage(cert)
        };
    } catch {
        return {signatureAlgorithm: null, extendedKeyUsage: []};
    }
}

// OID → friendly name via forge.pki.oids; falls back to the raw OID
// if not mapped.
function forgeSignatureAlgorithm(cert: forge.pki.Certificate): string | null {
    const oid = cert.signatureOid;
    if (!oid) return null;
    const oidMap = forge.pki.oids as Record<string, string>;
    return oidMap[oid] ?? oid;
}

// extKeyUsage flags forge exposes on the extension object — pick the
// ones set to true.
function forgeExtendedKeyUsage(cert: forge.pki.Certificate): string[] {
    const ext = cert.getExtension('extKeyUsage') as
        | Record<string, boolean | unknown>
        | undefined;
    if (!ext) return [];
    const candidates: Array<keyof typeof EKU_LABELS> = [
        'serverAuth',
        'clientAuth',
        'codeSigning',
        'emailProtection',
        'timeStamping',
        'OCSPSigning'
    ];
    return candidates
        .filter((name) => ext[name] === true)
        .map((name) => EKU_LABELS[name]);
}

const EKU_LABELS = {
    serverAuth: 'serverAuth',
    clientAuth: 'clientAuth',
    codeSigning: 'codeSigning',
    emailProtection: 'emailProtection',
    timeStamping: 'timeStamping',
    OCSPSigning: 'OCSPSigning'
} as const;

function extractExtendedMeta(
    cert: X509Certificate,
    leafPem: string,
    chainIncludesRoot: boolean
): CertificateExtendedMeta {
    const key = extractKeyMeta(cert);
    const sans = extractSansSplit(cert);
    const forgeMeta = readForgeMeta(leafPem);
    return {
        signature_algorithm: forgeMeta.signatureAlgorithm,
        key_bits: key.bits,
        key_curve: key.curve,
        serial_number: cert.serialNumber,
        subject_o: extractDnField(cert.subject, 'O'),
        subject_ou: extractDnField(cert.subject, 'OU'),
        issuer_o: extractDnField(cert.issuer, 'O'),
        issuer_ou: extractDnField(cert.issuer, 'OU'),
        san_dns: sans.dns,
        san_ip: sans.ip,
        key_usage: extractKeyUsage(cert),
        extended_key_usage: forgeMeta.extendedKeyUsage,
        chain_includes_root: chainIncludesRoot
    };
}

function detectChainIncludesRoot(certs: X509Certificate[]): boolean {
    // Root = self-signed certificate marked as CA. Any cert beyond
    // the leaf whose subject === issuer AND ca === true counts.
    return certs.slice(1).some((c) => c.subject === c.issuer && c.ca === true);
}

export interface ParseChainOptions {
    // When provided, key compatibility is checked against the PEM.
    privateKeyPem?: string;
}

export function parseCertificateChain(
    pem: string,
    opts: ParseChainOptions = {}
): ParsedCertMeta {
    rejectUnsupportedContainer(pem);
    const blocks = pem.match(PEM_CERT_RE);
    if (!blocks || blocks.length === 0) {
        throw RpcError.InvalidParams(
            'pem contains no -----BEGIN CERTIFICATE----- block — accepted containers: PEM (.pem/.crt/.cer). Convert DER via `openssl x509 -in cert.der -inform der -out cert.pem`'
        );
    }
    if (PEM_ENCRYPTED_KEY_RE.test(pem)) {
        throw RpcError.InvalidParams(
            'encrypted private keys are not supported — extract to unencrypted PEM first (Shelly TLS KB)'
        );
    }
    // Cap before parsing so CA-marked leaves are bounded too.
    if (blocks.length > MAX_CHAIN_DEPTH) {
        throw RpcError.InvalidParams(
            `chain depth ${blocks.length} exceeds maximum ${MAX_CHAIN_DEPTH}`
        );
    }
    const certs = blocks.map((b) => new X509Certificate(b));
    const leaf = certs[0];

    if (isEd25519(leaf)) {
        throw RpcError.InvalidParams(
            'Ed25519 keys are not supported by the Shelly TLS stack — re-issue with RSA-2048 or ECDSA P-256/P-384'
        );
    }

    const subjectCn = extractCn(leaf.subject);
    const issuerCn = extractCn(leaf.issuer);
    const selfSigned = leaf.subject === leaf.issuer;
    const keyAlgo = deriveKeyAlgo(leaf);
    if (!keyAlgo) {
        throw RpcError.InvalidParams(
            'unsupported key algorithm — accepted: rsa-2048/3072/4096, ecdsa-p256/p384'
        );
    }

    if (opts.privateKeyPem) {
        validatePrivateKeyMatch(opts.privateKeyPem, leaf);
    }

    const isCa = leaf.ca === true;
    const chainIncludesRoot = detectChainIncludesRoot(certs);
    const {slots, reasons} = deriveSlotCompat(leaf, keyAlgo, selfSigned);
    if (chainIncludesRoot) {
        reasons.push(
            'chain includes the root CA — per Shelly KB, presented chain should be leaf + intermediates only'
        );
    }

    // blocks[0] is the leaf PEM; node-forge reads sigOid + EKU from
    // it without us re-parsing the chain.
    const extendedMeta = extractExtendedMeta(
        leaf,
        blocks[0],
        chainIncludesRoot
    );

    return {
        fingerprint_sha256: leaf.fingerprint256.replace(/:/g, '').toUpperCase(),
        subject_cn: subjectCn,
        issuer_cn: issuerCn,
        sans: extractSansSplit(leaf).combined,
        key_algo: keyAlgo,
        chain_depth: certs.length,
        basic_constraints_ca: isCa,
        not_before: new Date(leaf.validFrom),
        not_after: new Date(leaf.validTo),
        self_signed: selfSigned,
        slot_compat: slots,
        // Chain-includes-root is advisory, not fatal — keep device_compatible
        // honest by treating it as a warning that doesn't toggle the flag.
        device_compatible: reasons.every((r) =>
            r.startsWith('chain includes the root CA')
        ),
        incompat_reasons: reasons,
        metadata: extendedMeta
    };
}

function rejectUnsupportedContainer(pem: string): void {
    if (looksLikePfx(pem)) {
        throw RpcError.InvalidParams(
            'PKCS#12/PFX uploads are not supported — extract to PEM via `openssl pkcs12 -in bundle.p12 -nodes -out cert.pem` and upload that'
        );
    }
    if (PEM_ED25519_KEY_RE.test(pem)) {
        throw RpcError.InvalidParams(
            'Ed25519 private keys are not supported by the Shelly TLS stack — re-issue with RSA-2048 or ECDSA P-256/P-384'
        );
    }
}

function validatePrivateKeyMatch(
    privateKeyPem: string,
    leaf: X509Certificate
): void {
    if (!PEM_KEY_RE.test(privateKeyPem)) {
        throw RpcError.InvalidParams(
            'privateKeyPem must contain a PRIVATE KEY block'
        );
    }
    if (PEM_ENCRYPTED_KEY_RE.test(privateKeyPem)) {
        throw RpcError.InvalidParams(
            'encrypted private keys are not supported — extract to unencrypted PEM first'
        );
    }
    if (PEM_ED25519_KEY_RE.test(privateKeyPem)) {
        throw RpcError.InvalidParams(
            'Ed25519 private keys are not supported by the Shelly TLS stack — re-issue with RSA-2048 or ECDSA P-256/P-384'
        );
    }
    try {
        const k = createPrivateKey(privateKeyPem);
        const pubFromKey = createPublicKey(k);
        const a = pubFromKey.export({type: 'spki', format: 'der'});
        const b = leaf.publicKey.export({type: 'spki', format: 'der'});
        if (!Buffer.from(a).equals(Buffer.from(b))) {
            throw RpcError.InvalidParams(
                'private key does not match certificate public key'
            );
        }
    } catch (err) {
        if (err instanceof RpcError) throw err;
        throw RpcError.InvalidParams(
            `private key load failed: ${(err as Error).message}`
        );
    }
}
