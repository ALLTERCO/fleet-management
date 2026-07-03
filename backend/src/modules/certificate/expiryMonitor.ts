// Cert expiry monitor: warns via Certificate.Expiring WS event, auto-renews
// fm-issued certs inside FM_CERT_RENEW_THRESHOLD_DAYS. Renewal runs in one
// transaction with insertCert → findTargets → insertJob → insertPushes →
// markSuperseded; the supersede is LAST so any prior failure rolls back and
// the old cert stays visible to the next tick.

import log4js from 'log4js';
import {envInt} from '../../config/envReader';
import * as EventDistributor from '../EventDistributor';
import * as Observability from '../Observability';
import * as store from '../PostgresProvider';
import {encryptStringSecret} from '../secretCrypto';
import {formatError} from '../util/formatError';
import {runBoundedParallel} from '../util/runBoundedParallel';
import {createLeaderPollWorker} from '../worker/leaderPollWorker';
import {
    certificateExpiryThresholdCrossed,
    certificateExpiryWarnDays,
    daysUntilCertificateExpiry
} from './expiryPolicy';
import {issueDeviceCert as fmCaIssue, isFmCaAvailable} from './fmCaSigner';
import {type ParsedCertMeta, parseCertificateChain} from './parser';

const LEADER_NAME = 'cert-expiry-monitor';
const logger = log4js.getLogger('cert-expiry');

function intervalMs(): number {
    return envInt('FM_CERT_EXPIRY_CRON_INTERVAL_MS', 3_600_000, 60_000);
}
function renewThresholdDays(): number {
    return envInt('FM_CERT_RENEW_THRESHOLD_DAYS', 14, 1);
}
function deviceCertValidityDays(): number {
    return envInt('FM_CERT_DEVICE_VALIDITY_DAYS', 365, 1);
}
function renewConcurrency(): number {
    return envInt('FM_CERT_RENEW_CONCURRENCY', 4, 1);
}

export interface ExpiringCert {
    id: string;
    tenant_id: string;
    name: string;
    kind: string;
    source: 'imported' | 'fm-issued';
    fingerprint_sha256: string;
    subject_cn: string | null;
    not_after: string | null;
}

async function selectExpiringCerts(maxDays: number): Promise<ExpiringCert[]> {
    return (await store.queryRows(
        `SELECT id::text, tenant_id::text, name, kind, source,
                fingerprint_sha256, subject_cn,
                to_char(not_after, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS not_after
           FROM organization.certificates
          WHERE not_after IS NOT NULL
            AND superseded_by IS NULL
            AND not_after <= now() + ($1 || ' days')::interval`,
        [maxDays]
    )) as unknown as ExpiringCert[];
}

function severityFor(threshold: number): 'critical' | 'warning' | 'info' {
    if (threshold <= 7) return 'critical';
    if (threshold <= 14) return 'warning';
    return 'info';
}

function emitWarnNotification(
    cert: ExpiringCert,
    threshold: number,
    daysLeft: number
): void {
    const severity = severityFor(threshold);
    EventDistributor.processAndNotifyAll(
        {
            method: 'Certificate.Expiring',
            params: {
                tenantId: cert.tenant_id,
                certificateId: cert.id,
                name: cert.name,
                fingerprint_sha256: cert.fingerprint_sha256,
                subject_cn: cert.subject_cn,
                source: cert.source,
                threshold,
                daysLeft,
                severity
            }
        },
        {organizationId: cert.tenant_id}
    );
    logger.warn(
        'cert "%s" (%s) expires in %d day(s) [threshold=%d severity=%s]',
        cert.name,
        cert.fingerprint_sha256,
        daysLeft,
        threshold,
        severity
    );
}

// ---------------------------------------------------------------------------
// Auto-renew dependency contract + building blocks.
// ---------------------------------------------------------------------------

export interface IssuedCert {
    pem: string;
    privateKeyPem: string;
}

export interface CertInsertInput {
    cert: ExpiringCert;
    issued: IssuedCert;
    meta: ParsedCertMeta;
    encryptedKey: string;
}

export interface DeviceTarget {
    device_id: string;
    slot: string;
}

export interface JobInsertInput {
    tenantId: string;
    newCertId: string;
    targets: DeviceTarget[];
    oldCertId: string;
}

export interface PushesInsertInput {
    jobId: string;
    tenantId: string;
    newCertId: string;
    targets: DeviceTarget[];
}

export interface RenewalTxOps {
    insertCert: (input: CertInsertInput) => Promise<string>;
    findTargets: (oldCertId: string) => Promise<DeviceTarget[]>;
    insertJob: (input: JobInsertInput) => Promise<string>;
    insertPushes: (input: PushesInsertInput) => Promise<void>;
    markSuperseded: (oldCertId: string, newCertId: string) => Promise<void>;
}

