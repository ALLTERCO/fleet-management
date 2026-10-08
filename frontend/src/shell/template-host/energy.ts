// Live and historical energy for templates: one front door over energy.current
// (in-memory now) and energy.query (pre-aggregated history). The polling and
// the query defaults live in core/live-metric; this file is only the Vue skin.

import type {
    EnergyCurrentResponse,
    EnergyQueryResponse,
    EnergyQueryRow
} from '@api/energy';
import {type ComputedRef, computed, onScopeDispose, type Ref, ref} from 'vue';
import {hostRpcAccess} from './api';
import {createEnergyDomain} from './core/domains/energy';
import {
    createLiveMetric,
    createMetricHistory,
    type LiveMetricOptions,
    type MetricHistoryOptions
} from './core/live-metric';
import type {HostLoadState} from './types';

export type {LiveMetricOptions, MetricHistoryOptions};

// Types come straight from the backend API source (@api/energy), not the
// generated host contract, so this module owns no generated dependency.
type CurrentResult = EnergyCurrentResponse;
type QueryResult = EnergyQueryResponse;
type QueryRow = EnergyQueryRow;

// Imperative, one-shot reads. Use the composables below for reactive cards.
export const metrics = createEnergyDomain(hostRpcAccess);

// --- Live -----------------------------------------------------------------

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
    const source = createLiveMetric({
        ...options,
        read: (params) => metrics.current(params)
    });

    const state = ref<HostLoadState>('idle');
    const data = ref<CurrentResult | null>(null);
    const error = ref<string | null>(null);
    const loading = computed(() => state.value === 'loading');
    const watts = computed(() => data.value?.watts ?? 0);
    const onlineDevices = computed(() => data.value?.onlineDevices ?? 0);

    function sync(): void {
        const snapshot = source.getSnapshot();
        state.value = snapshot.status;
        data.value = snapshot.data;
        error.value = snapshot.error;
    }

    sync();
    const release = source.subscribe(sync);
    source.attach();

    onScopeDispose(() => {
        release();
        source.dispose();
    });

    return {
        state,
        loading,
        watts,
        onlineDevices,
        data,
        error,
        refresh: source.refresh,
        start: source.start,
        stop: source.stop
    };
}

// --- History --------------------------------------------------------------

export type MetricHistory = {
    state: Ref<HostLoadState>;
    loading: ComputedRef<boolean>;
    rows: ComputedRef<QueryRow[]>;
    data: Ref<QueryResult | null>;
    error: Ref<string | null>;
    refresh: () => Promise<void>;
};

export function useMetricHistory(options: MetricHistoryOptions): MetricHistory {
    const source = createMetricHistory({
        ...options,
        read: (params) => metrics.history(params)
    });

    const state = ref<HostLoadState>('idle');
    const data = ref<QueryResult | null>(null);
    const error = ref<string | null>(null);
    const loading = computed(() => state.value === 'loading');
    const rows = computed(() => data.value?.items ?? []);

    function sync(): void {
        const snapshot = source.getSnapshot();
        state.value = snapshot.status;
        data.value = snapshot.data;
        error.value = snapshot.error;
    }

    sync();
    // Nothing to release: the store, these refs and the caller's handle are
    // reachable only from each other, so they are collected together.
    source.subscribe(sync);
    source.attach();

    return {state, loading, rows, data, error, refresh: source.refresh};
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
