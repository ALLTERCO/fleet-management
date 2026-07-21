// Credential push worker. Per-(device, 'auth') lock, durable rows, restart-resume.

import log4js from 'log4js';
import {envInt} from '../../config/envReader';
import {tuning} from '../../config/tuning';
import {acquire as acquireLock} from '../certificate/slotLock';
import * as DeviceCollector from '../DeviceCollector';
import * as EventDistributor from '../EventDistributor';
import {
    type CredentialPushRow,
    finishJob,
    markCredentialUnit,
    markJobRunning
} from '../jobs/repository';
import {LOGICAL_DEVICE_LOCK_NAMESPACE} from '../jobs/repositoryFactory';
import * as store from '../PostgresProvider';
import {formatError} from '../util/formatError';
import {runBoundedParallel} from '../util/runBoundedParallel';
import {createLeaderPollWorker} from '../worker/leaderPollWorker';

const LEADER_NAME = 'credential-push-worker';
const logger = log4js.getLogger('credential-push');

const SLOT_KEY = 'auth';

interface QueuedRow {
    id: number;
    job_id: string;
    tenant_id: string;
    logical_device_id: number;
    device_id: string;
    ha1_old_hex: string | null;
    // null ha1_new_hex + password_encrypted = clear-auth push.
    // Worker sends Shelly.SetAuth with ha1=null, then deletes credentials.
    ha1_new_hex: string | null;
    password_encrypted: string | null;
    requested_by: string | null;
}

function pollIntervalMs(): number {
    return envInt('FM_CREDENTIAL_PUSH_POLL_INTERVAL_MS', 1_000, 100);
}
function concurrency(): number {
    return envInt('FM_CREDENTIAL_PUSH_CONCURRENCY', 8, 1);
}
function lockTimeoutMs(): number {
    return envInt('FM_CREDENTIAL_PUSH_LOCK_TIMEOUT_MS', 30_000, 1_000);
}
function pushTimeoutMs(): number {
    return envInt('FM_CREDENTIAL_PUSH_TIMEOUT_MS', 30_000, 1_000);
}

async function reclaimStaleInFlight(): Promise<void> {
    const stale = (await store.queryRows(
        `UPDATE organization.credential_pushes
            SET status='failed',
                last_error='fm_restart_during_push'
          WHERE status='in_progress'
            AND (picked_up_at IS NULL OR picked_up_at < now() - ($1 || ' ms')::interval)
      RETURNING id`,
        [pushTimeoutMs()]
    )) as unknown as Array<{id: number}>;
    if (stale.length > 0) {
        logger.warn(
            'Reclaimed %d in_progress credential push rows from a previous FM run',
            stale.length
        );
    }
}

async function selectQueued(limit: number): Promise<QueuedRow[]> {
    return (await store.queryRows(
        `WITH candidates AS MATERIALIZED (
             SELECT push.id, push.logical_device_id
               FROM organization.credential_pushes push
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
               JOIN organization.credential_pushes push
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
               JOIN organization.credential_pushes push
                 ON push.id = locked.id
              WHERE push.status='queued'
              FOR UPDATE OF push SKIP LOCKED
         ), claimed AS (
             UPDATE organization.credential_pushes push
                SET status='in_progress',
                    picked_up_at=now()
               FROM claimable
              WHERE push.id = claimable.id
          RETURNING push.id,
                    push.job_id,
                    push.tenant_id,
                    push.ha1_old_hex,
                    push.ha1_new_hex,
                    push.password_encrypted,
                    push.requested_by,
                    claimable.logical_device_id,
                    claimable.external_id
         )
         SELECT claimed.id,
                claimed.job_id::text,
                claimed.tenant_id::text,
                claimed.logical_device_id,
                claimed.external_id AS device_id,
                claimed.ha1_old_hex,
                claimed.ha1_new_hex,
                claimed.password_encrypted,
                claimed.requested_by
           FROM claimed
          ORDER BY claimed.id`,
        [limit]
    )) as unknown as QueuedRow[];
}

export async function __claimQueuedForTests(
    limit: number
): Promise<QueuedRow[]> {
    return selectQueued(limit);
}

// orgId-tagged so only same-tenant listeners receive the push event.
function emitPushRow(row: CredentialPushRow, orgId: string): void {
    EventDistributor.processAndNotifyAll(
        {method: 'Credential.PushRow', params: {jobId: row.job_id, row}},
        {organizationId: orgId}
    );
}

