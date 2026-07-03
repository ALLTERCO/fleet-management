import * as log4js from 'log4js';
import {tuning} from '../../config/tuning';
import type {PrincipalType} from '../../types';
import {BoundedMap} from '../boundedMap';
import {incrementLabeledCounter} from './counters';
import {mirrorLabeledCounter, mirrorLabeledGauge} from './processMetrics';
import {getLevel} from './samplers';
import {dbTimings, rpcTimings} from './state';
import type {RpcMethodStats} from './types';
import {percentile} from './util/percentile';
import {pushRing} from './util/ringBuffer';
import {
    capSeriesSize,
    dropExpiredBefore,
    type TimestampedSample
} from './util/timeWindowSeries';

const logger = log4js.getLogger('Observability');
let lastSeriesWarnAt = 0;

// A single bad series (e.g. a NaN prom-client rejects) degrades only that
// label, not the whole scrape; warns are rate-limited to avoid log floods.
function emitPerMethod(
    timings: BoundedMap<string, RpcMethodStats>,
    metric: string,
    emit: (method: string, s: RpcMethodStats) => void
): void {
    for (const [method, s] of timings) {
        try {
            emit(method, s);
        } catch (err) {
            const now = Date.now();
            if (
                now - lastSeriesWarnAt >=
                tuning.observability.getterWarnMinIntervalMs
            ) {
                lastSeriesWarnAt = now;
                logger.warn(
                    'Skipping bad metric series %s{method=%s}: %s',
                    metric,
                    method,
                    err instanceof Error ? err.message : String(err)
                );
            }
        }
    }
}

function avgMs(s: RpcMethodStats): number {
    return s.count > 0 ? Math.round(s.totalMs / s.count) : 0;
}

mirrorLabeledCounter('fm_rpc_calls_total', 'Total RPC calls per method', (c) =>
    emitPerMethod(rpcTimings, 'fm_rpc_calls_total', (method, s) =>
        c.inc({method}, s.count)
    )
);
mirrorLabeledCounter(
    'fm_rpc_duration_ms_total',
    'Total RPC duration per method in ms',
    (c) =>
        emitPerMethod(rpcTimings, 'fm_rpc_duration_ms_total', (method, s) =>
            c.inc({method}, Math.round(s.totalMs))
        )
);
mirrorLabeledGauge(
    'fm_rpc_duration_ms_max',
    'Max RPC duration per method in ms',
    (g) =>
        emitPerMethod(rpcTimings, 'fm_rpc_duration_ms_max', (method, s) =>
            g.set({method}, Math.round(s.maxMs))
        )
);
mirrorLabeledGauge(
    'fm_rpc_duration_ms_avg',
    'Avg RPC duration per method in ms',
    (g) =>
        emitPerMethod(rpcTimings, 'fm_rpc_duration_ms_avg', (method, s) =>
            g.set({method}, avgMs(s))
        )
);
mirrorLabeledCounter('fm_db_calls_total', 'Total DB calls per query', (c) =>
    emitPerMethod(dbTimings, 'fm_db_calls_total', (method, s) =>
        c.inc({method}, s.count)
    )
);
mirrorLabeledCounter(
    'fm_db_duration_ms_total',
    'Total DB duration per query in ms',
    (c) =>
        emitPerMethod(dbTimings, 'fm_db_duration_ms_total', (method, s) =>
            c.inc({method}, Math.round(s.totalMs))
        )
);
mirrorLabeledGauge(
    'fm_db_duration_ms_max',
    'Max DB duration per query in ms',
    (g) =>
        emitPerMethod(dbTimings, 'fm_db_duration_ms_max', (method, s) =>
            g.set({method}, Math.round(s.maxMs))
        )
);
mirrorLabeledGauge(
    'fm_db_duration_ms_avg',
    'Avg DB duration per query in ms',
    (g) =>
        emitPerMethod(dbTimings, 'fm_db_duration_ms_avg', (method, s) =>
            g.set({method}, avgMs(s))
        )
);

