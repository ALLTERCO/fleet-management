// Cert push worker. Per-(device, slot) lock, chunked Put*, data:null rollback.
// Restart-resume reclaims in_progress rows older than FM_CERT_PUSH_TIMEOUT_MS.

import log4js from 'log4js';
import {envInt} from '../../config/envReader';
import {tuning} from '../../config/tuning';
import type {
    CertificateJobResponse,
    CertificateSlot
} from '../../types/api/certificate';
import type {OperationJobSnapshot} from '../../types/api/job';
import * as DeviceCollector from '../DeviceCollector';
import {
    finishJob,
    markCertificateUnit,
    markJobRunning
} from '../jobs/repository';
import {LOGICAL_DEVICE_LOCK_NAMESPACE} from '../jobs/repositoryFactory';
import * as store from '../PostgresProvider';
import {decryptStringSecret} from '../secretCrypto';
import {formatError} from '../util/formatError';
import {runBoundedParallel} from '../util/runBoundedParallel';
import {createLeaderPollWorker} from '../worker/leaderPollWorker';
import {emitJobUpdated, emitPushRow} from './pushEvents';
import {acquire as acquireLock} from './slotLock';
import {
    chunkPemForUpload,
    fwAtLeast,
    parseFwId,
    SLOT_REGISTRY
} from './slotMap';

const LEADER_NAME = 'cert-push-worker';

const logger = log4js.getLogger('cert-push');

interface QueuedRow {
    id: number;
    job_id: string;
    certificate_id: string;
    tenant_id: string;
    logical_device_id: number;
    device_id: string;
    slot: CertificateSlot;
    pem: string | null;
    private_key_encrypted: string | null;
    fingerprint_sha256: string | null;
}

// Same AAD shape as CertificateComponent — bound to (tenant, fingerprint).
function privateKeyAad(tenantId: string, fingerprint: string): string {
    return `certificates:tenant:${tenantId}:fp:${fingerprint}`;
}

function pollIntervalMs(): number {
    return envInt('FM_CERT_PUSH_POLL_INTERVAL_MS', 1_000, 100);
}
function concurrency(): number {
    return envInt('FM_CERT_PUSH_CONCURRENCY', 8, 1);
}
function lockTimeoutMs(): number {
    return envInt('FM_CERT_PUSH_LOCK_TIMEOUT_MS', 30_000, 1_000);
}
function pushTimeoutMs(): number {
    return envInt('FM_CERT_PUSH_TIMEOUT_MS', 30_000, 1_000);
}

async function reclaimStaleInFlight(): Promise<void> {
    const stale = (await store.queryRows(
        `UPDATE organization.certificate_pushes
            SET status='failed',
                last_error='fm_restart_during_push'
          WHERE status='in_progress'
            AND (picked_up_at IS NULL OR picked_up_at < now() - ($1 || ' ms')::interval)
      RETURNING id::text`,
        [pushTimeoutMs()]
    )) as unknown as Array<{id: string}>;
    if (stale.length > 0) {
        logger.warn(
            'Reclaimed %d in_progress cert push rows from a previous FM run',
            stale.length
        );
    }
}

async function selectQueued(limit: number): Promise<QueuedRow[]> {
    return (await store.queryRows(
        `WITH candidates AS MATERIALIZED (
             SELECT push.id, push.logical_device_id
               FROM organization.certificate_pushes push
              WHERE push.status='queued'
                AND push.logical_device_id IS NOT NULL
              ORDER BY push.id ASC
              LIMIT $1
         ), bound AS MATERIALIZED (
             SELECT candidates.id,
                    candidates.logical_device_id,
                    device.external_id
               FROM candidates
               JOIN device.list device
                 ON device.id = candidates.logical_device_id
               JOIN organization.certificate_pushes push
                 ON push.id = candidates.id
                AND device.organization_id = push.tenant_id
              ORDER BY candidates.logical_device_id, candidates.id
              FOR UPDATE OF device
         ), locked AS MATERIALIZED (
             SELECT bound.*,
                    pg_advisory_xact_lock(
                        ${LOGICAL_DEVICE_LOCK_NAMESPACE},
                        bound.logical_device_id
                    ) AS identity_lock
               FROM bound
              ORDER BY bound.logical_device_id, bound.id
         ), claimable AS MATERIALIZED (
             SELECT push.id,
                    locked.logical_device_id,
                    locked.external_id
               FROM locked
               JOIN organization.certificate_pushes push
                 ON push.id = locked.id
              WHERE push.status='queued'
              FOR UPDATE OF push SKIP LOCKED
         ), claimed AS (
             UPDATE organization.certificate_pushes push
                SET status='in_progress',
                    picked_up_at=now()
               FROM claimable
              WHERE push.id = claimable.id
          RETURNING push.id,
                    push.job_id,
                    push.certificate_id,
                    push.tenant_id,
                    push.slot,
                    claimable.logical_device_id,
                    claimable.external_id
         )
         SELECT claimed.id,
                claimed.job_id::text,
                claimed.certificate_id::text,
                claimed.tenant_id::text,
                claimed.logical_device_id,
                claimed.external_id AS device_id,
                claimed.slot,
                certificate.pem,
                certificate.private_key_encrypted,
                certificate.fingerprint_sha256
           FROM claimed
           JOIN organization.certificates certificate
             ON certificate.id = claimed.certificate_id
          ORDER BY claimed.id`,
        [limit]
    )) as unknown as QueuedRow[];
}