export interface AutoRenewDeps {
    isFmCaAvailable: () => boolean;
    issueDeviceCert: (input: {
        shellyId: string;
        organizationId: string;
        validityDays: number;
    }) => Promise<IssuedCert>;
    parseChain: (pem: string, opts: {privateKeyPem: string}) => ParsedCertMeta;
    encryptKey: (key: string, opts: {additionalData: string}) => string;
    validityDays: () => number;
    runRenewalWork: <T>(fn: (tx: RenewalTxOps) => Promise<T>) => Promise<T>;
    log: {
        skipNoFmCa: (certId: string) => void;
        skipNoSubject: (certId: string) => void;
        renewed: (oldCertId: string, newCertId: string, queued: number) => void;
        renewedNoTargets: (oldCertId: string, newCertId: string) => void;
    };
}

function certAad(tenantId: string, fingerprint: string): string {
    return `certificates:tenant:${tenantId}:fp:${fingerprint}`;
}

// Production wiring of the renewal tx — opens a multi-statement
// transaction via withQueryTransaction and exposes each write as a
// single-purpose method on RenewalTxOps.
async function runRenewalWorkReal<T>(
    fn: (tx: RenewalTxOps) => Promise<T>
): Promise<T> {
    return store.withQueryTransaction(async (client) => {
        const ops: RenewalTxOps = {
            insertCert: async ({cert, issued, meta, encryptedKey}) => {
                const rows = (await client.query(
                    `INSERT INTO organization.certificates
                         (tenant_id, name, kind, pem, private_key_encrypted,
                          fingerprint_sha256, subject_cn, issuer_cn, sans,
                          key_algo, chain_depth, basic_constraints_ca,
                          not_before, not_after,
                          slot_compat, device_compatible, incompat_reasons,
                          source, created_by)
                     VALUES ($1, $2, 'device', $3, $4,
                             $5, $6, $7, $8,
                             $9, $10, $11,
                             $12, $13,
                             $14, $15, $16,
                             'fm-issued', 'system:expiry-monitor')
                     ON CONFLICT (tenant_id, fingerprint_sha256)
                     DO UPDATE SET name = EXCLUDED.name
                  RETURNING id::text`,
                    [
                        cert.tenant_id,
                        `${cert.name} (renewed)`,
                        issued.pem,
                        encryptedKey,
                        meta.fingerprint_sha256,
                        meta.subject_cn,
                        meta.issuer_cn,
                        meta.sans,
                        meta.key_algo,
                        meta.chain_depth,
                        meta.basic_constraints_ca,
                        meta.not_before,
                        meta.not_after,
                        meta.slot_compat,
                        meta.device_compatible,
                        meta.incompat_reasons
                    ]
                )) as Array<{id: string}>;
                return rows[0].id;
            },
            findTargets: async (oldCertId) => {
                return (await client.query(
                    `SELECT DISTINCT ON (device_id, slot) device_id, slot
                       FROM organization.certificate_pushes
                      WHERE certificate_id = $1
                        AND status = 'applied'
                      ORDER BY device_id, slot, applied_at DESC`,
                    [oldCertId]
                )) as DeviceTarget[];
            },
            insertJob: async ({tenantId, newCertId, targets, oldCertId}) => {
                const rows = (await client.query(
                    `INSERT INTO organization.certificate_jobs
                         (tenant_id, certificate_id, slot, target_summary,
                          status, started_at, created_by)
                     VALUES ($1, $2, $3, $4::jsonb,
                             'queued', now(), 'system:expiry-monitor')
                  RETURNING id::text`,
                    [
                        tenantId,
                        newCertId,
                        targets[0].slot,
                        JSON.stringify({
                            deviceIds: targets.map((t) => t.device_id),
                            renewalOf: oldCertId
                        })
                    ]
                )) as Array<{id: string}>;
                return rows[0].id;
            },
            insertPushes: async ({jobId, tenantId, newCertId, targets}) => {
                const placeholders: string[] = [];
                const args: unknown[] = [jobId, newCertId, tenantId];
                for (let i = 0; i < targets.length; i++) {
                    placeholders.push(
                        `($1, $3, $2, $${4 + 2 * i}, $${5 + 2 * i}, 'queued')`
                    );
                    args.push(targets[i].device_id);
                    args.push(targets[i].slot);
                }
                await client.query(
                    `INSERT INTO organization.certificate_pushes
                         (job_id, tenant_id, certificate_id, device_id, slot, status)
                     VALUES ${placeholders.join(', ')}`,
                    args
                );
            },
            markSuperseded: async (oldCertId, newCertId) => {
                await client.query(
                    `UPDATE organization.certificates
                        SET superseded_by = $1
                      WHERE id = $2`,
                    [newCertId, oldCertId]
                );
            }
        };
        return fn(ops);
    });
}

export const defaultAutoRenewDeps: AutoRenewDeps = {
    isFmCaAvailable,
    issueDeviceCert: fmCaIssue,
    parseChain: parseCertificateChain,
    encryptKey: encryptStringSecret,
    validityDays: deviceCertValidityDays,
    runRenewalWork: runRenewalWorkReal,
    log: {
        skipNoFmCa: (certId) => {
            logger.warn(
                'auto-renew skipped for cert %s — FM CA not mounted',
                certId
            );
        },
        skipNoSubject: (certId) => {
            logger.warn(
                'auto-renew skipped for cert %s — missing subject CN',
                certId
            );
        },
        renewed: (oldCertId, newCertId, queued) => {
            logger.info(
                'auto-renewed fm-issued cert %s → %s and queued %d push rows',
                oldCertId,
                newCertId,
                queued
            );
        },
        renewedNoTargets: (oldCertId, newCertId) => {
            logger.info(
                'auto-renewed fm-issued cert %s → %s (no active push targets)',
                oldCertId,
                newCertId
            );
        }
    }
};

