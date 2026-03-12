import {computed} from 'vue';
import type {MetricSnapshot} from '@/stores/monitoring';
import {useMonitoringStore} from '@/stores/monitoring';

export type BottleneckSeverity = 'critical' | 'warning' | 'info';
export type BottleneckCategory =
    | 'capacity'
    | 'latency'
    | 'throughput'
    | 'resource';

export interface Bottleneck {
    id: string;
    name: string;
    severity: BottleneckSeverity;
    category: BottleneckCategory;
    description: string;
    recommendation: string;
    score: number;
    affectedMetrics: Array<{
        label: string;
        value: string | number;
        unit?: string;
    }>;
    trendingUp: boolean;
}

interface CheckContext {
    s: MetricSnapshot;
    history: (field: keyof MetricSnapshot) => number[];
}

function isTrendingUp(history: number[]): boolean {
    if (history.length < 10) return false;
    const recent = history.slice(-5);
    const earlier = history.slice(-10, -5);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    return earlierAvg > 0 && recentAvg > earlierAvg * 1.5;
}

function checkEventLoop({s, history}: CheckContext): Bottleneck | null {
    if (s.eventLoopLagMs <= 50) return null;
    const critical = s.eventLoopLagMs > 100;
    return {
        id: 'event-loop',
        name: 'Event Loop Lag',
        severity: critical ? 'critical' : 'warning',
        category: 'resource',
        description: critical
            ? `Event loop is lagging ${s.eventLoopLagMs}ms — the Node.js process is overwhelmed. All operations are delayed.`
            : `Event loop lag is ${s.eventLoopLagMs}ms — approaching dangerous levels. Performance will degrade.`,
        recommendation: critical
            ? 'Reduce concurrent operations: lower MAX_CONCURRENT_INITS, check for blocking code, or scale horizontally.'
            : 'Monitor closely. Consider reducing background processing or batching more aggressively.',
        score: critical ? 95 : 60,
        affectedMetrics: [
            {label: 'Event Loop Lag', value: s.eventLoopLagMs, unit: 'ms'},
            {label: 'Browser Sessions', value: s.wsClients},
            {label: 'Devices Online', value: s.devicesTotal}
        ],
        trendingUp: isTrendingUp(history('eventLoopLagMs'))
    };
}

function checkInitSaturation({s, history}: CheckContext): Bottleneck | null {
    if (s.initActive <= 50) return null;
    const critical = s.initActive >= 80;
    return {
        id: 'init-saturation',
        name: 'Init Queue Saturation',
        severity: critical ? 'critical' : 'warning',
        category: 'capacity',
        description: critical
            ? `${s.initActive}/100 init slots in use with ${s.initQueued} queued. New device connections are delayed.`
            : `${s.initActive}/100 init slots in use. Queue is filling up.`,
        recommendation: critical
            ? 'Stagger device reconnections. Check if a mass restart or firmware update caused simultaneous connections.'
            : 'Normal during mass reconnect events. Monitor queue depth.',
        score: critical ? 90 : 55,
        affectedMetrics: [
            {label: 'Active Inits', value: `${s.initActive}/100`},
            {label: 'Queued', value: s.initQueued},
            {label: 'Failures/min', value: s.initFailureRate}
        ],
        trendingUp: isTrendingUp(history('initActive'))
    };
}

function checkDbPoolExhaustion({s, history}: CheckContext): Bottleneck | null {
    if (s.dbPoolWaiting <= 0) return null;
    const critical = s.dbPoolWaiting > 5;
    return {
        id: 'db-pool-exhaustion',
        name: 'DB Pool Exhaustion',
        severity: critical ? 'critical' : 'warning',
        category: 'capacity',
        description: critical
            ? `${s.dbPoolWaiting} queries waiting for a DB connection. All ${s.dbPoolTotal} connections are active. Queries are queuing.`
            : `${s.dbPoolWaiting} queries waiting for a DB connection. Pool is under pressure.`,
        recommendation: critical
            ? 'Increase DB pool size, optimize slow queries, or check for connection leaks.'
            : 'Monitor pool usage. If persistent, consider increasing pool size.',
        score: critical ? 85 : 50,
        affectedMetrics: [
            {label: 'Waiting', value: s.dbPoolWaiting},
            {
                label: 'Pool',
                value: `${s.dbPoolTotal - s.dbPoolIdle}/${s.dbPoolTotal}`
            },
            {label: 'Avg Latency', value: s.dbAvgMs, unit: 'ms'}
        ],
        trendingUp: isTrendingUp(history('dbPoolWaiting'))
    };
}

