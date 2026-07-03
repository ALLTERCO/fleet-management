// Reconciles em-sync (1-min, billing) vs live (15s) per device. fn_em_sum_check
// returns only buckets that drift beyond tolerance; flag each, never fix. A
// per-device DB failure is isolated. callDb is injected (avoids a load cycle).

import {getLogger} from 'log4js';
import * as Observability from './Observability';

const logger = getLogger('emSumCheck');

export type CallDb = (method: string, params: unknown) => Promise<unknown>;

/** One drifting bucket returned by device_em.fn_em_sum_check. */
export interface SumCheckRow {
    bucket: string;
    tag: string;
    live_sum: number;
    emsync_sum: number;
    drift_pct: number;
}

export interface EmSumCheckDeps {
    callDb: CallDb;
    deviceIds: readonly number[];
    fromMs: number;
    toMs: number;
    /** Drift tolerance in percent; defaults to the doc-15 baseline of 2%. */
    tolerancePct?: number;
    incrementCounter?: (name: string) => void;
    logException?: (deviceId: number, row: SumCheckRow) => void;
}

export interface EmSumCheckResult {
    devicesChecked: number;
    exceptions: number;
    failures: number;
}

const DEFAULT_TOLERANCE_PCT = 2.0;

function defaultLogException(deviceId: number, row: SumCheckRow): void {
    logger.warn(
        `em sum-check drift: device=${deviceId} bucket=${row.bucket} tag=${row.tag} ` +
            `live=${row.live_sum} emsync=${row.emsync_sum} drift=${row.drift_pct.toFixed(2)}%`
    );
}

/**
 * Run the Sum-Check across `deviceIds` over [fromMs, toMs). Returns how many
 * devices were checked, how many drift exceptions were flagged, and how many
 * devices failed (isolated, not thrown). Never mutates energy data.
 */
export async function runEmSumCheck(
    deps: EmSumCheckDeps
): Promise<EmSumCheckResult> {
    const tolerancePct = deps.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
    const incrementCounter =
        deps.incrementCounter ??
        ((name) => Observability.incrementCounter(name));
    const logException = deps.logException ?? defaultLogException;
    const pFrom = Math.floor(deps.fromMs / 1000);
    const pTo = Math.floor(deps.toMs / 1000);

    let devicesChecked = 0;
    let exceptions = 0;
    let failures = 0;

    for (const deviceId of deps.deviceIds) {
        try {
            const result = (await deps.callDb('device_em.fn_em_sum_check', {
                p_device: deviceId,
                p_from: pFrom,
                p_to: pTo,
                p_tolerance_pct: tolerancePct
            })) as {rows?: SumCheckRow[]} | null | undefined;
            devicesChecked++;
            for (const row of result?.rows ?? []) {
                exceptions++;
                incrementCounter('energy_sum_check_exception');
                logException(deviceId, row);
            }
        } catch (err) {
            failures++;
            incrementCounter('energy_sum_check_failed');
            logger.error(
                `em sum-check failed for device=${deviceId}: ${
                    err instanceof Error ? err.message : String(err)
                }`
            );
        }
    }

    return {devicesChecked, exceptions, failures};
}

export interface EmSumCheckSweepDeps {
    callDb: CallDb;
    listDeviceIds: () => Promise<readonly number[]>;
    nowMs: number;
    lookbackMs: number;
    tolerancePct?: number;
    incrementCounter?: (name: string) => void;
    logException?: (deviceId: number, row: SumCheckRow) => void;
}

// One sum-check pass: reconcile every recently-synced device over the trailing
// window. Skips the DB entirely when no device has synced.
export async function sweepEmSumCheck(
    deps: EmSumCheckSweepDeps
): Promise<EmSumCheckResult> {
    const deviceIds = await deps.listDeviceIds();
    if (deviceIds.length === 0) {
        return {devicesChecked: 0, exceptions: 0, failures: 0};
    }
    return runEmSumCheck({
        callDb: deps.callDb,
        deviceIds,
        fromMs: deps.nowMs - deps.lookbackMs,
        toMs: deps.nowMs,
        tolerancePct: deps.tolerancePct,
        incrementCounter: deps.incrementCounter,
        logException: deps.logException
    });
}
