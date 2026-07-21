// Live + historical energy metrics for templates. One front door over two
// backend reads: energy.current (in-memory "now", polled) and energy.query
// (pre-aggregated history). The browser holds one value per scope — no
// per-device fan-out, no client-side summing.

import type {
    EnergyCurrentParams,
    EnergyCurrentResponse,
    EnergyQueryParams,
    EnergyQueryResponse,
    EnergyQueryRow
} from '@api/energy';
import {type ComputedRef, computed, onScopeDispose, type Ref, ref} from 'vue';
import {hostRpc} from './rpc';
import type {HostLoadState} from './types';

type EnergyScope = {groupId?: number; locationId?: number; tagId?: number};
type ScopeSelector = {scope?: EnergyScope; devices?: string[]};

// Types come straight from the backend API source (@api/energy), not the
// generated host contract, so this module owns no generated dependency.
type CurrentParams = EnergyCurrentParams;
type CurrentResult = EnergyCurrentResponse;
type QueryParams = EnergyQueryParams;
type QueryResult = EnergyQueryResponse;
type QueryRow = EnergyQueryRow;

// Floor on the live poll period — a template cannot hammer the backend
// faster than this, regardless of what it passes.
const MIN_INTERVAL_MS = 1000;
const DEFAULT_INTERVAL_MS = 3000;

// Imperative, one-shot reads. Use the composables below for reactive cards.
export const metrics = {
    current(params: CurrentParams = {}): Promise<CurrentResult> {
        return hostRpc<CurrentResult>('energy.current', params);
    },
    history(params: QueryParams): Promise<QueryResult> {
        return hostRpc<QueryResult>('energy.query', params);
    }
};

// --- Live -----------------------------------------------------------------

export type LiveMetricOptions = ScopeSelector & {
    /** Component-key allowlist, e.g. ['switch:0','switch:2']. */
    components?: string[];
    /** total = one number; device = per-device sums; channel = per-channel. */
    detail?: CurrentParams['detail'];
    /** Poll period (ms). Clamped to >= 1000. Default 3000. */
    intervalMs?: number;
    /** Begin polling on creation. Default true. */
    immediate?: boolean;
};

export type LiveMetric = {
    state: Ref<HostLoadState>;
    loading: ComputedRef<boolean>;
    /** Summed signed watts across the scope (export = negative). */
    watts: ComputedRef<number>;
    onlineDevices: ComputedRef<number>;
    data: Ref<CurrentResult | null>;
    error: Ref<string | null>;
    refresh: () => Promise<void>;
    start: () => void;
    stop: () => void;
};