function checkDbLatency({s, history}: CheckContext): Bottleneck | null {
    if (s.dbAvgMs <= 200) return null;
    const critical = s.dbAvgMs > 500;
    return {
        id: 'db-latency',
        name: 'Database Latency',
        severity: critical ? 'critical' : 'warning',
        category: 'latency',
        description: critical
            ? `Average DB query latency is ${s.dbAvgMs}ms. This will cascade to all operations depending on the database.`
            : `Average DB query latency is ${s.dbAvgMs}ms. Above normal threshold.`,
        recommendation: critical
            ? 'Check for lock contention, missing indexes, or heavy queries. Inspect DB server load.'
            : 'Review slow queries in the Database tab. Check PostgreSQL EXPLAIN plans.',
        score: critical ? 80 : 45,
        affectedMetrics: [
            {label: 'Avg Query', value: s.dbAvgMs, unit: 'ms'},
            {label: 'Pool Waiting', value: s.dbPoolWaiting}
        ],
        trendingUp: isTrendingUp(history('dbAvgMs'))
    };
}

function checkRpcLatency({s, history}: CheckContext): Bottleneck | null {
    if (s.rpcAvgMs <= 500) return null;
    const critical = s.rpcAvgMs > 1000;
    return {
        id: 'rpc-latency',
        name: 'RPC Command Latency',
        severity: critical ? 'critical' : 'warning',
        category: 'latency',
        description: critical
            ? `Average RPC latency is ${s.rpcAvgMs}ms. Device commands are taking too long to complete.`
            : `Average RPC latency is ${s.rpcAvgMs}ms. Device responses are slow.`,
        recommendation: critical
            ? 'Check device connectivity and network latency. Some devices may be unresponsive. Review Commands tab for slow methods.'
            : 'Monitor individual RPC methods in the Commands tab for specific slow operations.',
        score: critical ? 75 : 40,
        affectedMetrics: [
            {label: 'Avg RPC', value: s.rpcAvgMs, unit: 'ms'},
            {label: 'Error Rate', value: s.rpcErrorRate, unit: '/min'},
            {label: 'Success Rate', value: s.rpcSuccessRate, unit: '/min'}
        ],
        trendingUp: isTrendingUp(history('rpcAvgMs'))
    };
}

function checkRpcErrors({s}: CheckContext): Bottleneck | null {
    if (s.rpcErrorRate <= 2) return null;
    const critical = s.rpcErrorRate > 10;
    return {
        id: 'rpc-errors',
        name: 'RPC Error Rate',
        severity: critical ? 'critical' : 'warning',
        category: 'throughput',
        description: critical
            ? `${s.rpcErrorRate} RPC errors/min. A significant number of device commands are failing.`
            : `${s.rpcErrorRate} RPC errors/min. Some device commands are failing.`,
        recommendation: critical
            ? 'Check Commands tab for error details. Common causes: device offline, timeout, firmware incompatibility.'
            : 'Review recent RPC errors in the Commands tab.',
        score: critical ? 70 : 35,
        affectedMetrics: [
            {label: 'Errors/min', value: s.rpcErrorRate},
            {label: 'Success/min', value: s.rpcSuccessRate}
        ],
        trendingUp: false
    };
}