export async function __claimQueuedForTests(
    limit: number
): Promise<QueuedRow[]> {
    return selectQueued(limit);
}

function payloadForSlot(row: QueuedRow): string {
    const isKeySlot = row.slot === 'client_key' || row.slot === 'server_key';
    if (isKeySlot) {
        if (!row.private_key_encrypted) {
            throw new Error(
                `slot ${row.slot} requires a stored private key but cert has none`
            );
        }
        const aad = row.fingerprint_sha256
            ? privateKeyAad(row.tenant_id, row.fingerprint_sha256)
            : undefined;
        return decryptStringSecret(row.private_key_encrypted, {
            additionalData: aad
        });
    }
    if (!row.pem) {
        throw new Error(`cert ${row.certificate_id} has no pem body`);
    }
    return row.pem;
}

// row.tenant_id is the enqueuing org (immutable per the C2-2 invariant test).
async function assertDeviceStillBelongsToTenant(row: QueuedRow): Promise<void> {
    const rows = (await store.queryRows(
        `SELECT 1
           FROM device.list
          WHERE organization_id = $1
            AND external_id = $2
          LIMIT 1`,
        [row.tenant_id, row.device_id]
    )) as unknown[];
    if (rows.length === 0) {
        throw new Error('device no longer belongs to queued tenant');
    }
}

async function pushChunkedToDevice(
    row: QueuedRow,
    pem: string
): Promise<{requiresReboot: boolean}> {
    const device = DeviceCollector.getDevice(row.device_id);
    if (!device) {
        throw new Error(`device ${row.device_id} is not connected`);
    }
    const cfg = SLOT_REGISTRY[row.slot];
    if (cfg.minFirmware) {
        const fw = parseFwId(device.info?.fw_id);
        if (!fwAtLeast(fw, cfg.minFirmware)) {
            const need = cfg.minFirmware.join('.');
            throw new Error(
                `device firmware too old for slot ${row.slot} (need >= ${need})`
            );
        }
    }
    const chunks = chunkPemForUpload(pem);
    let requiresReboot = false;
    for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const resp = (await device.sendRPC(cfg.rpcMethod, {
            data: chunks[i],
            append: !isLast
        })) as {len?: number; requires_reboot?: boolean} | undefined;
        if (resp?.requires_reboot === true) requiresReboot = true;
    }
    return {requiresReboot: requiresReboot || cfg.requiresReboot};
}

async function rollbackSlot(row: QueuedRow): Promise<void> {
    const device = DeviceCollector.getDevice(row.device_id);
    if (!device) return;
    try {
        const cfg = SLOT_REGISTRY[row.slot];
        await device.sendRPC(cfg.rpcMethod, {data: null, append: false});
    } catch (err) {
        logger.warn(
            'rollback (data:null) failed for device=%s slot=%s err=%s',
            row.device_id,
            row.slot,
            err
        );
    }
}

async function rebootDevice(row: QueuedRow): Promise<void> {
    const device = DeviceCollector.getDevice(row.device_id);
    if (!device) return;
    try {
        await device.sendRPC('Shelly.Reboot', {});
    } catch (err) {
        logger.warn(
            'reboot after cert push failed for device=%s err=%s',
            row.device_id,
            err
        );
    }
}