// Delegates to fn_credential_finalize_ok / _cleared — single source
// of truth for device_credentials writes lives in the SQL migration.
async function finalizeDeviceCredentialOk(row: QueuedRow): Promise<void> {
    if (row.ha1_new_hex === null) {
        await store.callMethod('organization.fn_credential_finalize_cleared', {
            p_tenant_id: row.tenant_id,
            p_device_id: row.device_id
        });
        return;
    }
    await store.callMethod('organization.fn_credential_finalize_ok', {
        p_tenant_id: row.tenant_id,
        p_device_id: row.device_id,
        p_password_encrypted: row.password_encrypted,
        p_ha1_hex: row.ha1_new_hex,
        p_rotated_by: row.requested_by ?? 'system:credential-push-worker'
    });
}

async function finalizeDeviceCredentialFailed(
    tenantId: string,
    deviceId: string,
    err: string
): Promise<void> {
    await store.callMethod('organization.fn_credential_finalize_failed', {
        p_tenant_id: tenantId,
        p_device_id: deviceId,
        p_error: err
    });
}

// Sentinel error type so processRow can distinguish "tenant moved"
// from a real push failure — Retry would re-queue against the wrong
// tenant if these were bucketed together.
export class TenantMovedError extends Error {
    constructor(deviceId: string, tenantId: string) {
        super(`device ${deviceId} no longer belongs to tenant ${tenantId}`);
        this.name = 'TenantMovedError';
    }
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
        throw new TenantMovedError(row.device_id, row.tenant_id);
    }
}

async function processRow(row: QueuedRow): Promise<void> {
    let release: (() => void) | null = null;
    try {
        await markJobRunning({
            kind: 'credential',
            tenantId: row.tenant_id,
            jobId: row.job_id
        });
        release = await acquireLock(row.device_id, SLOT_KEY, lockTimeoutMs());
        await assertDeviceStillBelongsToTenant(row);
        const device = DeviceCollector.getDevice(row.device_id);
        if (!device) throw new Error('device offline');
        // null ha1_new_hex = clear-auth push: ha1 null disables auth. The device
        // still requires user='admin' and realm=<device-id> even to disable —
        // verified on hardware: all-null returns "Missing required argument 'user'".
        const isClear = row.ha1_new_hex === null;
        await device.sendRPC(
            'Shelly.SetAuth',
            isClear
                ? {user: 'admin', realm: row.device_id, ha1: null}
                : {
                      user: 'admin',
                      realm: row.device_id,
                      ha1: row.ha1_new_hex
                  },
            false,
            AbortSignal.timeout(pushTimeoutMs())
        );
        await finalizeDeviceCredentialOk(row);
        emitPushRow(
            await markCredentialUnit({
                id: row.id,
                status: 'ok',
                lastError: null
            }),
            row.tenant_id
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finalizeDeviceCredentialFailedSafely(row, msg);
        emitPushRow(
            await markCredentialUnit({
                id: row.id,
                status: 'failed',
                lastError: msg
            }),
            row.tenant_id
        );
    } finally {
        if (release) release();
        await maybeFinalizeJob(row.job_id, row.tenant_id).catch((err) =>
            logger.warn(
                'finalize credential job %s failed: %s',
                row.job_id,
                String(err)
            )
        );
    }
}

async function finalizeDeviceCredentialFailedSafely(
    row: QueuedRow,
    message: string
): Promise<void> {
    try {
        await finalizeDeviceCredentialFailed(
            row.tenant_id,
            row.device_id,
            message
        );
    } catch (error) {
        logger.warn(
            'credential failure finalization failed job=%s device=%s: %s',
            row.job_id,
            row.device_id,
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
             COUNT(*) FILTER (WHERE status IN ('queued','in_progress')) AS pending,
             COUNT(*) FILTER (WHERE status='failed') AS failed
           FROM organization.credential_pushes
          WHERE job_id=$1 AND tenant_id=$2`,
        [jobId, tenantId]
    )) as unknown as Array<{pending: string; failed: string}>;
    if (Number(counts[0]?.pending ?? 0) > 0) return;
    const finalStatus = Number(counts[0]?.failed ?? 0) > 0 ? 'failed' : 'done';
    const job = await finishJob({
        kind: 'credential',
        tenantId,
        jobId,
        status: finalStatus
    });
    if (job) {
        EventDistributor.processAndNotifyAll(
            {
                method: 'Credential.JobUpdated',
                params: {jobId, status: job.status}
            },
            {organizationId: tenantId}
        );
    }
}

// One stuck row must not pin the batch.
const ROW_TIMEOUT_MS = envInt(
    'FM_CREDENTIAL_PUSH_ROW_TIMEOUT_MS',
    60_000,
    1_000
);

async function runQueued(): Promise<void> {
    const rows = await selectQueued(concurrency());
    if (rows.length === 0) return;
    await runBoundedParallel({
        tasks: rows,
        run: (r) => processRow(r),
        concurrency: concurrency(),
        perTaskTimeoutMs: ROW_TIMEOUT_MS,
        label: 'credential-push'
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

export async function __tickForTests(): Promise<void> {
    await worker.tickOnce();
}
