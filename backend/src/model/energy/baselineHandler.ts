// Energy.Baseline turns the gated SQL rows into one dense local-week profile.

import * as DeviceCollector from '../../modules/DeviceCollector';
import {rawCall} from '../../modules/PostgresProvider';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {baselineScopeType} from '../../types/api/_baselineTags';
import type {
    EnergyBaselineCell,
    EnergyBaselineParams,
    EnergyBaselineResponse,
    EnergyBaselineTempBand
} from '../../types/api/energy';
import type CommandSender from '../CommandSender';
import {
    type DeviceAccessSender,
    senderCanAccessDevice
} from './deviceAccessFilter';

const HOURS_PER_WEEK = 168;
const DEFAULT_MIN_WEEKS = 3;
const OUTDOOR_SENSOR_SOURCE = 'weather';

export interface BaselineRow {
    hour_of_week: number;
    bin_scheme: 'day_type_hour' | 'hour_of_week';
    p25_val: number | null;
    median_val: number | null;
    p75_val: number | null;
    sample_count: number;
    weeks_observed: number;
    ready: boolean;
    first_seen_day: string | null;
    window_from_day: string | null;
    excluded_days: number;
    timezone: string | null;
    computed_at: string | null;
}

export interface BaselineTempRow extends BaselineRow {
    temp_band: 'cool' | 'mid' | 'warm';
    band_min_val: number;
    band_max_val: number;
    temp_device: number;
    temp_source: string;
}

export interface BaselineChangeRow {
    state: 'warning' | 'alarm';
    direction: 'up' | 'down';
    changed_on: string;
    detected_at: string;
}

export interface BaselineQuery {
    organizationId: string;
    deviceId: number;
    channel: number;
    tag: string;
    minWeeks: number;
}

export type BaselineFetcher = (input: BaselineQuery) => Promise<BaselineRow[]>;
export type BaselineTempFetcher = (
    input: BaselineQuery
) => Promise<BaselineTempRow[]>;
export type BaselineChangeFetcher = (
    input: Omit<BaselineQuery, 'minWeeks'>
) => Promise<BaselineChangeRow | null>;

export interface BaselineDeps {
    fetch: BaselineFetcher;
    fetchTemp: BaselineTempFetcher;
    fetchChange: BaselineChangeFetcher;
    lookup: (shellyID: string) => {id: number; shellyID: string} | undefined;
}

function failRow(source: string, field: string): never {
    throw new TypeError(`${source} returned an invalid ${field}`);
}

function records(result: unknown, source: string): Record<string, unknown>[] {
    if (typeof result !== 'object' || result === null)
        failRow(source, 'result');
    const rows = Reflect.get(result, 'rows');
    if (rows === undefined) return [];
    if (!Array.isArray(rows)) failRow(source, 'rows');
    return rows.map((row) => {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) {
            failRow(source, 'row');
        }
        return row as Record<string, unknown>;
    });
}

function finiteNumber(
    row: Record<string, unknown>,
    field: string,
    source: string
): number {
    const value = row[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        failRow(source, field);
    }
    return value;
}

function nullableNumber(
    row: Record<string, unknown>,
    field: string,
    source: string
): number | null {
    return row[field] === null ? null : finiteNumber(row, field, source);
}

function stringValue(
    row: Record<string, unknown>,
    field: string,
    source: string
): string {
    const value = row[field];
    if (typeof value !== 'string') failRow(source, field);
    return value;
}

function nullableString(
    row: Record<string, unknown>,
    field: string,
    source: string
): string | null {
    const value = row[field];
    if (value === null) return null;
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
        return value.toISOString();
    }
    return stringValue(row, field, source);
}

function booleanValue(
    row: Record<string, unknown>,
    field: string,
    source: string
): boolean {
    const value = row[field];
    if (typeof value !== 'boolean') failRow(source, field);
    return value;
}

function enumValue<const T extends string>(
    row: Record<string, unknown>,
    field: string,
    allowed: readonly T[],
    source: string
): T {
    const value = stringValue(row, field, source);
    if (!allowed.includes(value as T)) failRow(source, field);
    return value as T;
}

