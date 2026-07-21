// Pure statistics for the environment report. No I/O, no `this` — every function
// is a deterministic fold over the sensor readings, so the report's headline
// numbers (per-kind and per-sensor avg/min/max, comfort-in-band %, threshold
// breaches, data completeness) are unit-testable from a fixture.
//
// Readings are the same rows Sensor.Query returns (device_sensor.numeric_15min
// re-bucketed): one row per (bucket, device, kind, source) carrying the bucket
// avg plus true min/max.

import type {SensorQueryRow} from '../../types/api/sensor';

export type EnvironmentReading = SensorQueryRow;

// The sensor kinds this report reads from the 15-minute rollup. One DB fan-out
// per kind (mirrors Sensor.Query). Vocabulary matches device_sensor.numeric_15min.
export const ENVIRONMENT_REPORT_KINDS = [
    'temperature',
    'humidity',
    'illuminance',
    'co2',
    'tvoc',
    'pm25',
    'pm10',
    'pressure',
    'dewpoint',
    'uv',
    'wind_speed',
    'precipitation',
    'moisture',
    'battery'
] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_REPORT_KINDS)[number];

// Section grouping — which kinds belong to each report section. Air Quality and
// Weather render only when at least one of their kinds has data, the same way
// the energy report gates its Solar/Battery sections on role presence.
export const COMFORT_KINDS = ['temperature', 'humidity', 'dewpoint'] as const;
export const AIR_QUALITY_KINDS = ['co2', 'tvoc', 'pm25', 'pm10'] as const;
export const LIGHT_KINDS = ['illuminance', 'uv'] as const;
export const WEATHER_KINDS = [
    'pressure',
    'wind_speed',
    'precipitation',
    'moisture'
] as const;

// Display unit per kind — the sensor's native unit as stored in the rollup.
export const ENVIRONMENT_UNITS: Readonly<Record<string, string>> = {
    temperature: '°C',
    humidity: '%',
    dewpoint: '°C',
    illuminance: 'lx',
    uv: 'index',
    co2: 'ppm',
    tvoc: 'ppb',
    pm25: 'µg/m³',
    pm10: 'µg/m³',
    pressure: 'hPa',
    wind_speed: 'm/s',
    precipitation: 'mm',
    moisture: '%',
    battery: '%'
};

// Comfort bands — the report's default acceptable ranges for the occupied
// comfort window (ASHRAE-55 style). Passed in so dashboard settings can supply
// site-specific bands later; defaulted here, never read from a hardcoded literal
// at the call site.
export interface ComfortBands {
    tempMinC: number;
    tempMaxC: number;
    humidityMinPct: number;
    humidityMaxPct: number;
}
export const DEFAULT_COMFORT_BANDS: ComfortBands = {
    tempMinC: 20,
    tempMaxC: 24,
    humidityMinPct: 30,
    humidityMaxPct: 60
};

// Threshold table for the breach section. min/max form the acceptable band; a
// bucket outside it counts as a breach. Defaults follow common indoor-air /
// WHO guidance; overridable like the comfort bands.
export interface KindThreshold {
    min?: number;
    max?: number;
    label: string;
}
export const DEFAULT_THRESHOLDS: Readonly<Record<string, KindThreshold>> = {
    temperature: {min: 20, max: 24, label: 'Temperature out of comfort band'},
    // 70% is the sustained-humidity mold-risk ceiling.
    humidity: {min: 30, max: 70, label: 'Humidity out of range'},
    co2: {max: 1000, label: 'CO₂ elevated'},
    tvoc: {max: 250, label: 'TVOC elevated'},
    pm25: {max: 15, label: 'PM2.5 above WHO 24h guideline'},
    pm10: {max: 45, label: 'PM10 above WHO 24h guideline'}
};

export interface KindStat {
    kind: string;
    avg: number;
    min: number;
    max: number;
    /** Number of buckets that fed this stat. */
    samples: number;
}

