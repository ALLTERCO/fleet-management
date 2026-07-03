// Wraps device_em.fn_always_on; converts watts × periodHours to kWh.

import {getLogger} from 'log4js';
import * as PostgresProvider from '../../modules/PostgresProvider';
import type {AlwaysOnResult} from './alwaysOn';

const logger = getLogger('alwaysOnRepo');

export interface AlwaysOnFetchInput {
    readonly deviceIds: readonly number[];
    readonly from: Date;
    readonly to: Date;
    readonly periodHours: number;
    readonly windowInterval?: string;
}

interface Row {
    device: number;
    floor_watts: number | null;
    sample_count: number | null;
}

const MIN_REPORTABLE_WATTS = 1;
const DEFAULT_WINDOW = '15 minutes';
const EMPTY: AlwaysOnResult = {totalKWh: 0, perDeviceWatts: new Map()};

export async function fetchAlwaysOn(
    input: AlwaysOnFetchInput
): Promise<AlwaysOnResult> {
    if (!hasFetchInput(input)) return EMPTY;
    const rows = await fetchRowsBestEffort(input);
    return reshapeRows(rows, input.periodHours);
}

function hasFetchInput({
    deviceIds,
    from,
    to,
    periodHours
}: AlwaysOnFetchInput): boolean {
    if (deviceIds.length === 0) return false;
    if (to.getTime() <= from.getTime()) return false;
    if (!Number.isFinite(periodHours) || periodHours <= 0) return false;
    return true;
}

// Best-effort: an unavailable SQL function must not break the whole report.
async function fetchRowsBestEffort(input: AlwaysOnFetchInput): Promise<Row[]> {
    try {
        const res = await PostgresProvider.callMethod(
            'device_em.fn_always_on',
            {
                p_devices: [...input.deviceIds],
                p_from: input.from,
                p_to: input.to,
                p_window: input.windowInterval ?? DEFAULT_WINDOW
            }
        );
        return (res?.rows ?? []) as Row[];
    } catch (err) {
        logger.warn(
            'always-on fetch failed; section degraded: %s',
            err instanceof Error ? err.message : String(err)
        );
        return [];
    }
}

function reshapeRows(
    rows: readonly Row[],
    periodHours: number
): AlwaysOnResult {
    const perDeviceWatts = new Map<number, number>();
    let totalKWh = 0;
    for (const r of rows) {
        const watts = r.floor_watts ?? 0;
        if (watts < MIN_REPORTABLE_WATTS) {
            perDeviceWatts.set(r.device, 0);
            continue;
        }
        perDeviceWatts.set(r.device, +watts.toFixed(1));
        totalKWh += (watts * periodHours) / 1000;
    }
    return {totalKWh: +totalKWh.toFixed(3), perDeviceWatts};
}