function checkStatusBacklog({s, history}: CheckContext): Bottleneck | null {
    if (s.statusQueueSize <= 50) return null;
    const critical = s.statusFlushing && s.statusQueueSize > 100;
    return {
        id: 'status-backlog',
        name: 'Status Pipeline Backlog',
        severity: critical ? 'critical' : 'warning',
        category: 'throughput',
        description: critical
            ? `Status queue has ${s.statusQueueSize} pending messages while actively flushing. DB writes can't keep up with incoming device status updates.`
            : `Status queue has ${s.statusQueueSize} pending messages. Queue is growing.`,
        recommendation: critical
            ? 'DB write throughput is the bottleneck. Check DB latency, increase batch sizes, or add write replicas.'
            : 'Normal during reconnect storms. Monitor if queue keeps growing.',
        score: critical ? 80 : 45,
        affectedMetrics: [
            {label: 'Queue Size', value: s.statusQueueSize},
            {label: 'Flushing', value: s.statusFlushing ? 'Yes' : 'No'},
            {label: 'Msg Rate', value: s.statusMsgRate, unit: '/min'}
        ],
        trendingUp: isTrendingUp(history('statusQueueSize'))
    };
}

function checkHeapPressure({s}: CheckContext): Bottleneck | null {
    if (s.heapTrend !== 'growing' || s.heapUsedM <= 256) return null;
    const critical = s.heapUsedM > 512;
    return {
        id: 'heap-pressure',
        name: 'Memory Pressure',
        severity: critical ? 'critical' : 'warning',
        category: 'resource',
        description: critical
            ? `Heap usage is ${s.heapUsedM}MB (RSS ${s.rssM}MB) and growing. Likely memory leak — investigate immediately.`
            : `Heap usage is ${s.heapUsedM}MB (RSS ${s.rssM}MB) and growing. Potential memory leak or high object allocation.`,
        recommendation:
            'Check for unbounded caches or event listener leaks. Review heap snapshot if persistent.',
        score: critical ? 75 : 55,
        affectedMetrics: [
            {label: 'Heap Used', value: s.heapUsedM, unit: 'MB'},
            {label: 'Heap Total', value: s.heapTotalM, unit: 'MB'},
            {label: 'RSS', value: s.rssM, unit: 'MB'},
            {label: 'Trend', value: s.heapTrend}
        ],
        trendingUp: true
    };
}

function checkEmSyncCapacity({s, history}: CheckContext): Bottleneck | null {
    if (s.emActiveSyncs < 35 || s.emQueueSize <= 50) return null;
    const critical = s.emActiveSyncs >= 38 && s.emQueueSize > 100;
    return {
        id: 'em-sync-capacity',
        name: 'Energy Meter Sync Capacity',
        severity: critical ? 'critical' : 'warning',
        category: 'capacity',
        description: `${s.emActiveSyncs}/40 concurrent EM syncs with ${s.emQueueSize} queued. Approaching concurrency limit.`,
        recommendation:
            'EM data collection is at capacity. Consider increasing sync concurrency or reducing sync frequency.',
        score: critical ? 60 : 35,
        affectedMetrics: [
            {label: 'Active Syncs', value: `${s.emActiveSyncs}/40`},
            {label: 'Queue', value: s.emQueueSize}
        ],
        trendingUp: isTrendingUp(history('emActiveSyncs'))
    };
}

function checkEventListeners({s, history}: CheckContext): Bottleneck | null {
    if (s.eventsListeners <= 500) return null;
    const critical = s.eventsListeners > 1000;
    return {
        id: 'event-listeners',
        name: 'Event Listener Count',
        severity: critical ? 'critical' : 'warning',
        category: 'resource',
        description: critical
            ? `${s.eventsListeners} active event listeners. This is abnormally high and may indicate a listener leak.`
            : `${s.eventsListeners} active event listeners. Above normal threshold.`,
        recommendation:
            'Check for event listeners not being cleaned up on device disconnect. Review plugin subscription patterns.',
        score: critical ? 65 : 30,
        affectedMetrics: [
            {label: 'Listeners', value: s.eventsListeners},
            {label: 'Event Types', value: s.eventsTypes}
        ],
        trendingUp: isTrendingUp(history('eventsListeners'))
    };
}