// avg = mean of bucket averages (buckets are equal-width, so equal-weight);
// min/max = extremes of the buckets' true min/max (falling back to the bucket
// avg when a bucket carries no min/max).
export function aggregateByKind(
    readings: readonly EnvironmentReading[]
): Map<string, KindStat> {
    const acc = new Map<
        string,
        {sum: number; count: number; min: number; max: number}
    >();
    for (const r of readings) {
        const cur = acc.get(r.kind) ?? {
            sum: 0,
            count: 0,
            min: Number.POSITIVE_INFINITY,
            max: Number.NEGATIVE_INFINITY
        };
        cur.sum += r.value;
        cur.count += 1;
        cur.min = Math.min(cur.min, r.min ?? r.value);
        cur.max = Math.max(cur.max, r.max ?? r.value);
        acc.set(r.kind, cur);
    }
    const out = new Map<string, KindStat>();
    for (const [kind, a] of acc) {
        out.set(kind, {
            kind,
            avg: a.sum / a.count,
            min: a.min,
            max: a.max,
            samples: a.count
        });
    }
    return out;
}

export interface SensorKindStat extends KindStat {
    device: number;
    shellyID: string | null;
    source: string;
    channel: number | null;
}

// Same aggregation as aggregateByKind but keyed per physical sensor stream.
export function aggregateBySensor(
    readings: readonly EnvironmentReading[]
): SensorKindStat[] {
    const acc = new Map<
        string,
        {
            device: number;
            shellyID: string | null;
            source: string;
            channel: number | null;
            kind: string;
            sum: number;
            count: number;
            min: number;
            max: number;
        }
    >();
    for (const r of readings) {
        const key = `${r.device} ${r.kind} ${r.source} ${r.channel ?? 'none'}`;
        const cur = acc.get(key) ?? {
            device: r.device,
            shellyID: r.shellyID,
            source: r.source,
            channel: r.channel,
            kind: r.kind,
            sum: 0,
            count: 0,
            min: Number.POSITIVE_INFINITY,
            max: Number.NEGATIVE_INFINITY
        };
        cur.sum += r.value;
        cur.count += 1;
        cur.min = Math.min(cur.min, r.min ?? r.value);
        cur.max = Math.max(cur.max, r.max ?? r.value);
        acc.set(key, cur);
    }
    return [...acc.values()]
        .map((a) => ({
            kind: a.kind,
            device: a.device,
            shellyID: a.shellyID,
            source: a.source,
            channel: a.channel,
            avg: a.sum / a.count,
            min: a.min,
            max: a.max,
            samples: a.count
        }))
        .sort(
            (a, b) =>
                a.kind.localeCompare(b.kind) ||
                (a.shellyID ?? '').localeCompare(b.shellyID ?? '') ||
                (a.channel ?? -1) - (b.channel ?? -1)
        );
}

export interface InBandResult {
    /** null when no buckets qualified. */
    pct: number | null;
    buckets: number;
    inBand: number;
}

// Fraction of a single kind's buckets whose value sits inside [min, max].
export function kindInBandPct(
    readings: readonly EnvironmentReading[],
    kind: string,
    min: number,
    max: number
): InBandResult {
    let buckets = 0;
    let inBand = 0;
    for (const r of readings) {
        if (r.kind !== kind) continue;
        buckets += 1;
        if (r.value >= min && r.value <= max) inBand += 1;
    }
    return {
        pct: buckets > 0 ? (inBand / buckets) * 100 : null,
        buckets,
        inBand
    };
}

// Comfort = fraction of bucket timestamps where BOTH the mean temperature and
// the mean humidity across in-scope sensors sit inside their bands. Joining by
// bucket (mean per bucket) keeps the score well-defined when several sensors
// report the same timestamp.
export function comfortInBandPct(
    readings: readonly EnvironmentReading[],
    bands: ComfortBands = DEFAULT_COMFORT_BANDS
): InBandResult {
    const temp = meanByBucket(readings, 'temperature');
    const hum = meanByBucket(readings, 'humidity');
    let buckets = 0;
    let inBand = 0;
    for (const [bucket, t] of temp) {
        const h = hum.get(bucket);
        if (h === undefined) continue;
        buckets += 1;
        if (
            t >= bands.tempMinC &&
            t <= bands.tempMaxC &&
            h >= bands.humidityMinPct &&
            h <= bands.humidityMaxPct
        ) {
            inBand += 1;
        }
    }
    return {
        pct: buckets > 0 ? (inBand / buckets) * 100 : null,
        buckets,
        inBand
    };
}

