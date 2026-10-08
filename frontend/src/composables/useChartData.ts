import type {
    SensorQueryResponse,
    SensorQueryRow,
    SensorSource
} from '@api/sensor';
import {
    computed,
    type MaybeRefOrGetter,
    onScopeDispose,
    ref,
    toValue,
    watch
} from 'vue';
import * as ws from '@/tools/websocket';

export type ChartRange = '24h' | '7d' | '30d';

export type ChartMetric =
    | 'consumption'
    | 'returned_energy'
    | 'voltage'
    | 'current'
    | 'power'
    | 'apparent_power'
    | 'power_factor'
    | 'frequency'
    | 'total_power'
    | 'total_apparent_power'
    | 'total_current'
    | 'neutral_current'
    | 'temperature'
    | 'humidity'
    | 'luminance';

export interface ChartDataPoint {
    bucket: string;
    value: number;
    min?: number | null;
    max?: number | null;
}

// Legacy metric name → energy.query tag. Environmental metrics map 1:1;
// voltage/current historically merged min/max, which the new contract
// expresses via optional min/max fields on the env rows (and raw
// aggregation only on the energy rows, so min/max collapse away cleanly).
export const METRIC_TO_TAG: Record<ChartMetric, string> = {
    consumption: 'total_act_energy',
    returned_energy: 'total_act_ret_energy',
    voltage: 'voltage',
    current: 'current',
    power: 'power',
    apparent_power: 'apparent_power',
    power_factor: 'power_factor',
    frequency: 'frequency',
    total_power: 'total_power',
    total_apparent_power: 'total_apparent_power',
    total_current: 'total_current',
    neutral_current: 'neutral_current',
    temperature: 'temperature',
    humidity: 'humidity',
    luminance: 'luminance'
};

// Environmental metrics come from the sensor rollup (Sensor.Query), not the
// energy tables — so they read the same source, channel and kind the Environment
// dashboard uses. The ChartMetric maps to its stored sensor kind (lux is stored
// as 'illuminance'). Absent here → an energy metric, served by energy.query.
const METRIC_TO_SENSOR_KIND: Partial<Record<ChartMetric, string>> = {
    temperature: 'temperature',
    humidity: 'humidity',
    luminance: 'illuminance'
};

// One entity is one sensor channel; a device reports many. Fold the kind's rows
// for the window into one point per bucket, sample-weighted like the rollup.
function bucketSensorRows(
    rows: SensorQueryRow[],
    channel: number | undefined
): ChartDataPoint[] {
    const byBucket = new Map<
        string,
        {wsum: number; samples: number; min: number; max: number}
    >();
    for (const row of rows) {
        if (channel != null && row.channel != null && row.channel !== channel) {
            continue;
        }
        const acc = byBucket.get(row.bucket) ?? {
            wsum: 0,
            samples: 0,
            min: Number.POSITIVE_INFINITY,
            max: Number.NEGATIVE_INFINITY
        };
        acc.wsum += row.value * row.sampleCount;
        acc.samples += row.sampleCount;
        acc.min = Math.min(acc.min, row.min ?? row.value);
        acc.max = Math.max(acc.max, row.max ?? row.value);
        byBucket.set(row.bucket, acc);
    }
    return [...byBucket.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, a]) => ({
            bucket,
            value: a.samples > 0 ? a.wsum / a.samples : 0,
            min: Number.isFinite(a.min) ? a.min : null,
            max: Number.isFinite(a.max) ? a.max : null
        }));
}

// Fallback for sensor entities whose measured quantity is known from the type
// before live status has loaded.
const ENTITY_CHART_METRIC: Readonly<Record<string, ChartMetric>> = {
    em: 'power',
    em1: 'power',
    pm1: 'power',
    temperature: 'temperature',
    humidity: 'humidity',
    illuminance: 'luminance'
};

// Energy meters — energy history lives on a sibling component (an EM splits
// instantaneous `em` from cumulative `emdata`), so it is added by type, not read
// from the live status.
const METER_TYPES = new Set(['em', 'em1', 'pm1']);

function hasPower(s: Record<string, unknown>): boolean {
    return s.apower != null || s.act_power != null || s.total_act_power != null;
}

// Every quantity an entity measures and we keep history for, in display order:
// core readings first, then power-quality diagnostics. Detected from the fields
// the device actually reports (a 3-phase EM exposes device totals; a light
// reports no power factor), so each device charts exactly what it measures — no
// hardcoded per-device table. Empty for an input or a virtual boolean.
export function entityChartMetrics(
    entityType: string,
    status?: Record<string, unknown>
): ChartMetric[] {
    const s = status ?? {};
    const has = (...keys: string[]) => keys.some((k) => s[k] != null);

    if (METER_TYPES.has(entityType) || hasPower(s)) {
        const out: ChartMetric[] = [];
        // Core: active power, energy, line voltage and current.
        if (s.total_act_power != null) out.push('total_power');
        else if (has('apower', 'act_power')) out.push('power');
        out.push('consumption');
        if (METER_TYPES.has(entityType)) out.push('returned_energy');
        if (has('voltage', 'a_voltage')) out.push('voltage');
        if (has('total_current')) out.push('total_current');
        else if (has('current', 'a_current')) out.push('current');
        // Power quality: only what this device reports.
        if (has('total_aprt_power')) out.push('total_apparent_power');
        else if (has('aprt_power', 'aprtpower')) out.push('apparent_power');
        if (has('pf', 'a_pf')) out.push('power_factor');
        if (has('freq', 'a_freq')) out.push('frequency');
        if (has('n_current')) out.push('neutral_current');
        return out;
    }

    const env: ChartMetric[] = [];
    if (s.tC != null) env.push('temperature');
    if (s.rh != null) env.push('humidity');
    if (s.lux != null || s.illuminance != null) env.push('luminance');
    if (env.length) return env;

    const byType = ENTITY_CHART_METRIC[entityType];
    return byType ? [byType] : [];
}

