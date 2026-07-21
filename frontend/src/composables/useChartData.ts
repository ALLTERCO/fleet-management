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
    temperature: 'temperature',
    humidity: 'humidity',
    luminance: 'luminance'
};

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
 * Wraps `energy.query` — supports energy and environmental metrics.
 * Returns full DataPoint[] with optional min/max for shaded band rendering.
 */
export function useChartData(
    shellyId: MaybeRefOrGetter<string | undefined>,
    metric: MaybeRefOrGetter<ChartMetric>,
    range: MaybeRefOrGetter<ChartRange>
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
        r: toValue(range)
    }));

    watch(trigger, () => fetch(), {immediate: true});

    onScopeDispose(() => {
        disposed = true;
    });

    return {data, loading, error, granularity, refresh: fetch};
}
