import {getLogger} from 'log4js';
import {bthomeObjectInfos} from '../config/BTHomeData';
import * as Observability from './Observability';
import {toEpochSeconds} from './util/epochSeconds';

const logger = getLogger('sensorCapture');

export type SensorSource = 'internal' | 'builtin' | 'addon' | 'blu' | 'weather';

export interface SensorCaptureDeps {
    callDb: (method: string, params: unknown) => Promise<unknown>;
}

export interface NumericRow {
    device: number;
    source: SensorSource;
    kind: string;
    channel: number | null;
    ts: number;
    val: number;
}

export interface EventRow {
    device: number;
    source: SensorSource;
    kind: string;
    channel: number | null;
    ts: number;
    state: number;
}

// Native leaf -> numeric kind. Celsius only (tF duplicates it).
const NATIVE_NUMERIC_LEAF: Record<string, string> = {
    tC: 'temperature',
    rh: 'humidity',
    lux: 'illuminance'
};

// Compact slugs for BTHome object names that are not valid bare identifiers.
// distance keeps millimetres (the metre object is skipped) so it is one kind.
const BTHOME_KIND_ALIAS: Record<string, string> = {
    'pm2.5': 'pm25',
    uv_index: 'uv',
    distance_mm: 'distance'
};

// Not stored here: non-metric bookkeeping, mass, the metre distance (mm is
// kept), and electrical readings (voltage/current/power/energy) — those go to
// the energy pipeline (device_em), the single home for electrical data.
const BTHOME_SKIP = new Set([
    'packet_id',
    'count',
    'mass_kg',
    'mass_lb',
    'distance_m',
    'voltage',
    'current',
    'power',
    'energy',
    'raw'
]);

// Classify a native flattened key into a numeric reading, or null.
// `embedded` marks a device's own chip temperature (caller tags source internal).
export function classifyNativeNumeric(
    field: string
): {kind: string; channel: number; embedded: boolean} | null {
    const direct =
        /^(temperature|humidity|illuminance):(\d+)\.([a-zA-Z]+)$/.exec(field);
    if (direct) {
        const kind = NATIVE_NUMERIC_LEAF[direct[3]];
        if (!kind) return null;
        return {kind, channel: Number(direct[2]), embedded: false};
    }
    // "switch:0.temperature.tC", "light:0.temperature.tC" -> chip temperature
    const embedded = /^([a-z]+):(\d+)\.temperature\.tC$/.exec(field);
    if (embedded && embedded[1] !== 'temperature') {
        return {
            kind: 'temperature',
            channel: Number(embedded[2]),
            embedded: true
        };
    }
    return null;
}

// Classify a BTHome object id into a stored reading + which store, or null (skip).
export function classifyBthomeObj(
    objId: number
): {kind: string; store: 'numeric' | 'events'} | null {
    const info = bthomeObjectInfos[objId];
    if (!info || BTHOME_SKIP.has(info.name)) return null;
    const kind = BTHOME_KIND_ALIAS[info.name] ?? info.name;
    if (info.type === 'sensor') return {kind, store: 'numeric'};
    if (info.type === 'binary_sensor') return {kind, store: 'events'};
    if (info.type === 'button') return {kind: 'button', store: 'events'};
    return null;
}

function numericArgs(rows: readonly NumericRow[]) {
    const fallbackSeconds = Math.round(Date.now() / 1000);
    return {
        p_device: rows.map((r) => r.device),
        p_source: rows.map((r) => r.source),
        p_kind: rows.map((r) => r.kind),
        p_channel: rows.map((r) => r.channel),
        p_ts: rows.map((r) => toEpochSeconds(r.ts, fallbackSeconds)),
        p_val: rows.map((r) => r.val)
    };
}

function eventArgs(rows: readonly EventRow[]) {
    const fallbackSeconds = Math.round(Date.now() / 1000);
    return {
        p_device: rows.map((r) => r.device),
        p_source: rows.map((r) => r.source),
        p_kind: rows.map((r) => r.kind),
        p_channel: rows.map((r) => r.channel),
        p_ts: rows.map((r) => toEpochSeconds(r.ts, fallbackSeconds)),
        p_state: rows.map((r) => r.state)
    };
}

// Append numeric rows to the forever rollup. Isolated: never throws.
export async function appendNumeric(
    rows: readonly NumericRow[],
    deps: SensorCaptureDeps
): Promise<void> {
    if (rows.length === 0) return;
    try {
        await deps.callDb(
            'device_sensor.fn_append_numeric_15min',
            numericArgs(rows)
        );
    } catch (err) {
        Observability.incrementCounter('sensor_numeric_append_failed');
        logger.error(
            `sensor numeric append failed (status written, rollup skipped): ${
                err instanceof Error ? err.message : String(err)
            }`
        );
    }
}

// Append discrete events. Isolated: never throws.
export async function appendEvents(
    rows: readonly EventRow[],
    deps: SensorCaptureDeps
): Promise<void> {
    if (rows.length === 0) return;
    try {
        await deps.callDb('device_sensor.fn_append_events', eventArgs(rows));
    } catch (err) {
        Observability.incrementCounter('sensor_events_append_failed');
        logger.error(
            `sensor events append failed (dropped): ${
                err instanceof Error ? err.message : String(err)
            }`
        );
    }
}