function meanByBucket(
    readings: readonly EnvironmentReading[],
    kind: string
): Map<string, number> {
    const acc = new Map<string, {sum: number; count: number}>();
    for (const r of readings) {
        if (r.kind !== kind) continue;
        const cur = acc.get(r.bucket) ?? {sum: 0, count: 0};
        cur.sum += r.value;
        cur.count += 1;
        acc.set(r.bucket, cur);
    }
    const out = new Map<string, number>();
    for (const [bucket, a] of acc) out.set(bucket, a.sum / a.count);
    return out;
}

export interface BreachStat {
    kind: string;
    label: string;
    breaches: number;
    total: number;
}

// Per-kind count of buckets that fall outside the kind's threshold band. Only
// kinds present in the readings and carrying a threshold are returned.
export function countThresholdBreaches(
    readings: readonly EnvironmentReading[],
    thresholds: Readonly<Record<string, KindThreshold>> = DEFAULT_THRESHOLDS
): BreachStat[] {
    const acc = new Map<string, {breaches: number; total: number}>();
    for (const r of readings) {
        const th = thresholds[r.kind];
        if (!th) continue;
        const cur = acc.get(r.kind) ?? {breaches: 0, total: 0};
        cur.total += 1;
        const overMax = th.max !== undefined && r.value > th.max;
        const underMin = th.min !== undefined && r.value < th.min;
        if (overMax || underMin) cur.breaches += 1;
        acc.set(r.kind, cur);
    }
    return [...acc.entries()]
        .map(([kind, v]) => ({
            kind,
            label: thresholds[kind].label,
            breaches: v.breaches,
            total: v.total
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind));
}

export interface CompletenessStat {
    kind: string;
    distinctBuckets: number;
    expectedBuckets: number;
    /** Capped at 100 — extra buckets (multiple sources) never exceed full. */
    completenessPct: number;
}

// Coverage per kind: distinct bucket timestamps present vs the number of buckets
// the window should hold at the chosen bucket size. Surfaces gaps in the record.
export function completenessByKind(
    readings: readonly EnvironmentReading[],
    expectedBuckets: number
): CompletenessStat[] {
    const bucketsByKind = new Map<string, Set<string>>();
    for (const r of readings) {
        const set = bucketsByKind.get(r.kind) ?? new Set<string>();
        set.add(r.bucket);
        bucketsByKind.set(r.kind, set);
    }
    return [...bucketsByKind.entries()]
        .map(([kind, set]) => ({
            kind,
            distinctBuckets: set.size,
            expectedBuckets,
            completenessPct:
                expectedBuckets > 0
                    ? Math.min(100, (set.size / expectedBuckets) * 100)
                    : 0
        }))
        .sort((a, b) => a.kind.localeCompare(b.kind));
}

// Number of buckets the window holds at the given bucket size — the denominator
// for completeness. Parses the same "N unit" strings GRANULARITY_MAP produces.
export function expectedBucketCount(
    from: Date,
    to: Date,
    bucket: string
): number {
    const ms = bucketDurationMs(bucket);
    if (ms <= 0) return 0;
    const span = to.getTime() - from.getTime();
    if (span <= 0) return 0;
    return Math.max(1, Math.floor(span / ms));
}

const UNIT_MS: Readonly<Record<string, number>> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    // Nominal month for coverage math only (not a calendar month).
    month: 30 * 86_400_000
};

function bucketDurationMs(bucket: string): number {
    const [countRaw, unitRaw] = bucket.trim().split(/\s+/);
    const count = Number.parseInt(countRaw, 10);
    if (!Number.isFinite(count) || count <= 0 || !unitRaw) return 0;
    const unit = unitRaw.replace(/s$/, '');
    const unitMs = UNIT_MS[unit];
    return unitMs ? count * unitMs : 0;
}

// ── Discrete events: presence & safety ──
//
// One row per device_sensor.events record (binary sensors on state change,
// buttons every push). The kind families and alarm rule mirror the dashboard's
// presence + safety tabs (frontend environmentDashboard.types.ts) — separate
// tiers, so the vocabulary is duplicated the same way ENVIRONMENT_UNITS mirrors
// the frontend's ENV_KIND_META.