function decodeBaselineRow(
    row: Record<string, unknown>,
    source: string
): BaselineRow {
    const ready = booleanValue(row, 'ready', source);
    const p25 = nullableNumber(row, 'p25_val', source);
    const median = nullableNumber(row, 'median_val', source);
    const p75 = nullableNumber(row, 'p75_val', source);
    if (ready && (p25 === null || median === null || p75 === null)) {
        failRow(source, 'ready quantiles');
    }
    return {
        hour_of_week: finiteNumber(row, 'hour_of_week', source),
        bin_scheme: enumValue(
            row,
            'bin_scheme',
            ['day_type_hour', 'hour_of_week'],
            source
        ),
        p25_val: p25,
        median_val: median,
        p75_val: p75,
        sample_count: finiteNumber(row, 'sample_count', source),
        weeks_observed: finiteNumber(row, 'weeks_observed', source),
        ready,
        first_seen_day: nullableString(row, 'first_seen_day', source),
        window_from_day: nullableString(row, 'window_from_day', source),
        excluded_days: finiteNumber(row, 'excluded_days', source),
        timezone: nullableString(row, 'timezone', source),
        computed_at: nullableString(row, 'computed_at', source)
    };
}

export function decodeBaselineRows(
    result: unknown,
    source = 'baseline query'
): BaselineRow[] {
    return records(result, source).map((row) => decodeBaselineRow(row, source));
}

export function decodeBaselineTempRows(
    result: unknown,
    source = 'temperature baseline query'
): BaselineTempRow[] {
    return records(result, source).map((row) => ({
        ...decodeBaselineRow(row, source),
        temp_band: enumValue(row, 'temp_band', ['cool', 'mid', 'warm'], source),
        band_min_val: finiteNumber(row, 'band_min_val', source),
        band_max_val: finiteNumber(row, 'band_max_val', source),
        temp_device: finiteNumber(row, 'temp_device', source),
        temp_source: stringValue(row, 'temp_source', source)
    }));
}

export function decodeBaselineChangeRows(
    result: unknown,
    source = 'baseline change query'
): BaselineChangeRow[] {
    return records(result, source).map((row) => ({
        state: enumValue(row, 'state', ['warning', 'alarm'], source),
        direction: enumValue(row, 'direction', ['up', 'down'], source),
        changed_on:
            nullableString(row, 'changed_on', source) ??
            failRow(source, 'changed_on'),
        detected_at:
            nullableString(row, 'detected_at', source) ??
            failRow(source, 'detected_at')
    }));
}

export type BaselineSender = CommandSender & DeviceAccessSender;

export const productionBaselineFetcher: BaselineFetcher = async (input) => {
    const result = await rawCall('fm.fn_hour_of_week_baseline', {
        p_organization_id: input.organizationId,
        p_device: input.deviceId,
        p_channel: input.channel,
        p_tag: input.tag,
        p_min_weeks: input.minWeeks
    });
    return decodeBaselineRows(result, 'fm.fn_hour_of_week_baseline');
};

export const productionBaselineTempFetcher: BaselineTempFetcher = async (
    input
) => {
    const result = await rawCall('fm.fn_baseline_temp_bands', {
        p_organization_id: input.organizationId,
        p_device: input.deviceId,
        p_channel: input.channel,
        p_tag: input.tag,
        p_band: null,
        p_min_weeks: input.minWeeks
    });
    return decodeBaselineTempRows(result, 'fm.fn_baseline_temp_bands');
};

export const productionBaselineChangeFetcher: BaselineChangeFetcher = async (
    input
) => {
    const result = await rawCall('fm.fn_baseline_change_state', {
        p_organization_id: input.organizationId,
        p_device: input.deviceId,
        p_channel: input.channel,
        p_tag: input.tag
    });
    const rows = decodeBaselineChangeRows(
        result,
        'fm.fn_baseline_change_state'
    );
    return rows[0] ?? null;
};

export const productionBaselineLookup = (shellyID: string) => {
    const device = DeviceCollector.getDevice(shellyID);
    return device ? {id: device.id, shellyID: device.shellyID} : undefined;
};

