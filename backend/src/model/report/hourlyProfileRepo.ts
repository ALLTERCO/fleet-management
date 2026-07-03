// Wraps device_em.fn_hourly_profile. Owns the I/O; returns dense 24-bucket
// arrays. Empty hours from the DB are filled with 0 so callers always see a
// length-24 series.

import {getLogger} from 'log4js';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {HOURS_PER_DAY} from '../../modules/util/timeUnits';

const logger = getLogger('hourlyProfileRepo');

export interface HourlyProfileFetchInput {
    readonly deviceIds: readonly number[];
    readonly from: Date;
    readonly to: Date;
    readonly timezone?: string;
}

export interface HourlyProfile {
    readonly consumedKWh: readonly number[];
    readonly returnedKWh: readonly number[];
}

interface Row {
    hour_of_day: number;
    consumed_kwh: number;
    returned_kwh: number;
}

const EMPTY: HourlyProfile = {
    consumedKWh: new Array(HOURS_PER_DAY).fill(0),
    returnedKWh: new Array(HOURS_PER_DAY).fill(0)
};

export async function fetchHourlyProfile(
    input: HourlyProfileFetchInput
): Promise<HourlyProfile> {
    if (!hasFetchInput(input)) return EMPTY;
    const rows = await fetchRowsBestEffort(input);
    return rows.length === 0 ? EMPTY : densifyRows(rows);
}

function hasFetchInput({
    deviceIds,
    from,
    to
}: HourlyProfileFetchInput): boolean {
    return deviceIds.length > 0 && to.getTime() > from.getTime();
}

// Reports must not fail because hourly profile lookup did — degrades to flat 0s.
async function fetchRowsBestEffort(
    input: HourlyProfileFetchInput
): Promise<Row[]> {
    try {
        const res = await PostgresProvider.callMethod(
            'device_em.fn_hourly_profile',
            {
                p_devices: [...input.deviceIds],
                p_from: input.from,
                p_to: input.to,
                p_tz: input.timezone ?? 'UTC'
            }
        );
        return (res?.rows ?? []) as Row[];
    } catch (err) {
        logger.warn(
            'hourly profile read failed for %d devices (usage profile skipped): %s',
            input.deviceIds.length,
            err instanceof Error ? err.message : String(err)
        );
        return [];
    }
}

function densifyRows(rows: readonly Row[]): HourlyProfile {
    const consumed = new Array(HOURS_PER_DAY).fill(0);
    const returned = new Array(HOURS_PER_DAY).fill(0);
    for (const r of rows) {
        if (r.hour_of_day >= 0 && r.hour_of_day < HOURS_PER_DAY) {
            consumed[r.hour_of_day] = +(r.consumed_kwh ?? 0);
            returned[r.hour_of_day] = +(r.returned_kwh ?? 0);
        }
    }
    return {consumedKWh: consumed, returnedKWh: returned};
}