function checkCpuSaturation({s, history}: CheckContext): Bottleneck | null {
    if (s.cpuUserPct <= 70) return null;
    const critical = s.cpuUserPct > 90;
    return {
        id: 'cpu-saturation',
        name: 'CPU Saturation',
        severity: critical ? 'critical' : 'warning',
        category: 'resource',
        description: critical
            ? `CPU usage is ${s.cpuUserPct}% user + ${s.cpuSystemPct}% system. The process is CPU-bound — all operations will be slow.`
            : `CPU usage is ${s.cpuUserPct}% user + ${s.cpuSystemPct}% system. Approaching saturation.`,
        recommendation: critical
            ? 'Profile for hot loops or expensive computations. Consider offloading work to worker threads or scaling horizontally.'
            : 'Monitor closely. Check for expensive plugins or large device fleets causing high processing load.',
        score: critical ? 90 : 55,
        affectedMetrics: [
            {label: 'CPU User', value: s.cpuUserPct, unit: '%'},
            {label: 'CPU System', value: s.cpuSystemPct, unit: '%'},
            {label: 'Event Loop Lag', value: s.eventLoopLagMs, unit: 'ms'}
        ],
        trendingUp: isTrendingUp(history('cpuUserPct'))
    };
}

function checkOsMemory({s}: CheckContext): Bottleneck | null {
    if (s.osFreeMemM <= 0 || s.osFreeMemM >= 500) return null;
    const critical = s.osFreeMemM < 200;
    return {
        id: 'os-memory-pressure',
        name: 'OS Memory Pressure',
        severity: critical ? 'critical' : 'warning',
        category: 'resource',
        description: critical
            ? `Only ${s.osFreeMemM}MB free of ${s.osTotalMemM}MB total. Host is running out of memory — OOM killer risk.`
            : `${s.osFreeMemM}MB free of ${s.osTotalMemM}MB total. Host memory is getting low.`,
        recommendation: critical
            ? 'Free memory immediately: stop non-essential services, reduce DB cache, or add RAM.'
            : 'Check what else is running on the host. Consider reducing memory-hungry services.',
        score: critical ? 95 : 50,
        affectedMetrics: [
            {label: 'Free', value: s.osFreeMemM, unit: 'MB'},
            {label: 'Total', value: s.osTotalMemM, unit: 'MB'},
            {label: 'Heap Used', value: s.heapUsedM, unit: 'MB'}
        ],
        trendingUp: false
    };
}

function checkGcPressure({s}: CheckContext): Bottleneck | null {
    if (s.gcMaxPauseMs <= 100) return null;
    const critical = s.gcMaxPauseMs > 500;
    return {
        id: 'gc-pressure',
        name: 'GC Pause Pressure',
        severity: critical ? 'critical' : 'warning',
        category: 'latency',
        description: critical
            ? `Max GC pause is ${s.gcMaxPauseMs}ms with ${s.gcPauseCount} pauses totaling ${s.gcTotalPauseMs}ms. Long pauses cause visible stalls.`
            : `Max GC pause is ${s.gcMaxPauseMs}ms. GC activity is above normal.`,
        recommendation: critical
            ? 'Reduce object allocation rate. Check for large temporary objects or frequent short-lived allocations.'
            : 'Monitor GC pause trends. Consider increasing V8 heap size with --max-old-space-size.',
        score: critical ? 70 : 35,
        affectedMetrics: [
            {label: 'Max Pause', value: s.gcMaxPauseMs, unit: 'ms'},
            {label: 'Total Pause', value: s.gcTotalPauseMs, unit: 'ms'},
            {label: 'GC Count', value: s.gcPauseCount}
        ],
        trendingUp: false
    };
}