// ---------------------------------------------------------------------------
// Renewal orchestrator — the CR-45 fix.
// ---------------------------------------------------------------------------

export type RenewalResult =
    | {status: 'skipped'; reason: 'no_fm_ca' | 'no_subject_cn'}
    | {status: 'renewed_no_targets'; newCertId: string}
    | {status: 'renewed'; newCertId: string; queued: number};

export async function autoRenewFmIssued(
    cert: ExpiringCert,
    deps: AutoRenewDeps = defaultAutoRenewDeps
): Promise<RenewalResult> {
    if (!deps.isFmCaAvailable()) {
        deps.log.skipNoFmCa(cert.id);
        return {status: 'skipped', reason: 'no_fm_ca'};
    }
    if (!cert.subject_cn) {
        deps.log.skipNoSubject(cert.id);
        return {status: 'skipped', reason: 'no_subject_cn'};
    }

    // External side effect — outside the tx. If the tx rolls back the
    // issued bytes are discarded; the cert insert is idempotent via the
    // (tenant_id, fingerprint_sha256) unique constraint.
    const issued = await deps.issueDeviceCert({
        shellyId: cert.subject_cn,
        organizationId: cert.tenant_id,
        validityDays: deps.validityDays()
    });
    const meta = deps.parseChain(issued.pem, {
        privateKeyPem: issued.privateKeyPem
    });
    const encryptedKey = deps.encryptKey(issued.privateKeyPem, {
        additionalData: certAad(cert.tenant_id, meta.fingerprint_sha256)
    });

    return deps.runRenewalWork(async (tx) => {
        const newCertId = await tx.insertCert({
            cert,
            issued,
            meta,
            encryptedKey
        });
        const targets = await tx.findTargets(cert.id);
        if (targets.length === 0) {
            await tx.markSuperseded(cert.id, newCertId);
            deps.log.renewedNoTargets(cert.id, newCertId);
            return {status: 'renewed_no_targets', newCertId};
        }
        const jobId = await tx.insertJob({
            tenantId: cert.tenant_id,
            newCertId,
            targets,
            oldCertId: cert.id
        });
        await tx.insertPushes({
            jobId,
            tenantId: cert.tenant_id,
            newCertId,
            targets
        });
        // CR-45 invariant: supersede LAST. Any failure above this line
        // rolls the whole tx back and the old cert stays visible to
        // the next expiry tick.
        await tx.markSuperseded(cert.id, newCertId);
        deps.log.renewed(cert.id, newCertId, targets.length);
        return {status: 'renewed', newCertId, queued: targets.length};
    });
}

// ---------------------------------------------------------------------------
// Tick loop + lifecycle.
// ---------------------------------------------------------------------------

async function runExpiryTick(): Promise<void> {
    const thresholds = certificateExpiryWarnDays();
    if (thresholds.length === 0) return;
    const maxThreshold = thresholds[0];
    const renewWindow = renewThresholdDays();
    const horizonDays = Math.max(maxThreshold, renewWindow);

    const certs = await selectExpiringCerts(horizonDays);
    const dueRenewals: ExpiringCert[] = [];
    for (const cert of certs) {
        const daysLeft = daysUntilCertificateExpiry(cert.not_after);
        if (daysLeft === null) continue;
        const crossed = certificateExpiryThresholdCrossed(daysLeft, thresholds);
        if (crossed !== null) {
            emitWarnNotification(cert, crossed, daysLeft);
        }
        if (cert.source === 'fm-issued' && daysLeft <= renewWindow) {
            dueRenewals.push(cert);
        }
    }
    if (dueRenewals.length === 0) return;
    // One hung renewal must not pin the tick.
    const RENEWAL_TIMEOUT_MS = 60_000;
    await runBoundedParallel({
        tasks: dueRenewals,
        run: (cert) => safeAutoRenew(cert),
        concurrency: renewConcurrency(),
        perTaskTimeoutMs: RENEWAL_TIMEOUT_MS,
        label: 'cert-auto-renew'
    });
}

async function safeAutoRenew(cert: ExpiringCert): Promise<void> {
    try {
        await autoRenewFmIssued(cert);
    } catch (err) {
        Observability.incrementCounter('cert_auto_renew_failures');
        logger.error(
            'auto-renew failed for cert %s: %s',
            cert.id,
            formatError(err)
        );
    }
}

const worker = createLeaderPollWorker({
    leaderName: LEADER_NAME,
    logger,
    pollIntervalMs: intervalMs,
    tick: runExpiryTick
});

export const start = worker.start;
export const stop = worker.stop;

export async function __tickForTests(): Promise<void> {
    await worker.tickOnce();
}