export interface EnvironmentEvent {
    /** ISO-8601 event timestamp. */
    ts: string;
    device: number;
    shellyID: string | null;
    kind: string;
    /** Binary sensors 0/1; buttons carry the push code (1-4). */
    state: number;
    source: string;
}

export const PRESENCE_EVENT_KINDS = [
    'occupancy',
    'motion',
    'door',
    'window',
    'button'
] as const;
export const SAFETY_EVENT_KINDS = [
    'flood',
    'smoke',
    'gas',
    'co',
    'vibration'
] as const;

export const EVENT_KIND_LABELS: Readonly<Record<string, string>> = {
    occupancy: 'Occupancy',
    motion: 'Motion',
    door: 'Door',
    window: 'Window',
    button: 'Button',
    flood: 'Water leak',
    smoke: 'Smoke',
    gas: 'Gas',
    co: 'Carbon monoxide',
    vibration: 'Vibration'
};

// state ≥ 1 is active/open/alarm; buttons carry a push code (also ≥ 1).
const EVENT_ACTIVE_STATE = 1;

function eventLabel(kind: string): string {
    return EVENT_KIND_LABELS[kind] ?? kind;
}

export interface ActivityStat {
    kind: string;
    label: string;
    count: number;
    /** ISO timestamp of the most recent event of this kind, null when none. */
    lastTs: string | null;
}

// Per-kind activity counts across the fleet, busiest kind first. Non-presence
// kinds are ignored.
export function aggregatePresence(
    events: readonly EnvironmentEvent[]
): ActivityStat[] {
    const set = new Set<string>(PRESENCE_EVENT_KINDS);
    const acc = new Map<string, {count: number; lastTs: string | null}>();
    for (const e of events) {
        if (!set.has(e.kind)) continue;
        const cur = acc.get(e.kind) ?? {count: 0, lastTs: null};
        cur.count += 1;
        if (!cur.lastTs || e.ts > cur.lastTs) cur.lastTs = e.ts;
        acc.set(e.kind, cur);
    }
    return [...acc.entries()]
        .map(([kind, v]) => ({
            kind,
            label: eventLabel(kind),
            count: v.count,
            lastTs: v.lastTs
        }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export type SafetyStatus = 'clear' | 'alarm';

export interface SafetySensorStat {
    device: number;
    shellyID: string | null;
    kind: string;
    label: string;
    /** Derived from the latest event of this device+kind stream. */
    status: SafetyStatus;
    /** Alarm events (state ≥ 1) in the window. */
    alarms: number;
    lastTs: string | null;
}

// Per-(device, kind) safety status from the latest event of each stream; alarm
// streams sort first. Non-safety kinds are ignored.
export function aggregateSafety(
    events: readonly EnvironmentEvent[]
): SafetySensorStat[] {
    const set = new Set<string>(SAFETY_EVENT_KINDS);
    const byStream = new Map<string, EnvironmentEvent[]>();
    for (const e of events) {
        if (!set.has(e.kind)) continue;
        const key = `${e.device}:${e.kind}`;
        const arr = byStream.get(key) ?? [];
        arr.push(e);
        byStream.set(key, arr);
    }
    return [...byStream.values()]
        .map((evs) => {
            // On an identical timestamp, the alarm (higher state) is treated as
            // latest so a same-instant clear never masks an active alarm.
            const sorted = [...evs].sort(
                (a, b) => a.ts.localeCompare(b.ts) || a.state - b.state
            );
            const last = sorted[sorted.length - 1];
            const alarms = evs.filter(
                (e) => e.state >= EVENT_ACTIVE_STATE
            ).length;
            return {
                device: last.device,
                shellyID: last.shellyID,
                kind: last.kind,
                label: eventLabel(last.kind),
                status: (last.state >= EVENT_ACTIVE_STATE
                    ? 'alarm'
                    : 'clear') as SafetyStatus,
                alarms,
                lastTs: last.ts
            };
        })
        .sort(
            (a, b) =>
                Number(b.status === 'alarm') - Number(a.status === 'alarm') ||
                (a.shellyID ?? '').localeCompare(b.shellyID ?? '')
        );
}
