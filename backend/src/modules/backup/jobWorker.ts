import log4js from 'log4js';
import {envInt} from '../../config/envReader';
import {emitJobUnitUpdated, emitJobUpdated} from '../jobs/events';
import {
    type BackupQueuedUnit,
    finishJob,
    getBackupUnitCounts,
    listQueuedBackupUnits,
    markBackupUnitDone,
    markBackupUnitFailed,
    markJobRunning,
    reclaimStaleBackupUnits
} from '../jobs/repository';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {formatError} from '../util/formatError';
import {runBoundedParallel} from '../util/runBoundedParallel';

const LEADER_NAME = 'backup-job-worker';
const logger = log4js.getLogger('backup-job-worker');

export interface BackupUnitResult {
    backupId?: string;
    result?: unknown;
}

export type BackupUnitProcessor = (
    unit: BackupQueuedUnit
) => Promise<BackupUnitResult>;

let running = false;
let pollHandle: NodeJS.Timeout | null = null;
let processor: BackupUnitProcessor | null = null;

export function registerBackupUnitProcessor(next: BackupUnitProcessor): void {
    processor = next;
}

function pollIntervalMs(): number {
    return envInt('FM_BACKUP_JOB_POLL_INTERVAL_MS', 1_000, 100);
}

function concurrency(): number {
    return envInt('FM_BACKUP_JOB_CONCURRENCY', 3, 1);
}

function jobTimeoutMs(): number {
    return envInt('FM_BACKUP_JOB_TIMEOUT_MS', 300_000, 1_000);
}

async function reclaimStaleInFlight(): Promise<void> {
    const count = await reclaimStaleBackupUnits({timeoutMs: jobTimeoutMs()});
    if (count > 0) {
        logger.warn(
            'Reclaimed %d in_progress backup rows from a previous FM run',
            count
        );
    }
}

async function finalizeJob(unit: BackupQueuedUnit): Promise<void> {
    const counts = await getBackupUnitCounts({
        tenantId: unit.tenant_id,
        jobId: unit.job_id
    });
    if (counts.pending > 0) return;
    const job = await finishJob({
        kind: 'backup',
        tenantId: unit.tenant_id,
        jobId: unit.job_id,
        status: counts.failed > 0 ? 'failed' : 'done'
    });
    if (job) emitJobUpdated(job, unit.tenant_id);
}

async function processUnit(unit: BackupQueuedUnit): Promise<void> {
    if (!processor) {
        throw new Error('backup job processor is not registered');
    }
    await markJobRunning({
        kind: 'backup',
        tenantId: unit.tenant_id,
        jobId: unit.job_id
    });
    try {
        const result = await processor(unit);
        await markBackupUnitDone({
            id: unit.id,
            backupId: result.backupId,
            result: result.result
        });
        emitJobUnitUpdated(
            {
                jobId: unit.job_id,
                kind: 'backup',
                unitId: String(unit.id),
                status: 'done',
                deviceId: unit.device_id,
                result: result.result
            },
            unit.tenant_id
        );
    } catch (err) {
        const error = formatError(err);
        await markBackupUnitFailed({
            id: unit.id,
            lastError: error
        });
        emitJobUnitUpdated(
            {
                jobId: unit.job_id,
                kind: 'backup',
                unitId: String(unit.id),
                status: 'failed',
                deviceId: unit.device_id,
                error
            },
            unit.tenant_id
        );
    } finally {
        await finalizeBackupJobSafely(unit);
    }
}

async function finalizeBackupJobSafely(unit: BackupQueuedUnit): Promise<void> {
    try {
        await finalizeJob(unit);
    } catch (error) {
        logger.warn(
            'finalize backup job %s failed: %s',
            unit.job_id,
            formatError(error)
        );
    }
}

// Slow device must not pin the tick.
const UNIT_TIMEOUT_MS = envInt('FM_BACKUP_UNIT_TIMEOUT_MS', 120_000, 1_000);

async function tick(): Promise<void> {
    if (!isLeader(LEADER_NAME)) return;
    const units = await listQueuedBackupUnits({limit: concurrency()});
    if (units.length === 0) return;
    // failFast surfaces setup errors instead of silently swallowing them.
    await runBoundedParallel({
        tasks: units,
        run: (unit) => processUnit(unit),
        concurrency: concurrency(),
        perTaskTimeoutMs: UNIT_TIMEOUT_MS,
        label: 'backup-unit',
        failFast: true
    });
}

export async function start(): Promise<void> {
    if (running) return;
    running = true;
    void startLeaderGate(LEADER_NAME);
    try {
        await reclaimStaleInFlight();
    } catch (err) {
        logger.warn(
            'reclaim stale in_progress backup rows failed: %s',
            formatError(err)
        );
    }
    const loop = async () => {
        if (!running) return;
        try {
            await tick();
        } catch (err) {
            logger.error('backup job tick failed: %s', formatError(err));
        }
        if (!running) return;
        pollHandle = setTimeout(loop, pollIntervalMs());
    };
    void loop();
}

export function stop(): void {
    running = false;
    if (pollHandle) {
        clearTimeout(pollHandle);
        pollHandle = null;
    }
}

export async function __tickForTests(): Promise<void> {
    await tick();
}
