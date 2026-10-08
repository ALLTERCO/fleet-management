// The metric family for React. The poller lives in core/live-metric, so this
// file only binds one source to a mount and reads its snapshot.

import type {EnergyCurrentResponse, EnergyQueryResponse} from '@api/energy';
import {
    createLiveMetric,
    createMetricHistory,
    type LiveMetricOptions,
    type MetricHistoryOptions,
    type MetricSnapshot,
    type MetricSource
} from '../../core/live-metric';
import type {HostLoadState} from '../../core/types';
import {useFleetRuntime} from '../FleetProvider';
import {useFleetStore} from './useFleetStore';
import {useRetained} from './useRetained';

export type UseLiveMetricResult = {
    state: HostLoadState;
    loading: boolean;
    /** Summed signed watts across the scope (export = negative). */
    watts: number;
    onlineDevices: number;
    data: EnergyCurrentResponse | null;
    error: string | null;
    refresh: () => Promise<void>;
    start: () => void;
    stop: () => void;
};

export type UseMetricHistoryResult = {
    state: HostLoadState;
    loading: boolean;
    rows: EnergyQueryResponse['items'];
    data: EnergyQueryResponse | null;
    error: string | null;
    refresh: () => Promise<void>;
};

export type UseMetricLiveOptions = LiveMetricOptions & {mode?: 'live'};
export type UseMetricHistoryOptions = MetricHistoryOptions & {
    mode: 'history';
};

type MetricRequest = UseMetricLiveOptions | UseMetricHistoryOptions;

function isHistory(options: MetricRequest): options is UseMetricHistoryOptions {
    return 'mode' in options && options.mode === 'history';
}

export function useMetric(
    options: UseMetricHistoryOptions
): UseMetricHistoryResult;
export function useMetric(options?: UseMetricLiveOptions): UseLiveMetricResult;
export function useMetric(
    options: MetricRequest = {}
): UseLiveMetricResult | UseMetricHistoryResult {
    const runtime = useFleetRuntime();
    // The options object is a fresh literal every render; what changes the
    // request is its content, so that is the identity the source is kept by.
    const request = JSON.stringify(options);
    const source = useRetained<MetricSource>(
        () =>
            isHistory(options)
                ? createMetricHistory({
                      ...options,
                      read: (params) => runtime.fleet.energy.history(params)
                  })
                : createLiveMetric({
                      ...options,
                      read: (params) => runtime.fleet.energy.current(params)
                  }),
        [runtime, request]
    );
    const snapshot: MetricSnapshot = useFleetStore(source);

    if (snapshot.kind === 'history') {
        return {
            state: snapshot.status,
            loading: snapshot.status === 'loading',
            rows: snapshot.data?.items ?? [],
            data: snapshot.data,
            error: snapshot.error,
            refresh: source.refresh
        };
    }
    return {
        state: snapshot.status,
        loading: snapshot.status === 'loading',
        watts: snapshot.data?.watts ?? 0,
        onlineDevices: snapshot.data?.onlineDevices ?? 0,
        data: snapshot.data,
        error: snapshot.error,
        refresh: source.refresh,
        start: source.start,
        stop: source.stop
    };
}

export function useLiveMetric(
    options: LiveMetricOptions = {}
): UseLiveMetricResult {
    return useMetric(options);
}

export function useMetricHistory(
    options: MetricHistoryOptions
): UseMetricHistoryResult {
    return useMetric({...options, mode: 'history'});
}