function densify(rows: readonly BaselineRow[]): {
    cells: EnergyBaselineCell[];
    readyCells: number;
} {
    const byHour = new Map(rows.map((row) => [Number(row.hour_of_week), row]));
    const cells: EnergyBaselineCell[] = [];
    let readyCells = 0;
    for (let hourOfWeek = 0; hourOfWeek < HOURS_PER_WEEK; hourOfWeek++) {
        const row = byHour.get(hourOfWeek);
        if (!row) {
            cells.push({
                hourOfWeek,
                median: null,
                p25: null,
                p75: null,
                sampleCount: 0,
                weeksObserved: 0,
                status: 'no_data'
            });
            continue;
        }
        if (row.ready) readyCells += 1;
        cells.push({
            hourOfWeek,
            median: row.ready ? Number(row.median_val) : null,
            p25: row.ready ? Number(row.p25_val) : null,
            p75: row.ready ? Number(row.p75_val) : null,
            sampleCount: Number(row.sample_count),
            weeksObserved: Number(row.weeks_observed),
            status: row.ready ? 'ready' : 'insufficient_weeks'
        });
    }
    return {cells, readyCells};
}

function summariseBands(
    rows: readonly BaselineTempRow[]
): EnergyBaselineTempBand[] {
    const byBand = new Map<string, EnergyBaselineTempBand>();
    for (const row of rows) {
        const existing = byBand.get(row.temp_band);
        if (existing) {
            if (row.ready) existing.readyCells += 1;
            continue;
        }
        byBand.set(row.temp_band, {
            band: row.temp_band,
            minValue: Number(row.band_min_val),
            maxValue: Number(row.band_max_val),
            sourceDeviceId: Number(row.temp_device),
            sourceKind:
                row.temp_source === OUTDOOR_SENSOR_SOURCE
                    ? 'weather_station'
                    : 'ambient_sensor',
            readyCells: row.ready ? 1 : 0
        });
    }
    return [...byBand.values()].sort(
        (left, right) => left.minValue - right.minValue
    );
}

export async function handleEnergyBaseline(
    params: EnergyBaselineParams,
    sender: BaselineSender,
    deps: BaselineDeps
): Promise<EnergyBaselineResponse> {
    const organizationId = requireOrganizationId(sender, params);

    const device = deps.lookup(params.shellyID);
    if (!device) throw RpcError.NotFound('device', params.shellyID);

    if (!(await senderCanAccessDevice(device.id, sender))) {
        throw RpcError.Domain('PermissionDenied');
    }

    const scopeType = baselineScopeType(params.tag);
    const channel = scopeType === 'device' ? 0 : (params.channel ?? 0);
    const query = {
        organizationId,
        deviceId: device.id,
        channel,
        tag: params.tag,
        minWeeks: params.minWeeks ?? DEFAULT_MIN_WEEKS
    };

    const [plainRows, tempRows, change] = await Promise.all([
        deps.fetch(query),
        deps.fetchTemp(query),
        deps.fetchChange({
            organizationId,
            deviceId: device.id,
            channel,
            tag: params.tag
        })
    ]);

    const bandRows = params.temperatureBand
        ? tempRows.filter((row) => row.temp_band === params.temperatureBand)
        : [];
    const temperatureAdjusted = bandRows.length > 0;
    const source: readonly BaselineRow[] = temperatureAdjusted
        ? bandRows
        : plainRows;
    const {cells, readyCells} = densify(source);
    const first = source[0];

    return {
        shellyID: device.shellyID,
        deviceId: device.id,
        scopeType,
        channel,
        tag: params.tag,
        binScheme: first?.bin_scheme ?? null,
        timezone: first?.timezone ?? null,
        firstSeenDay: first?.first_seen_day
            ? String(first.first_seen_day)
            : null,
        windowFromDay: first?.window_from_day
            ? String(first.window_from_day)
            : null,
        excludedDays: first ? Number(first.excluded_days) : 0,
        computedAt: first?.computed_at ? String(first.computed_at) : null,
        readyCells,
        cells,
        temperatureAdjusted,
        temperatureBands: summariseBands(tempRows),
        changeState: change?.state ?? 'ok',
        changeDetectedOn: change?.changed_on ? String(change.changed_on) : null,
        changeDirection: change?.direction ?? null
    };
}