function checkHandleLeak({s, history}: CheckContext): Bottleneck | null {
    if (s.activeHandles <= 1000) return null;
    const critical = s.activeHandles > 5000;
    return {
        id: 'handle-leak',
        name: 'Handle Leak',
        severity: critical ? 'critical' : 'warning',
        category: 'resource',
        description: critical
            ? `${s.activeHandles} active handles. This strongly suggests a resource leak (sockets, timers, or file descriptors not being cleaned up).`
            : `${s.activeHandles} active handles. Higher than expected — possible slow leak.`,
        recommendation:
            'Check for unclosed sockets, orphaned timers, or file descriptors. Compare handle count to connected device count.',
        score: critical ? 75 : 40,
        affectedMetrics: [
            {label: 'Handles', value: s.activeHandles},
            {label: 'Devices', value: s.devicesTotal},
            {label: 'Browser Sessions', value: s.wsClients}
        ],
        trendingUp: isTrendingUp(history('activeHandles'))
    };
}

function checkInitFailures({s}: CheckContext): Bottleneck | null {
    if (s.initFailureRate <= 2) return null;
    const critical = s.initFailureRate > 10;
    return {
        id: 'init-failures',
        name: 'Device Init Failures',
        severity: critical ? 'critical' : 'warning',
        category: 'throughput',
        description: critical
            ? `${s.initFailureRate} device init failures/min. Devices are failing to connect properly.`
            : `${s.initFailureRate} device init failures/min. Some devices are having issues.`,
        recommendation: critical
            ? 'Check Device Ingest tab for failure details. Common causes: firmware mismatch, network timeout, DB errors during init.'
            : 'Review recent init failures in the Device Ingest tab.',
        score: critical ? 75 : 40,
        affectedMetrics: [
            {label: 'Failures/min', value: s.initFailureRate},
            {label: 'Active Inits', value: s.initActive}
        ],
        trendingUp: false
    };
}

function checkStatusFlushLatency({s}: CheckContext): Bottleneck | null {
    const store = useMonitoringStore();
    const flushTiming = store.latestMetrics?.dbTimings?.['status_flush'];
    if (!flushTiming || flushTiming.avgMs <= 200) return null;
    const critical = flushTiming.avgMs > 500;
    return {
        id: 'status-flush-latency',
        name: 'Status Flush Latency',
        severity: critical ? 'critical' : 'warning',
        category: 'latency',
        description: `Status flush avg is ${flushTiming.avgMs}ms (${flushTiming.count} flushes). DB writes can't keep up.`,
        recommendation: 'Try disabling DB writes (Control Panel) to confirm DB is the bottleneck.',
        score: critical ? 80 : 50,
        affectedMetrics: [
            {label: 'Flush Avg', value: flushTiming.avgMs, unit: 'ms'},
            {label: 'Flush Max', value: flushTiming.maxMs, unit: 'ms'},
            {label: 'Queue Size', value: s.statusQueueSize}
        ],
        trendingUp: false
    };
}

/** All bottleneck checks — add new checks here */
const CHECKS = [
    checkEventLoop,
    checkInitSaturation,
    checkDbPoolExhaustion,
    checkDbLatency,
    checkRpcLatency,
    checkRpcErrors,
    checkStatusBacklog,
    checkHeapPressure,
    checkEmSyncCapacity,
    checkEventListeners,
    checkCpuSaturation,
    checkOsMemory,
    checkGcPressure,
    checkHandleLeak,
    checkInitFailures,
    checkStatusFlushLatency
];

export function useBottleneckAnalysis() {
    const store = useMonitoringStore();

    const bottlenecks = computed<Bottleneck[]>(() => {
        const s = store.latest;
        if (!s || store.obsLevel === 0) return [];

        const ctx: CheckContext = {
            s,
            history: (field) => store.historyField(field)
        };

        return CHECKS.map((check) => check(ctx))
            .filter((b): b is Bottleneck => b !== null)
            .sort((a, b) => b.score - a.score);
    });

    const worstSeverity = computed<BottleneckSeverity | null>(() => {
        if (bottlenecks.value.length === 0) return null;
        if (bottlenecks.value.some((b) => b.severity === 'critical'))
            return 'critical';
        if (bottlenecks.value.some((b) => b.severity === 'warning'))
            return 'warning';
        return 'info';
    });

    return {bottlenecks, worstSeverity};
}
