import log4js from 'log4js';
import {envInt} from '../../config/envReader';
import CommandSender from '../../model/CommandSender';
import type {json_rpc_event, ShellyEvent} from '../../types';
import * as EventDistributor from '../EventDistributor';
import {emitJobUnitUpdated, emitJobUpdated} from '../jobs/events';
import {
    type FirmwareQueuedUnit,
    finishJob,
    getFirmwareUnitCounts,
    listQueuedFirmwareUnits,
    markFirmwareUnitDone,
    markFirmwareUnitFailed,
    markFirmwareUnitProgress,
    markJobRunning,
    reclaimStaleFirmwareUnits
} from '../jobs/repository';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import {formatError} from '../util/formatError';
import {runBoundedParallel} from '../util/runBoundedParallel';

const LEADER_NAME = 'firmware-job-worker';
const logger = log4js.getLogger('firmware-job-worker');

export interface FirmwareUnitResult {
    finalVersion?: string;
    finalFwId?: string;
    result?: unknown;
}

export type FirmwareUnitProcessor = (
    unit: FirmwareQueuedUnit
) => Promise<FirmwareUnitResult>;

let running = false;
let pollHandle: NodeJS.Timeout | null = null;
let listenerId: number | null = null;
let processor: FirmwareUnitProcessor | null = null;

// Keyed per device: OtaProgress carries only the device id.
const activeUnitsByKey = new Map<string, FirmwareQueuedUnit>();
const failedUnits = new Set<number>();

export function activeUnitKey(tenantId: string, deviceId: string): string {
    return `${tenantId}::${deviceId}`;
}

/** Route an OtaProgress (device id only) to the active unit for the resolved
 * tenant; undefined when none matches. */
export function findActiveUnitForProgress(
    active: ReadonlyMap<string, FirmwareQueuedUnit>,
    tenantId: string | undefined,
    deviceId: string
): FirmwareQueuedUnit | undefined {
    if (!tenantId) return undefined;
    return active.get(activeUnitKey(tenantId, deviceId));
}

export function registerFirmwareUnitProcessor(
    next: FirmwareUnitProcessor
): void {
    processor = next;
}

function pollIntervalMs(): number {
    return envInt('FM_FIRMWARE_JOB_POLL_INTERVAL_MS', 1_000, 100);
}

function concurrency(): number {
    return envInt('FM_FIRMWARE_JOB_CONCURRENCY', 3, 1);
}

function jobTimeoutMs(): number {
    return envInt('FM_FIRMWARE_JOB_TIMEOUT_MS', 300_000, 1_000);
}

function isShellyOtaProgress(
    event: json_rpc_event
): event is ShellyEvent.OtaProgress {
    return event.method === 'Shelly.OtaProgress';
}

function progressPhase(event: ShellyEvent.OtaProgress['params']): {
    phase: string;
    progressPercent?: number;
} {
    if (event.event === 'ota_success') {
        return {phase: 'rebooting', progressPercent: 100};
    }
    if (event.event === 'ota_progress') {
        return {
            phase: 'downloading',
            progressPercent: event.progress_percent ?? 0
        };
    }
    return {phase: 'downloading', progressPercent: 0};
}

async function reclaimStaleInFlight(): Promise<void> {
    const count = await reclaimStaleFirmwareUnits({timeoutMs: jobTimeoutMs()});
    if (count > 0) {
        logger.warn(
            'Reclaimed %d in_progress firmware rows from a previous FM run',
            count
        );
    }
}

async function finalizeJob(unit: FirmwareQueuedUnit): Promise<void> {
    const counts = await getFirmwareUnitCounts({
        tenantId: unit.tenant_id,
        jobId: unit.job_id
    });
    if (counts.pending > 0) return;
    const job = await finishJob({
        kind: 'firmware',
        tenantId: unit.tenant_id,
        jobId: unit.job_id,
        status: counts.failed > 0 ? 'failed' : 'done'
    });
    if (job) emitJobUpdated(job, unit.tenant_id);
}

async function markUnitFailed(unit: FirmwareQueuedUnit, error: string) {
    failedUnits.add(unit.id);
    await markFirmwareUnitFailed({
        id: unit.id,
        lastError: error
    });
    emitJobUnitUpdated(
        {
            jobId: unit.job_id,
            kind: 'firmware',
            unitId: String(unit.id),
            status: 'failed',
            deviceId: unit.device_id,
            error
        },
        unit.tenant_id
    );
}

async function applyOtaProgressEvent(
    unit: FirmwareQueuedUnit,
    params: ShellyEvent.OtaProgress['params']
): Promise<void> {
    if (params.event === 'ota_error') {
        await markUnitFailed(unit, params.msg || 'OTA update failed');
        return;
    }

    const progress = progressPhase(params);
    await markFirmwareUnitProgress({
        id: unit.id,
        phase: progress.phase,
        progressPercent: progress.progressPercent
    });
    emitJobUnitUpdated(
        {
            jobId: unit.job_id,
            kind: 'firmware',
            unitId: String(unit.id),
            status: 'running',
            deviceId: unit.device_id,
            phase: progress.phase,
            progressPercent: progress.progressPercent
        },
        unit.tenant_id
    );
}

