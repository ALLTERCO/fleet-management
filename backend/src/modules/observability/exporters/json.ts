import * as os from 'node:os';
import * as v8 from 'node:v8';
import {tuning} from '../../../config/tuning';
import {getSlowBuilds} from '../buildTimings';
import {getSlowDeviceCommands} from '../deviceCommandTimings';
import {getInitFailures, getRpcErrors, getWsMessageTypes} from '../eventLog';
import {activeCount} from '../processMetrics';
import {
    getCpuSystemPct,
    getCpuUserPct,
    getEventLoopHistogram,
    getGcStats,
    getHeapTrend,
    getInitDurations,
    getLagMs,
    getLevel,
    getWsClientCount,
    isDbWritesDisabled
} from '../samplers';
import {
    counters,
    dbTimings,
    gauges,
    labeledCounters,
    labeledGauges,
    modules,
    rpcTimings
} from '../state';
import {warnGetterFailed} from '../topology';
import type {RpcMethodStats} from '../types';
import {getStrugglingClients, getWsClientHealthStats} from '../wsClientHealth';

// The V8 heap ceiling (set by --max-old-space-size) — constant for the process,
// so read it once. heapTotal is only what V8 has grown to so far; this is the cap.
const HEAP_LIMIT_M = Math.round(
    v8.getHeapStatistics().heap_size_limit / 1048576
);

function formatTimings(timings: Iterable<[string, RpcMethodStats]>) {
    const out: Record<
        string,
        {count: number; avgMs: number; maxMs: number; minMs: number}
    > = {};
    for (const [method, stats] of timings) {
        out[method] = {
            count: stats.count,
            avgMs: Math.round(stats.totalMs / stats.count),
            maxMs: Math.round(stats.maxMs),
            minMs:
                stats.minMs === Number.POSITIVE_INFINITY
                    ? 0
                    : Math.round(stats.minMs)
        };
    }
    return out;
}

export function getMetrics() {
    if (getLevel() === 0) return null;

    const mem = process.memoryUsage();

    const moduleSnapshot: Record<
        string,
        Record<string, number | boolean | string>
    > = {};
    for (const [name, reg] of modules) {
        try {
            moduleSnapshot[name] = reg.stats();
        } catch (e) {
            warnGetterFailed(name, e);
        }
    }

    const elHistogram = getEventLoopHistogram();
    const elP50 = elHistogram
        ? Math.round(elHistogram.percentile(50) / 1e6)
        : 0;
    const elP95 = elHistogram
        ? Math.round(elHistogram.percentile(95) / 1e6)
        : 0;
    const elP99 = elHistogram
        ? Math.round(elHistogram.percentile(99) / 1e6)
        : 0;
    const elMean = elHistogram ? Math.round(elHistogram.mean / 1e6) : 0;
    const gc = getGcStats();

    const tier1 = {
        level: getLevel(),
        uptimeS: Math.round(process.uptime()),
        eventLoopLagMs: Math.round(getLagMs()),
        eventLoopHistogram: {p50: elP50, p95: elP95, p99: elP99, mean: elMean},
        memory: {
            rssM: Math.round(mem.rss / 1048576),
            heapUsedM: Math.round(mem.heapUsed / 1048576),
            heapTotalM: Math.round(mem.heapTotal / 1048576),
            heapLimitM: HEAP_LIMIT_M,
            externalM: Math.round((mem.external ?? 0) / 1048576),
            arrayBuffersM: Math.round((mem.arrayBuffers ?? 0) / 1048576),
            heapTrend: getHeapTrend()
        },
        cpu: {userPct: getCpuUserPct(), systemPct: getCpuSystemPct()},
        os: {
            freeMemM: Math.round(os.freemem() / 1048576),
            totalMemM: Math.round(os.totalmem() / 1048576),
            loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100)
        },
        gc: {
            totalPauseMs: Math.round(gc.totalPauseMs),
            pauseCount: gc.pauseCount,
            maxPauseMs: Math.round(gc.maxPauseMs)
        },
        activeHandles: activeCount('_getActiveHandles'),
        wsClients: getWsClientCount(),
        wsClientHealth: getWsClientHealthStats(),
        modules: moduleSnapshot,
        dbWritesDisabled: isDbWritesDisabled(),
        redisDisabled: tuning.redis.disabled
    };

    if (getLevel() < 2) return tier1;

    return {
        ...tier1,
        counters: Object.fromEntries(counters),
        gauges: Object.fromEntries(gauges),
        labeledCounters: Object.fromEntries(
            Array.from(labeledCounters.entries()).map(([key, entry]) => [
                key,
                entry.value
            ])
        ),
        labeledGauges: Object.fromEntries(
            Array.from(labeledGauges.entries()).map(([key, entry]) => [
                key,
                entry.value
            ])
        ),
        rpcTimings: formatTimings(rpcTimings),
        dbTimings: formatTimings(dbTimings),
        rpcErrors: [...getRpcErrors()],
        initFailures: [...getInitFailures()],
        wsMessageBreakdown: Object.fromEntries(getWsMessageTypes()),
        initDurations: getInitDurations(),
        slowBuilds: getSlowBuilds(),
        slowDeviceCommands: getSlowDeviceCommands(),
        strugglingClients: getStrugglingClients()
    };
}

export function getDebugReport() {
    const metrics = getMetrics();
    return {
        ...metrics,
        rpcErrors: [...getRpcErrors()],
        initFailures: [...getInitFailures()],
        wsMessageBreakdown: Object.fromEntries(getWsMessageTypes()),
        initDurations: getInitDurations(),
        slowBuilds: getSlowBuilds(),
        slowDeviceCommands: getSlowDeviceCommands(),
        timestamp: Date.now()
    };
}