export function useLiveMetric(options: LiveMetricOptions = {}): LiveMetric {
    const period = Math.max(
        MIN_INTERVAL_MS,
        options.intervalMs ?? DEFAULT_INTERVAL_MS
    );

    const state = ref<HostLoadState>('idle');
    const data = ref<CurrentResult | null>(null);
    const error = ref<string | null>(null);
    const loading = computed(() => state.value === 'loading');
    const watts = computed(() => data.value?.watts ?? 0);
    const onlineDevices = computed(() => data.value?.onlineDevices ?? 0);

    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    let disposed = false;
    let wantRunning = false;

    function params(): CurrentParams {
        return {
            ...(options.scope ? {scope: options.scope} : {}),
            ...(options.devices ? {devices: options.devices} : {}),
            ...(options.components ? {components: options.components} : {}),
            ...(options.detail ? {detail: options.detail} : {})
        };
    }

    async function refresh(): Promise<void> {
        // Skip overlapping ticks — a slow backend must not pile up requests.
        if (inFlight || disposed) return;
        inFlight = true;
        state.value = 'loading';
        try {
            const res = await metrics.current(params());
            if (disposed) return;
            data.value = res;
            error.value = null;
            state.value = 'ready';
        } catch (err) {
            if (disposed) return;
            error.value = err instanceof Error ? err.message : String(err);
            state.value = 'error';
        } finally {
            inFlight = false;
        }
    }

    function arm(): void {
        if (timer || disposed) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        timer = setInterval(() => void refresh(), period);
    }

    function disarm(): void {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    function start(): void {
        if (disposed) return;
        wantRunning = true;
        void refresh();
        arm();
    }

    function stop(): void {
        wantRunning = false;
        disarm();
    }

    // Pause polling while the tab is hidden; resume (and refresh once) when
    // it returns. Saves the backend the scope sum for invisible cards.
    function onVisibility(): void {
        if (disposed || !wantRunning) return;
        if (document.hidden) {
            disarm();
        } else {
            void refresh();
            arm();
        }
    }
    const hasDocument = typeof document !== 'undefined';
    if (hasDocument) {
        document.addEventListener('visibilitychange', onVisibility);
    }

    if (options.immediate ?? true) start();

    onScopeDispose(() => {
        disposed = true;
        stop();
        if (hasDocument) {
            document.removeEventListener('visibilitychange', onVisibility);
        }
    });

    return {
        state,
        loading,
        watts,
        onlineDevices,
        data,
        error,
        refresh,
        start,
        stop
    };
}

// --- History --------------------------------------------------------------

export type MetricHistoryOptions = ScopeSelector & {
    from: string;
    to: string;
    /** Defaults to ['power']. */
    tags?: QueryParams['tags'];
    bucket?: QueryParams['bucket'];
    perDevice?: boolean;
    perPhase?: boolean;
    /** Commodity filter — defaults to AC-mains electricity for a metric widget. */
    commodity?: QueryParams['commodity'];
    electricalSource?: QueryParams['electricalSource'];
    /** Fetch on creation. Default true. */
    immediate?: boolean;
};

export type MetricHistory = {
    state: Ref<HostLoadState>;
    loading: ComputedRef<boolean>;
    rows: ComputedRef<QueryRow[]>;
    data: Ref<QueryResult | null>;
    error: Ref<string | null>;
    refresh: () => Promise<void>;
};

export function useMetricHistory(options: MetricHistoryOptions): MetricHistory {
    const state = ref<HostLoadState>('idle');
    const data = ref<QueryResult | null>(null);
    const error = ref<string | null>(null);
    const loading = computed(() => state.value === 'loading');
    const rows = computed(() => data.value?.items ?? []);

    async function refresh(): Promise<void> {
        state.value = 'loading';
        try {
            const res = await metrics.history({
                from: options.from,
                to: options.to,
                tags: options.tags ?? ['power'],
                ...(options.bucket ? {bucket: options.bucket} : {}),
                ...(options.scope ? {scope: options.scope} : {}),
                ...(options.devices ? {devices: options.devices} : {}),
                ...(options.perDevice !== undefined
                    ? {perDevice: options.perDevice}
                    : {}),
                ...(options.perPhase !== undefined
                    ? {perPhase: options.perPhase}
                    : {}),
                // Default a metric widget to AC-mains electricity so DC never
                // mixes into a power/voltage chart; caller can override either.
                commodity: options.commodity ?? 'electricity',
                electricalSource: options.electricalSource ?? 'ac_mains'
            });
            data.value = res;
            error.value = null;
            state.value = 'ready';
        } catch (err) {
            error.value = err instanceof Error ? err.message : String(err);
            state.value = 'error';
        }
    }

    if (options.immediate ?? true) void refresh();
    return {state, loading, rows, data, error, refresh};
}

// --- Unified front door ---------------------------------------------------

export type UseMetricLiveOptions = LiveMetricOptions & {mode?: 'live'};
export type UseMetricHistoryOptions = MetricHistoryOptions & {mode: 'history'};

export function useMetric(options: UseMetricHistoryOptions): MetricHistory;
export function useMetric(options?: UseMetricLiveOptions): LiveMetric;
export function useMetric(
    options: UseMetricLiveOptions | UseMetricHistoryOptions = {}
): LiveMetric | MetricHistory {
    if ('mode' in options && options.mode === 'history') {
        return useMetricHistory(options);
    }
    return useLiveMetric(options);
}