function handleOtaProgress(event: json_rpc_event): void {
    if (!isShellyOtaProgress(event)) return;
    const deviceId = event.params.shellyID;
    const tenantId = EventDistributor.getDeviceOrg(deviceId);
    // Without a resolvable tenant the unit cannot be identified; drop the
    // progress update rather than risk attributing it to the wrong unit.
    const unit = findActiveUnitForProgress(
        activeUnitsByKey,
        tenantId,
        deviceId
    );
    if (!unit) return;
    void applyOtaProgressSafely(unit, event.params);
}

async function applyOtaProgressSafely(
    unit: FirmwareQueuedUnit,
    params: ShellyEvent.OtaProgress['params']
): Promise<void> {
    try {
        await applyOtaProgressEvent(unit, params);
    } catch (error) {
        logger.warn(
            'firmware progress update for unit %d failed: %s',
            unit.id,
            formatError(error)
        );
    }
}

function subscribeToOtaProgress(): void {
    if (listenerId !== null) return;
    listenerId = EventDistributor.addEventListener(
        CommandSender.INTERNAL,
        'Shelly.OtaProgress',
        {},
        (event) => handleOtaProgress(event)
    );
}

function unsubscribeFromOtaProgress(): void {
    if (listenerId === null) return;
    EventDistributor.removeEventListener(listenerId, 'Shelly.OtaProgress');
    listenerId = null;
}

async function processUnit(unit: FirmwareQueuedUnit): Promise<void> {
    if (!processor) {
        throw new Error('firmware job processor is not registered');
    }
    await markJobRunning({
        kind: 'firmware',
        tenantId: unit.tenant_id,
        jobId: unit.job_id
    });

    activeUnitsByKey.set(activeUnitKey(unit.tenant_id, unit.device_id), unit);
    failedUnits.delete(unit.id);
    try {
        const result = await processor(unit);
        if (failedUnits.has(unit.id)) return;
        await markFirmwareUnitDone({
            id: unit.id,
            finalVersion: result.finalVersion,
            finalFwId: result.finalFwId,
            result: result.result
        });
        emitJobUnitUpdated(
            {
                jobId: unit.job_id,
                kind: 'firmware',
                unitId: String(unit.id),
                status: 'done',
                deviceId: unit.device_id,
                result: result.result
            },
            unit.tenant_id
        );
    } catch (err) {
        const error = formatError(err);
        await markUnitFailed(unit, error);
    } finally {
        const key = activeUnitKey(unit.tenant_id, unit.device_id);
        if (activeUnitsByKey.get(key)?.id === unit.id) {
            activeUnitsByKey.delete(key);
        }
        failedUnits.delete(unit.id);
        await finalizeFirmwareJobSafely(unit);
    }
}

async function finalizeFirmwareJobSafely(
    unit: FirmwareQueuedUnit
): Promise<void> {
    try {
        await finalizeJob(unit);
    } catch (error) {
        logger.warn(
            'finalize firmware job %s failed: %s',
            unit.job_id,
            formatError(error)
        );
    }
}

// One offline device must not pin the tick for the RPC default.
const UNIT_TIMEOUT_MS = envInt('FM_FIRMWARE_UNIT_TIMEOUT_MS', 600_000, 1_000);

async function tick(): Promise<void> {
    if (!isLeader(LEADER_NAME)) return;
    const units = await listQueuedFirmwareUnits({limit: concurrency()});
    if (units.length === 0) return;
    // failFast surfaces setup errors from processUnit (raised before its
    // internal try/catch) instead of silently swallowing them.
    await runBoundedParallel({
        tasks: units,
        run: (unit) => processUnit(unit),
        concurrency: concurrency(),
        perTaskTimeoutMs: UNIT_TIMEOUT_MS,
        label: 'firmware-unit',
        failFast: true
    });
}

export async function start(): Promise<void> {
    if (running) return;
    running = true;
    subscribeToOtaProgress();
    void startLeaderGate(LEADER_NAME);
    try {
        await reclaimStaleInFlight();
    } catch (err) {
        logger.warn(
            'reclaim stale in_progress firmware rows failed: %s',
            formatError(err)
        );
    }
    const loop = async () => {
        if (!running) return;
        try {
            await tick();
        } catch (err) {
            logger.error('firmware job tick failed: %s', formatError(err));
        }
        if (!running) return;
        pollHandle = setTimeout(loop, pollIntervalMs());
    };
    void loop();
}

export function stop(): void {
    running = false;
    unsubscribeFromOtaProgress();
    activeUnitsByKey.clear();
    failedUnits.clear();
    if (pollHandle) {
        clearTimeout(pollHandle);
        pollHandle = null;
    }
}

export async function __tickForTests(): Promise<void> {
    await tick();
}