interface EnergyQueryResponse {
    items: Array<{
        bucket: string;
        value: number;
        min?: number | null;
        max?: number | null;
    }>;
}

export function rangeToParams(range: ChartRange): {
    from: string;
    to: string;
    bucket: '1 hour' | '1 day';
} {
    const now = new Date();
    const to = now.toISOString();
    let msBack: number;
    let bucket: '1 hour' | '1 day';

    switch (range) {
        case '24h':
            msBack = 24 * 60 * 60 * 1000;
            bucket = '1 hour';
            break;
        case '7d':
            msBack = 7 * 24 * 60 * 60 * 1000;
            bucket = '1 hour';
            break;
        case '30d':
            msBack = 30 * 24 * 60 * 60 * 1000;
            bucket = '1 day';
            break;
        default:
            msBack = 24 * 60 * 60 * 1000;
            bucket = '1 hour';
            break;
    }

    const from = new Date(now.getTime() - msBack).toISOString();
    return {from, to, bucket};
}

/**
 * Composable for fetching per-device metric history for time-series chart cards.
 * Energy metrics go through `energy.query`; environmental metrics go through
 * `sensor.query`, filtered to the entity's `channel` when given. Returns full
 * DataPoint[] with optional min/max for shaded band rendering.
 *
 * `source` is the entity's own `sensorSource`. Leaving it off charts the
 * ambient sources, which is what an environmental chart means; a card for a
 * device's chip temperature passes 'internal' to chart device health instead.
 */
export function useChartData(
    shellyId: MaybeRefOrGetter<string | undefined>,
    metric: MaybeRefOrGetter<ChartMetric>,
    range: MaybeRefOrGetter<ChartRange>,
    channel?: MaybeRefOrGetter<number | undefined>,
    source?: MaybeRefOrGetter<SensorSource | undefined>
) {
    const data = ref<ChartDataPoint[]>([]);
    const loading = ref(false);
    const error = ref(false);
    const granularity = ref<'hour' | 'day'>('hour');
    let disposed = false;
    let abortId = 0;

    async function fetch() {
        const id = toValue(shellyId);
        if (!id) {
            data.value = [];
            return;
        }

        const thisCall = ++abortId;
        loading.value = true;
        error.value = false;

        try {
            const params = rangeToParams(toValue(range));
            const m = toValue(metric);
            const sensorKind = METRIC_TO_SENSOR_KIND[m];

            if (sensorKind) {
                const result = await ws.sendRPC<SensorQueryResponse>(
                    'FLEET_MANAGER',
                    'sensor.query',
                    {
                        devices: [id],
                        from: params.from,
                        to: params.to,
                        kinds: [sensorKind],
                        bucket: params.bucket,
                        ...(toValue(source) ? {source: toValue(source)} : {})
                    }
                );
                if (disposed || thisCall !== abortId) return;
                data.value = bucketSensorRows(
                    result?.items ?? [],
                    toValue(channel)
                );
            } else {
                const result = await ws.sendRPC<EnergyQueryResponse>(
                    'FLEET_MANAGER',
                    'energy.query',
                    {
                        devices: [id],
                        from: params.from,
                        to: params.to,
                        tags: [METRIC_TO_TAG[m]],
                        bucket: params.bucket,
                        perDevice: false
                    }
                );
                if (disposed || thisCall !== abortId) return;
                data.value = (result?.items ?? []).map((p) => ({
                    bucket: p.bucket,
                    value: p.value,
                    min: p.min ?? null,
                    max: p.max ?? null
                }));
            }
            granularity.value = params.bucket === '1 hour' ? 'hour' : 'day';
        } catch {
            if (disposed || thisCall !== abortId) return;
            error.value = true;
            data.value = [];
        } finally {
            if (!disposed && thisCall === abortId) {
                loading.value = false;
            }
        }
    }

    const trigger = computed(() => ({
        id: toValue(shellyId),
        m: toValue(metric),
        r: toValue(range),
        c: toValue(channel),
        s: toValue(source)
    }));

    watch(trigger, () => fetch(), {immediate: true});

    onScopeDispose(() => {
        disposed = true;
    });

    return {data, loading, error, granularity, refresh: fetch};
}