function recordTiming(
    timings: BoundedMap<string, RpcMethodStats>,
    method: string,
    durationMs: number
): void {
    if (getLevel() < 2) return;
    let stats = timings.get(method);
    if (!stats) {
        stats = {
            count: 0,
            totalMs: 0,
            maxMs: 0,
            minMs: Number.POSITIVE_INFINITY
        };
        timings.set(method, stats);
    }
    stats.count++;
    stats.totalMs += durationMs;
    if (durationMs > stats.maxMs) stats.maxMs = durationMs;
    if (durationMs < stats.minMs) stats.minMs = durationMs;
}

export function recordRpcTiming(method: string, durationMs: number): void {
    recordTiming(rpcTimings, method, durationMs);
}

export function recordDbTiming(method: string, durationMs: number): void {
    recordTiming(dbTimings, method, durationMs);
}

// An entry is pushed when a method exceeds its rolling P95 + offset.
export interface SlowRpcEntry {
    method: string;
    ms: number;
    ts: number;
    sender?: string;
    senderType?: PrincipalType;
    organizationId?: string;
}

export interface RpcCompletion {
    method: string;
    ms: number;
    sender?: string;
    senderType?: PrincipalType;
    organizationId?: string;
}

const slowRpcRing: SlowRpcEntry[] = [];
// Method names come from Device.Call (attacker-influenced); LRU-bound the
// distinct-method count so the P95 sample store can't grow without limit.
const rpcSamples = new BoundedMap<string, TimestampedSample[]>({
    maxSize: tuning.observability.rpcSampleMaxMethods
});

interface NamedSample {
    name: string;
    value: number;
    ts: number;
}

export function noteRpcCompletion(completion: RpcCompletion): void {
    recordRpcTiming(completion.method, completion.ms);
    if (getLevel() < 2) return;
    const now = Date.now();
    // Check before recording so the sample doesn't pollute its own P95 baseline.
    const isSlow = isAboveSlowThreshold(completion.method, completion.ms);
    pushRpcSample({name: completion.method, value: completion.ms, ts: now});
    if (!isSlow) return;
    // Grafana dimension: slow RPCs split by human vs automation vs internal.
    incrementLabeledCounter('rpc_slow_total', {
        sender_type: completion.senderType ?? 'user'
    });
    pushRing(
        slowRpcRing,
        {
            method: completion.method,
            ms: completion.ms,
            ts: now,
            sender: completion.sender,
            senderType: completion.senderType,
            organizationId: completion.organizationId
        },
        tuning.observability.slowRpcRingSize
    );
}

function pushRpcSample(sample: NamedSample): void {
    let series = rpcSamples.get(sample.name);
    if (!series) {
        series = [];
        rpcSamples.set(sample.name, series);
    }
    series.push({ts: sample.ts, value: sample.value});
    dropExpiredBefore(
        series,
        sample.ts - tuning.observability.rpcSampleWindowMs
    );
    capSeriesSize(series, tuning.observability.rpcSampleMaxPerMethod);
}

function isAboveSlowThreshold(method: string, ms: number): boolean {
    const p95 = methodP95(method);
    if (p95 === 0) return false;
    return ms > p95 + tuning.observability.slowRpcOffsetMs;
}

function methodP95(method: string): number {
    const samples = rpcSamples.get(method);
    if (!samples || samples.length < tuning.observability.rpcSampleMinForP95)
        return 0;
    return percentile(
        samples.map((s) => s.value),
        0.95
    );
}

export interface SlowRpcQuery {
    windowSec: number;
    limit: number;
}

export function getSlowRpcs(query: SlowRpcQuery): SlowRpcEntry[] {
    const cutoff = Date.now() - query.windowSec * 1000;
    return slowRpcRing
        .filter((e) => e.ts >= cutoff)
        .sort((a, b) => b.ms - a.ms)
        .slice(0, query.limit);
}

export function getRpcMethodP95(method: string): number {
    return methodP95(method);
}

export function resetSlowRpc(): void {
    slowRpcRing.length = 0;
    rpcSamples.clear();
}