async function processRow(row: QueuedRow): Promise<void> {
    let release: (() => void) | null = null;
    try {
        await markJobRunning({
            kind: 'certificate',
            tenantId: row.tenant_id,
            jobId: row.job_id
        });
        release = await acquireLock(row.device_id, row.slot, lockTimeoutMs());
        await assertDeviceStillBelongsToTenant(row);
        const pem = payloadForSlot(row);
        const {requiresReboot} = await pushChunkedToDevice(row, pem);
        const updated = await markCertificateUnit({
            id: row.id,
            status: 'applied',
            lastError: null,
            requiresReboot
        });
        emitPushRow(row.job_id, updated, row.tenant_id);
        if (requiresReboot) await rebootDevice(row);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await rollbackSlotSafely(row);
        const updated = await markCertificateUnit({
            id: row.id,
            status: 'failed',
            lastError: msg,
            requiresReboot: false
        });
        emitPushRow(row.job_id, updated, row.tenant_id);
    } finally {
        if (release) release();
        await maybeFinalizeJob(row.job_id, row.tenant_id).catch((err) =>
            logger.warn(
                'finalize cert job %s failed: %s',
                row.job_id,
                String(err)
            )
        );
    }
}

async function rollbackSlotSafely(row: QueuedRow): Promise<void> {
    try {
        await rollbackSlot(row);
    } catch (error) {
        logger.warn(
            'certificate rollback failed job=%s device=%s slot=%s: %s',
            row.job_id,
            row.device_id,
            row.slot,
            formatError(error)
        );
    }
}

async function maybeFinalizeJob(
    jobId: string,
    tenantId: string
): Promise<void> {
    const counts = (await store.queryRows(
        `SELECT
             COUNT(*) FILTER (WHERE status IN ('queued', 'in_progress')) AS pending,
             COUNT(*) FILTER (WHERE status='failed') AS failed,
             COUNT(*) FILTER (WHERE status='applied') AS applied
           FROM organization.certificate_pushes
          WHERE job_id=$1`,
        [jobId]
    )) as unknown as Array<{pending: string; failed: string; applied: string}>;
    const pending = Number(counts[0]?.pending ?? 0);
    if (pending > 0) return;
    const failed = Number(counts[0]?.failed ?? 0);
    const finalStatus = failed > 0 ? 'failed' : 'done';
    const job = await finishJob({
        kind: 'certificate',
        tenantId,
        jobId,
        status: finalStatus
    });
    if (job) {
        emitJobUpdated(certificateJobResponse(job, tenantId), tenantId);
    }
}

function requiredStringMetadata(
    job: OperationJobSnapshot,
    key: string
): string {
    const value = job.metadata[key];
    if (typeof value !== 'string') {
        throw new Error(`certificate job ${job.id} missing metadata.${key}`);
    }
    return value;
}

function certificateJobResponse(
    job: OperationJobSnapshot,
    tenantId: string
): CertificateJobResponse {
    return {
        id: job.id,
        tenant_id: tenantId,
        certificate_id: requiredStringMetadata(job, 'certificateId'),
        slot: requiredStringMetadata(job, 'slot') as CertificateSlot,
        target_summary: (job.metadata.targetSummary as never) ?? {},
        status: job.status,
        started_at: job.startedAt,
        finished_at: job.endedAt,
        created_at: job.createdAt,
        created_by: job.createdBy
    };
}

// One stuck row must not pin the batch.
const ROW_TIMEOUT_MS = envInt('FM_CERT_PUSH_ROW_TIMEOUT_MS', 120_000, 1_000);

async function runQueued(): Promise<void> {
    const rows = await selectQueued(concurrency());
    if (rows.length === 0) return;
    await runBoundedParallel({
        tasks: rows,
        run: (r) => processRow(r),
        concurrency: concurrency(),
        perTaskTimeoutMs: ROW_TIMEOUT_MS,
        label: 'certificate-push'
    });
}

const worker = createLeaderPollWorker({
    leaderName: LEADER_NAME,
    logger,
    pollIntervalMs,
    tick: runQueued,
    reclaim: {
        run: reclaimStaleInFlight,
        intervalMs: tuning.delivery.pushReclaimIntervalMs
    }
});

export const start = worker.start;
export const stop = worker.stop;

// Test hook — allow tests to drive the worker manually.
export async function __tickForTests(): Promise<void> {
    await worker.tickOnce();
}
