import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    type IntervalHistogram,
    PerformanceObserver,
    monitorEventLoopDelay
} from 'node:perf_hooks';
import * as log4js from 'log4js';

const logger = log4js.getLogger('Observability');

// ── Types ──────────────────────────────────────────────────────────────────
export type ObsLevel = 0 | 1 | 2 | 3;

export interface RpcMethodStats {
    count: number;
    totalMs: number;
    maxMs: number;
    minMs: number;
}

export interface RpcErrorEntry {
    method: string;
    error: string;
    ts: number;
}

export interface InitFailureEntry {
    shellyID: string;
    error: string;
    ts: number;
}

type ModuleStatsGetter = () => Record<string, number | boolean | string>;

// ── State ──────────────────────────────────────────────────────────────────
let level: ObsLevel = 0;
let lagMs = 0;
let wsClientCount = 0;
let lagInterval: ReturnType<typeof setInterval> | undefined;

const rpcTimings = new Map<string, RpcMethodStats>();
const dbTimings = new Map<string, RpcMethodStats>();
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const moduleGetters = new Map<string, ModuleStatsGetter>();

// ── RPC Error Ring Buffer ─────────────────────────────────────────────────
const RPC_ERROR_RING_SIZE = 50;
const rpcErrors: RpcErrorEntry[] = [];

// ── Init Failure Ring Buffer ──────────────────────────────────────────────
const INIT_FAILURE_RING_SIZE = 50;
const initFailures: InitFailureEntry[] = [];

// ── WS Message Breakdown ─────────────────────────────────────────────────
const wsMessageTypes = new Map<string, number>();

// ── Init Duration Ring Buffer ────────────────────────────────────────────
const INIT_DURATION_RING_SIZE = 100;
const initDurations: Array<{shellyID: string; durationMs: number; ts: number}> =
    [];

// ── Memory Trend ──────────────────────────────────────────────────────────
let prevHeapUsed = 0;
let heapTrend: 'growing' | 'stable' | 'shrinking' = 'stable';

// ── CPU Usage (delta-based) ──────────────────────────────────────────────
let prevCpuUsage = process.cpuUsage();
let prevCpuTime = Date.now();
let cpuUserPct = 0;
let cpuSystemPct = 0;

// ── Event Loop Delay Histogram ──────────────────────────────────────────
let elHistogram: IntervalHistogram | undefined;

// ── GC Pause Tracking ────────────────────────────────────────────────────
let gcTotalPauseMs = 0;
let gcPauseCount = 0;
let gcMaxPauseMs = 0;
let gcObserver: PerformanceObserver | undefined;

// ── Metric History Ring Buffer ───────────────────────────────────────────
const HISTORY_RING_SIZE = 720; // 1 hour at 5s intervals
const metricHistory: Array<{ts: number; metrics: any}> = [];
let snapshotInterval: ReturnType<typeof setInterval> | undefined;

// ── Disk usage (sampled every 60s) ────────────────────────────────────────
const diskUsage: Record<string, number> = {};
let diskUsageInterval: ReturnType<typeof setInterval> | undefined;

function dirSizeBytes(dir: string): number {
    let total = 0;
    try {
        const entries = fs.readdirSync(dir, {withFileTypes: true});
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isFile()) {
                try {
                    total += fs.statSync(full).size;
                } catch {
                    /* skip */
                }
            } else if (entry.isDirectory()) {
                total += dirSizeBytes(full);
            }
        }
    } catch {
        /* dir doesn't exist yet */
    }
    return total;
}

function sampleDiskUsage() {
    const base = path.join(process.cwd(), 'uploads');
    const dataDir = path.join(process.cwd(), 'data');
    diskUsage.uploads_backgrounds = dirSizeBytes(
        path.join(base, 'backgrounds')
    );
    diskUsage.uploads_profile_pics = dirSizeBytes(
        path.join(base, 'profilePics')
    );
    diskUsage.uploads_report_images = dirSizeBytes(
        path.join(base, 'reportImages')
    );
    diskUsage.uploads_audit_logs = dirSizeBytes(path.join(base, 'audit-logs'));
    diskUsage.data_dir = dirSizeBytes(dataDir);
}

function startDiskUsageSampling() {
    sampleDiskUsage();
    diskUsageInterval = setInterval(sampleDiskUsage, 60_000);
    diskUsageInterval.unref();
}

// ── Event-loop lag measurement ─────────────────────────────────────────────
function startLagMeasurement() {
    let lastHr = process.hrtime.bigint();
    let tick = 0;
    lagInterval = setInterval(() => {
        const now = process.hrtime.bigint();
        const elapsed = Number(now - lastHr) / 1e6; // ms
        lagMs = Math.max(0, elapsed - 1000); // subtract the 1s interval
        lastHr = now;

        // Every 30th tick (~30s), snapshot heap + CPU
        tick++;
        if (tick >= 30) {
            tick = 0;
            const currentHeap = process.memoryUsage().heapUsed;
            if (prevHeapUsed > 0) {
                const diff = currentHeap - prevHeapUsed;
                const threshold = prevHeapUsed * 0.05; // 5% threshold
                if (diff > threshold) heapTrend = 'growing';
                else if (diff < -threshold) heapTrend = 'shrinking';
                else heapTrend = 'stable';
            }
            prevHeapUsed = currentHeap;

            // CPU usage delta
            const nowCpu = process.cpuUsage(prevCpuUsage);
            const nowTime = Date.now();
            const elapsedMs = nowTime - prevCpuTime;
            if (elapsedMs > 0) {
                cpuUserPct = Math.round((nowCpu.user / 1000 / elapsedMs) * 100);
                cpuSystemPct = Math.round(
                    (nowCpu.system / 1000 / elapsedMs) * 100
                );
            }
            prevCpuUsage = process.cpuUsage();
            prevCpuTime = nowTime;
        }
    }, 1000);
    lagInterval.unref(); // don't keep process alive

    // Event loop delay histogram (precise percentiles)
    elHistogram = monitorEventLoopDelay({resolution: 20});
    elHistogram.enable();

    // GC pause observer
    try {
        gcObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                gcPauseCount++;
                gcTotalPauseMs += entry.duration;
                if (entry.duration > gcMaxPauseMs)
                    gcMaxPauseMs = entry.duration;
            }
        });
        gcObserver.observe({entryTypes: ['gc']});
    } catch {
        // GC observation not available in all environments
    }
}

function stopLagMeasurement() {
    if (lagInterval) {
        clearInterval(lagInterval);
        lagInterval = undefined;
    }
    lagMs = 0;
    if (elHistogram) {
        elHistogram.disable();
        elHistogram = undefined;
    }
    if (gcObserver) {
        gcObserver.disconnect();
        gcObserver = undefined;
    }
    gcTotalPauseMs = 0;
    gcPauseCount = 0;
    gcMaxPauseMs = 0;
}

// ── Level management ───────────────────────────────────────────────────────
export function setLevel(l: ObsLevel) {
    const prev = level;
    level = l;
    if (l > 0 && !lagInterval) startLagMeasurement();
    if (l === 0 && lagInterval) stopLagMeasurement();
    if (l > 0 && !snapshotInterval) startSnapshotInterval();
    if (l === 0 && snapshotInterval) stopSnapshotInterval();
    if (l > 0 && !diskUsageInterval) startDiskUsageSampling();
    if (l === 0 && diskUsageInterval) {
        clearInterval(diskUsageInterval);
        diskUsageInterval = undefined;
    }
    if (prev !== l) logger.info('Observability level changed %d → %d', prev, l);
}

export function getLevel(): ObsLevel {
    return level;
}

export function isEnabled(): boolean {
    return level > 0;
}

/** Backward compat: sets level to 2 */
export function enable() {
    if (level >= 2) return;
    setLevel(2);
    logger.info('Observability enabled');
}

/** Backward compat: sets level to 0 */
export function disable() {
    if (level === 0) return;
    setLevel(0);
    resetTimings();
    logger.info('Observability disabled');
}

// ── Counters & Gauges ──────────────────────────────────────────────────────
export function incrementCounter(name: string, delta = 1) {
    if (level < 2) return;
    counters.set(name, (counters.get(name) ?? 0) + delta);
}

export function setGauge(name: string, value: number) {
    if (level < 1) return;
    gauges.set(name, value);
}

// ── Module stat getters ────────────────────────────────────────────────────
export function registerModule(name: string, getter: ModuleStatsGetter) {
    moduleGetters.set(name, getter);
}

// ── RPC timing ─────────────────────────────────────────────────────────────
export function recordRpcTiming(method: string, durationMs: number) {
    if (level < 2) return;
    let stats = rpcTimings.get(method);
    if (!stats) {
        stats = {
            count: 0,
            totalMs: 0,
            maxMs: 0,
            minMs: Number.POSITIVE_INFINITY
        };
        rpcTimings.set(method, stats);
    }
    stats.count++;
    stats.totalMs += durationMs;
    if (durationMs > stats.maxMs) stats.maxMs = durationMs;
    if (durationMs < stats.minMs) stats.minMs = durationMs;
}

// ── DB timing ──────────────────────────────────────────────────────────────
export function recordDbTiming(method: string, durationMs: number) {
    if (level < 2) return;
    let stats = dbTimings.get(method);
    if (!stats) {
        stats = {
            count: 0,
            totalMs: 0,
            maxMs: 0,
            minMs: Number.POSITIVE_INFINITY
        };
        dbTimings.set(method, stats);
    }
    stats.count++;
    stats.totalMs += durationMs;
    if (durationMs > stats.maxMs) stats.maxMs = durationMs;
    if (durationMs < stats.minMs) stats.minMs = durationMs;
}

// ── RPC Error Recording ───────────────────────────────────────────────────
export function recordRpcError(method: string, error: string) {
    if (level < 2) return;
    if (rpcErrors.length >= RPC_ERROR_RING_SIZE) rpcErrors.shift();
    rpcErrors.push({method, error, ts: Date.now()});
}

export function getRpcErrors(): readonly RpcErrorEntry[] {
    return rpcErrors;
}

// ── Init Failure Recording ────────────────────────────────────────────────
export function recordInitFailure(shellyID: string, error: string) {
    if (level < 2) return;
    if (initFailures.length >= INIT_FAILURE_RING_SIZE) initFailures.shift();
    initFailures.push({shellyID, error, ts: Date.now()});
}

export function getInitFailures(): readonly InitFailureEntry[] {
    return initFailures;
}

// ── WS Message Tracking ──────────────────────────────────────────────────
export function recordWsMessage(method: string) {
    if (level < 2) return;
    wsMessageTypes.set(method, (wsMessageTypes.get(method) ?? 0) + 1);
}

// ── Init Duration Recording ──────────────────────────────────────────────
export function recordInitDuration(shellyID: string, durationMs: number) {
    if (level < 2) return;
    if (initDurations.length >= INIT_DURATION_RING_SIZE) initDurations.shift();
    initDurations.push({
        shellyID,
        durationMs: Math.round(durationMs),
        ts: Date.now()
    });
}

// ── Reset ──────────────────────────────────────────────────────────────────
export function resetTimings() {
    rpcTimings.clear();
    dbTimings.clear();
    counters.clear();
    rpcErrors.length = 0;
    initFailures.length = 0;
    wsMessageTypes.clear();
    initDurations.length = 0;
}

// ── WS client count (kept for backward compat) ────────────────────────────
export function setWsClientCount(count: number) {
    wsClientCount = count;
}

// ── Metrics ────────────────────────────────────────────────────────────────
function formatTimings(timings: Map<string, RpcMethodStats>) {
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
    if (level === 0) return null;

    const mem = process.memoryUsage();

    // Tier 1: basic health
    const modules: Record<
        string,
        Record<string, number | boolean | string>
    > = {};
    for (const [name, getter] of moduleGetters) {
        try {
            modules[name] = getter();
        } catch (e) {
            logger.warn('Module stats getter failed for %s: %s', name, e);
        }
    }

    // Event loop histogram percentiles
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

    const tier1 = {
        level,
        uptimeS: Math.round(process.uptime()),
        eventLoopLagMs: Math.round(lagMs),
        eventLoopHistogram: {p50: elP50, p95: elP95, p99: elP99, mean: elMean},
        memory: {
            rssM: Math.round(mem.rss / 1048576),
            heapUsedM: Math.round(mem.heapUsed / 1048576),
            heapTotalM: Math.round(mem.heapTotal / 1048576),
            externalM: Math.round((mem.external ?? 0) / 1048576),
            arrayBuffersM: Math.round((mem.arrayBuffers ?? 0) / 1048576),
            heapTrend
        },
        cpu: {userPct: cpuUserPct, systemPct: cpuSystemPct},
        os: {
            freeMemM: Math.round(os.freemem() / 1048576),
            totalMemM: Math.round(os.totalmem() / 1048576),
            loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100)
        },
        gc: {
            totalPauseMs: Math.round(gcTotalPauseMs),
            pauseCount: gcPauseCount,
            maxPauseMs: Math.round(gcMaxPauseMs)
        },
        activeHandles: (process as any)._getActiveHandles?.()?.length ?? 0,
        wsClients: wsClientCount,
        modules
    };

    if (level < 2) return tier1;

    // Tier 2+: detailed timings & counters
    return {
        ...tier1,
        counters: Object.fromEntries(counters),
        rpcTimings: formatTimings(rpcTimings),
        dbTimings: formatTimings(dbTimings),
        rpcErrors: [...rpcErrors],
        initFailures: [...initFailures],
        wsMessageBreakdown: Object.fromEntries(wsMessageTypes),
        initDurations: [...initDurations]
    };
}

// ── Metric History ────────────────────────────────────────────────────────
function startSnapshotInterval() {
    snapshotInterval = setInterval(() => {
        const m = getMetrics();
        if (!m) return;
        if (metricHistory.length >= HISTORY_RING_SIZE) metricHistory.shift();
        metricHistory.push({ts: Date.now(), metrics: m});
    }, 5000);
    snapshotInterval.unref();
}

function stopSnapshotInterval() {
    if (snapshotInterval) {
        clearInterval(snapshotInterval);
        snapshotInterval = undefined;
    }
    metricHistory.length = 0;
}

export function getMetricHistory() {
    return metricHistory;
}

// ── Prometheus Exposition Format ──────────────────────────────────────────
function promLine(
    name: string,
    help: string,
    type: string,
    value: number
): string {
    return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

function promLabeled(
    name: string,
    labels: Record<string, string>,
    value: number
): string {
    const lblStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
    return `${name}{${lblStr}} ${value}\n`;
}

export function getPrometheusMetrics(): string {
    const lines: string[] = [];
    const mem = process.memoryUsage();
    const up = Math.round(process.uptime());

    // ── Process ──────────────────────────────────────────────────────────
    lines.push(
        promLine('fm_up', 'Whether the fleet manager is up', 'gauge', 1)
    );
    lines.push(
        promLine('fm_uptime_seconds', 'Process uptime in seconds', 'gauge', up)
    );
    lines.push(
        promLine(
            'fm_obs_level',
            'Current observability level (0-3)',
            'gauge',
            level
        )
    );

    // ── Memory ───────────────────────────────────────────────────────────
    lines.push(
        promLine(
            'fm_memory_rss_bytes',
            'Resident set size in bytes',
            'gauge',
            mem.rss
        )
    );
    lines.push(
        promLine(
            'fm_memory_heap_used_bytes',
            'V8 heap used in bytes',
            'gauge',
            mem.heapUsed
        )
    );
    lines.push(
        promLine(
            'fm_memory_heap_total_bytes',
            'V8 heap total in bytes',
            'gauge',
            mem.heapTotal
        )
    );
    lines.push(
        promLine(
            'fm_memory_external_bytes',
            'V8 external memory in bytes',
            'gauge',
            mem.external ?? 0
        )
    );
    lines.push(
        promLine(
            'fm_memory_array_buffers_bytes',
            'V8 array buffers in bytes',
            'gauge',
            mem.arrayBuffers ?? 0
        )
    );

    // ── OS ────────────────────────────────────────────────────────────────
    lines.push(
        promLine(
            'fm_os_free_memory_bytes',
            'OS free memory in bytes',
            'gauge',
            os.freemem()
        )
    );
    lines.push(
        promLine(
            'fm_os_total_memory_bytes',
            'OS total memory in bytes',
            'gauge',
            os.totalmem()
        )
    );
    const loadAvg = os.loadavg();
    lines.push(
        promLine(
            'fm_os_load_1m',
            'OS 1-minute load average',
            'gauge',
            loadAvg[0]
        )
    );
    lines.push(
        promLine(
            'fm_os_load_5m',
            'OS 5-minute load average',
            'gauge',
            loadAvg[1]
        )
    );
    lines.push(
        promLine(
            'fm_os_load_15m',
            'OS 15-minute load average',
            'gauge',
            loadAvg[2]
        )
    );
    lines.push(
        promLine('fm_os_cpus', 'Number of CPU cores', 'gauge', os.cpus().length)
    );

    // ── Active handles ───────────────────────────────────────────────────
    lines.push(
        promLine(
            'fm_active_handles',
            'Active Node.js handles',
            'gauge',
            (process as any)._getActiveHandles?.()?.length ?? 0
        )
    );
    lines.push(
        promLine(
            'fm_active_requests',
            'Active Node.js async requests',
            'gauge',
            (process as any)._getActiveRequests?.()?.length ?? 0
        )
    );

    // ── WebSocket clients ────────────────────────────────────────────────
    lines.push(
        promLine(
            'fm_ws_clients',
            'Connected WebSocket clients',
            'gauge',
            wsClientCount
        )
    );

    // ── Event loop, CPU, GC (level 1+) ───────────────────────────────────
    if (level >= 1) {
        lines.push(
            promLine(
                'fm_event_loop_lag_ms',
                'Event loop lag in milliseconds',
                'gauge',
                Math.round(lagMs)
            )
        );
        lines.push(
            promLine(
                'fm_cpu_user_percent',
                'CPU user usage percent',
                'gauge',
                cpuUserPct
            )
        );
        lines.push(
            promLine(
                'fm_cpu_system_percent',
                'CPU system usage percent',
                'gauge',
                cpuSystemPct
            )
        );

        if (elHistogram) {
            lines.push(
                '# HELP fm_event_loop_delay_ms Event loop delay histogram percentiles\n'
            );
            lines.push('# TYPE fm_event_loop_delay_ms gauge\n');
            lines.push(
                promLabeled(
                    'fm_event_loop_delay_ms',
                    {quantile: '0.5'},
                    Math.round(elHistogram.percentile(50) / 1e6)
                )
            );
            lines.push(
                promLabeled(
                    'fm_event_loop_delay_ms',
                    {quantile: '0.95'},
                    Math.round(elHistogram.percentile(95) / 1e6)
                )
            );
            lines.push(
                promLabeled(
                    'fm_event_loop_delay_ms',
                    {quantile: '0.99'},
                    Math.round(elHistogram.percentile(99) / 1e6)
                )
            );
            lines.push(
                promLabeled(
                    'fm_event_loop_delay_ms',
                    {quantile: '1.0'},
                    Math.round(elHistogram.max / 1e6)
                )
            );
        }

        lines.push(
            promLine(
                'fm_gc_pause_total_ms',
                'Total GC pause time in ms',
                'counter',
                Math.round(gcTotalPauseMs)
            )
        );
        lines.push(
            promLine(
                'fm_gc_pause_count',
                'Total GC pause count',
                'counter',
                gcPauseCount
            )
        );
        lines.push(
            promLine(
                'fm_gc_pause_max_ms',
                'Max GC pause in ms',
                'gauge',
                Math.round(gcMaxPauseMs)
            )
        );
    }

    // ── Module-specific named metrics (always — these are gauges) ────────

    // Helper: safely get a module's stats
    const mod = (
        name: string
    ): Record<string, number | boolean | string> | null => {
        const getter = moduleGetters.get(name);
        if (!getter) return null;
        try {
            return getter();
        } catch {
            return null;
        }
    };

    // Devices
    const devices = mod('devices');
    if (devices) {
        lines.push(
            promLine(
                'fm_devices_total',
                'Total connected devices',
                'gauge',
                devices.total as number
            )
        );
        lines.push(
            promLine(
                'fm_devices_online',
                'Online devices',
                'gauge',
                devices.online as number
            )
        );
        lines.push(
            promLine(
                'fm_devices_offline',
                'Offline devices (transport lost)',
                'gauge',
                devices.offline as number
            )
        );
        lines.push(
            promLine(
                'fm_devices_source_count',
                'Distinct connection source types',
                'gauge',
                devices.sourceCount as number
            )
        );
        lines.push(
            promLine(
                'fm_devices_model_count',
                'Distinct device models',
                'gauge',
                devices.modelCount as number
            )
        );
        // Per-source breakdown
        for (const [key, value] of Object.entries(devices)) {
            if (key.startsWith('source_') && typeof value === 'number') {
                lines.push(
                    promLabeled(
                        'fm_devices_by_source',
                        {source: key.replace('source_', '')},
                        value
                    )
                );
            }
        }
    }

    // Shelly events
    const shellyEvents = mod('shellyEvents');
    if (shellyEvents) {
        lines.push(
            promLine(
                'fm_device_connects_total',
                'Total device connect events',
                'counter',
                shellyEvents.connects as number
            )
        );
        lines.push(
            promLine(
                'fm_device_disconnects_total',
                'Total device disconnect events',
                'counter',
                shellyEvents.disconnects as number
            )
        );
        lines.push(
            promLine(
                'fm_device_events_total',
                'Total Shelly events emitted',
                'counter',
                shellyEvents.totalEvents as number
            )
        );
    }

    // Device init slots (bottleneck indicator)
    const deviceInit = mod('deviceInit');
    if (deviceInit) {
        lines.push(
            promLine(
                'fm_device_init_active',
                'Device initializations in progress',
                'gauge',
                deviceInit.active as number
            )
        );
        lines.push(
            promLine(
                'fm_device_init_queued',
                'Device initializations waiting in queue',
                'gauge',
                deviceInit.queued as number
            )
        );
    }

    // Waiting room (pending devices)
    const waitingRoom = mod('waitingRoom');
    if (waitingRoom) {
        lines.push(
            promLine(
                'fm_waiting_room_pending',
                'Devices pending approval',
                'gauge',
                waitingRoom.pendingDevices as number
            )
        );
    }

    // DB connection pool (bottleneck indicator)
    const dbPool = mod('dbPool');
    if (dbPool) {
        lines.push(
            promLine(
                'fm_db_pool_total',
                'Total DB pool connections',
                'gauge',
                dbPool.totalCount as number
            )
        );
        lines.push(
            promLine(
                'fm_db_pool_idle',
                'Idle DB pool connections',
                'gauge',
                dbPool.idleCount as number
            )
        );
        lines.push(
            promLine(
                'fm_db_pool_waiting',
                'Queries waiting for DB connection',
                'gauge',
                dbPool.waitingCount as number
            )
        );
    }

    // Status queue (bottleneck indicator — backs up under load)
    const statusQueue = mod('statusQueue');
    if (statusQueue) {
        lines.push(
            promLine(
                'fm_status_queue_pending',
                'Pending status messages in buffer',
                'gauge',
                statusQueue.pending as number
            )
        );
        lines.push(
            promLine(
                'fm_status_queue_size',
                'Status rows queued for DB flush',
                'gauge',
                statusQueue.queueSize as number
            )
        );
        lines.push(
            promLine(
                'fm_status_queue_flushing',
                'Whether status flush is in progress',
                'gauge',
                statusQueue.flushing ? 1 : 0
            )
        );
        lines.push(
            promLine(
                'fm_em_stats_queue_size',
                'EM stats rows queued for DB flush',
                'gauge',
                statusQueue.emStatsQueueSize as number
            )
        );
    }

    // EM sync
    const emSync = mod('emSync');
    if (emSync) {
        lines.push(
            promLine(
                'fm_em_sync_queue',
                'EM devices in sync queue',
                'gauge',
                emSync.queueSize as number
            )
        );
        lines.push(
            promLine(
                'fm_em_sync_active',
                'EM syncs currently in-flight',
                'gauge',
                emSync.activeSyncs as number
            )
        );
        lines.push(
            promLine(
                'fm_em_sync_max_concurrent',
                'Max concurrent EM syncs allowed',
                'gauge',
                emSync.maxConcurrent as number
            )
        );
    }

    // Audit log queue
    const audit = mod('audit');
    if (audit) {
        lines.push(
            promLine(
                'fm_audit_queue_length',
                'Audit log entries pending flush',
                'gauge',
                audit.queueLength as number
            )
        );
    }

    // Event distributor
    const events = mod('events');
    if (events) {
        lines.push(
            promLine(
                'fm_event_listeners',
                'Active event listeners',
                'gauge',
                events.listeners as number
            )
        );
        lines.push(
            promLine(
                'fm_event_types',
                'Registered event types',
                'gauge',
                events.eventTypes as number
            )
        );
        lines.push(
            promLine(
                'fm_event_group_cache_size',
                'Group metadata cache entries',
                'gauge',
                events.groupCacheSize as number
            )
        );
    }

    // Commander (RPC components)
    const commander = mod('commander');
    if (commander) {
        lines.push(
            promLine(
                'fm_rpc_components_registered',
                'Registered RPC components',
                'gauge',
                commander.registered as number
            )
        );
    }

    // WS command handler
    const wsCommands = mod('wsCommands');
    if (wsCommands) {
        lines.push(
            promLine(
                'fm_ws_internal_commands_total',
                'Internal WS commands processed',
                'counter',
                wsCommands.internalCommands as number
            )
        );
        lines.push(
            promLine(
                'fm_ws_relay_commands_total',
                'Relayed WS commands to devices',
                'counter',
                wsCommands.relayCommands as number
            )
        );
        lines.push(
            promLine(
                'fm_ws_parse_errors_total',
                'WS message parse errors',
                'counter',
                wsCommands.parseErrors as number
            )
        );
    }

    // Plugins
    const plugins = mod('plugins');
    if (plugins) {
        lines.push(
            promLine(
                'fm_plugins_loaded',
                'Number of loaded plugins',
                'gauge',
                plugins.loadedPlugins as number
            )
        );
    }
    const pluginWorkers = mod('pluginWorkers');
    if (pluginWorkers) {
        lines.push(
            promLine(
                'fm_plugin_workers_active',
                'Active plugin worker threads',
                'gauge',
                pluginWorkers.activeWorkers as number
            )
        );
    }

    // Firmware scheduler
    const fw = mod('firmwareScheduler');
    if (fw) {
        lines.push(
            promLine(
                'fm_firmware_scheduler_running',
                'Whether auto-update scheduler is active',
                'gauge',
                fw.running as number
            )
        );
    }

    // mDNS discovery
    const mdns = mod('mdns');
    if (mdns) {
        lines.push(
            promLine(
                'fm_mdns_running',
                'Whether mDNS discovery is active',
                'gauge',
                mdns.running as number
            )
        );
    }

    // Registry cache
    const registry = mod('registry');
    if (registry) {
        lines.push(
            promLine(
                'fm_registry_file_cache_size',
                'Registry file cache entries',
                'gauge',
                registry.fileCacheSize as number
            )
        );
        lines.push(
            promLine(
                'fm_registry_db_cache_size',
                'Registry DB result cache entries',
                'gauge',
                registry.dbCacheSize as number
            )
        );
    }

    // Device GUI proxy (port exhaustion indicator)
    const deviceProxy = mod('deviceProxy');
    if (deviceProxy) {
        lines.push(
            promLine(
                'fm_device_proxy_active',
                'Active device GUI proxy instances',
                'gauge',
                deviceProxy.activeProxies as number
            )
        );
        lines.push(
            promLine(
                'fm_device_proxy_ports_total',
                'Total available proxy ports',
                'gauge',
                deviceProxy.portsTotal as number
            )
        );
    }

    // WS transport proxy (relay pairs)
    const wsTransport = mod('wsTransport');
    if (wsTransport) {
        lines.push(
            promLine(
                'fm_ws_transport_pending',
                'WS transport connections waiting to pair',
                'gauge',
                wsTransport.pendingConnections as number
            )
        );
        lines.push(
            promLine(
                'fm_ws_transport_relays',
                'Active WS transport relay pairs',
                'gauge',
                wsTransport.activeRelays as number
            )
        );
    }

    // Auth / userinfo cache
    const authMod = mod('auth');
    if (authMod) {
        lines.push(
            promLine(
                'fm_auth_userinfo_cache_size',
                'Cached userinfo entries',
                'gauge',
                authMod.userinfoCacheSize as number
            )
        );
    }

    // Init duration statistics (from ring buffer)
    if (initDurations.length > 0) {
        const sorted = initDurations
            .map((d) => d.durationMs)
            .sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const avg = Math.round(sum / sorted.length);
        const p95idx = Math.min(
            Math.floor(sorted.length * 0.95),
            sorted.length - 1
        );
        const p99idx = Math.min(
            Math.floor(sorted.length * 0.99),
            sorted.length - 1
        );
        lines.push(
            promLine(
                'fm_device_init_duration_avg_ms',
                'Avg device init duration in ms',
                'gauge',
                avg
            )
        );
        lines.push(
            promLine(
                'fm_device_init_duration_p95_ms',
                'P95 device init duration in ms',
                'gauge',
                sorted[p95idx]
            )
        );
        lines.push(
            promLine(
                'fm_device_init_duration_p99_ms',
                'P99 device init duration in ms',
                'gauge',
                sorted[p99idx]
            )
        );
        lines.push(
            promLine(
                'fm_device_init_duration_max_ms',
                'Max device init duration in ms',
                'gauge',
                sorted[sorted.length - 1]
            )
        );
        lines.push(
            promLine(
                'fm_device_init_samples',
                'Number of init duration samples in buffer',
                'gauge',
                sorted.length
            )
        );
    }

    // ── Disk usage (sampled every 60s) ─────────────────────────────────
    if (Object.keys(diskUsage).length > 0) {
        lines.push(
            '# HELP fm_disk_usage_bytes Disk usage by directory in bytes\n'
        );
        lines.push('# TYPE fm_disk_usage_bytes gauge\n');
        for (const [dir, bytes] of Object.entries(diskUsage)) {
            lines.push(promLabeled('fm_disk_usage_bytes', {dir}, bytes));
        }
    }

    // ── HTTP request stats (from web middleware) ─────────────────────────
    // These are imported lazily to avoid circular deps
    try {
        const webModule = require('./web/index');
        if (typeof webModule.getHttpStats === 'function') {
            const http = webModule.getHttpStats();

            lines.push(
                promLine(
                    'fm_http_active_requests',
                    'In-flight HTTP requests',
                    'gauge',
                    http.activeRequests
                )
            );

            if (http.statusCounts.size > 0) {
                lines.push(
                    '# HELP fm_http_responses_total HTTP responses by status class\n'
                );
                lines.push('# TYPE fm_http_responses_total counter\n');
                for (const [status, count] of http.statusCounts) {
                    lines.push(
                        promLabeled(
                            'fm_http_responses_total',
                            {status: String(status)},
                            count
                        )
                    );
                }
            }

            if (http.requestCounts.size > 0) {
                lines.push(
                    '# HELP fm_http_requests_total HTTP requests by route prefix\n'
                );
                lines.push('# TYPE fm_http_requests_total counter\n');
                for (const [route, count] of http.requestCounts) {
                    lines.push(
                        promLabeled('fm_http_requests_total', {route}, count)
                    );
                }
            }
        }
    } catch {
        /* web module not loaded yet */
    }

    // ── Detailed counters & timings (level 2+) ───────────────────────────
    if (level >= 2) {
        // Named counters as proper Prometheus metrics
        const counterDefs: Record<
            string,
            {help: string; type: 'counter' | 'gauge'}
        > = {
            devices_connected: {
                help: 'Total device connections since startup',
                type: 'counter'
            },
            devices_reconnected: {
                help: 'Total device reconnections since startup',
                type: 'counter'
            },
            devices_disconnected: {
                help: 'Total device disconnections since startup',
                type: 'counter'
            },
            ws_connections: {
                help: 'Total WS client connections since startup',
                type: 'counter'
            },
            ws_disconnections: {
                help: 'Total WS client disconnections since startup',
                type: 'counter'
            },
            ws_auth_queue_drops: {
                help: 'WS messages dropped due to full auth queue',
                type: 'counter'
            },
            status_messages: {
                help: 'Total status messages received from devices',
                type: 'counter'
            },
            status_flushes: {
                help: 'Total status queue flushes to DB',
                type: 'counter'
            },
            rpc_success: {help: 'Total successful RPC calls', type: 'counter'},
            rpc_errors: {help: 'Total failed RPC calls', type: 'counter'},
            audit_entries: {
                help: 'Total audit log entries created',
                type: 'counter'
            },
            audit_flushes: {
                help: 'Total audit log flushes to DB',
                type: 'counter'
            },
            events_broadcast: {
                help: 'Total events broadcast to listeners',
                type: 'counter'
            },
            em_syncs_completed: {
                help: 'Total EM syncs completed',
                type: 'counter'
            },
            em_syncs_failed: {help: 'Total EM syncs failed', type: 'counter'},
            mdns_discovered: {
                help: 'Total mDNS discovery events',
                type: 'counter'
            },
            device_inits_started: {
                help: 'Total device initializations started',
                type: 'counter'
            },
            device_inits_completed: {
                help: 'Total device initializations completed',
                type: 'counter'
            },
            device_inits_failed: {
                help: 'Total device initializations failed',
                type: 'counter'
            },
            waiting_room_approved: {
                help: 'Total devices approved from waiting room',
                type: 'counter'
            },
            waiting_room_denied: {
                help: 'Total devices denied from waiting room',
                type: 'counter'
            },
            auth_successes: {
                help: 'Total successful authentications',
                type: 'counter'
            },
            auth_failures: {
                help: 'Total failed authentications',
                type: 'counter'
            },
            auth_cache_hits: {help: 'Userinfo cache hits', type: 'counter'},
            auth_cache_misses: {
                help: 'Userinfo cache misses (Zitadel fetch)',
                type: 'counter'
            },
            status_flush_errors: {
                help: 'Status queue flush errors',
                type: 'counter'
            },
            em_stats_flushes: {
                help: 'EM stats queue flushes to DB',
                type: 'counter'
            },
            em_stats_flush_errors: {
                help: 'EM stats queue flush errors',
                type: 'counter'
            },
            audit_write_errors: {
                help: 'Audit log write errors',
                type: 'counter'
            },
            plugin_worker_errors: {
                help: 'Plugin worker errors',
                type: 'counter'
            },
            plugin_worker_crashes: {
                help: 'Plugin worker non-zero exits',
                type: 'counter'
            },
            device_proxy_rpc_calls: {
                help: 'Device GUI proxy RPC calls',
                type: 'counter'
            },
            device_proxy_rpc_errors: {
                help: 'Device GUI proxy RPC errors',
                type: 'counter'
            }
        };

        for (const [name, def] of Object.entries(counterDefs)) {
            const val = counters.get(name);
            if (val !== undefined) {
                lines.push(promLine(`fm_${name}`, def.help, def.type, val));
            }
        }

        // Any remaining counters not in the named list
        for (const [name, value] of counters) {
            if (!(name in counterDefs)) {
                lines.push(
                    promLine(
                        `fm_counter_${name}`,
                        `Application counter: ${name}`,
                        'counter',
                        value
                    )
                );
            }
        }

        // Application gauges
        if (gauges.size > 0) {
            for (const [name, value] of gauges) {
                lines.push(
                    promLine(
                        `fm_gauge_${name}`,
                        `Application gauge: ${name}`,
                        'gauge',
                        value
                    )
                );
            }
        }

        // RPC timings
        if (rpcTimings.size > 0) {
            lines.push(
                '# HELP fm_rpc_calls_total Total RPC calls per method\n'
            );
            lines.push('# TYPE fm_rpc_calls_total counter\n');
            lines.push(
                '# HELP fm_rpc_duration_ms_total Total RPC duration per method in ms\n'
            );
            lines.push('# TYPE fm_rpc_duration_ms_total counter\n');
            lines.push(
                '# HELP fm_rpc_duration_ms_max Max RPC duration per method in ms\n'
            );
            lines.push('# TYPE fm_rpc_duration_ms_max gauge\n');
            lines.push(
                '# HELP fm_rpc_duration_ms_avg Avg RPC duration per method in ms\n'
            );
            lines.push('# TYPE fm_rpc_duration_ms_avg gauge\n');
            for (const [method, stats] of rpcTimings) {
                lines.push(
                    promLabeled('fm_rpc_calls_total', {method}, stats.count)
                );
                lines.push(
                    promLabeled(
                        'fm_rpc_duration_ms_total',
                        {method},
                        Math.round(stats.totalMs)
                    )
                );
                lines.push(
                    promLabeled(
                        'fm_rpc_duration_ms_max',
                        {method},
                        Math.round(stats.maxMs)
                    )
                );
                lines.push(
                    promLabeled(
                        'fm_rpc_duration_ms_avg',
                        {method},
                        Math.round(stats.totalMs / stats.count)
                    )
                );
            }
        }

        // DB timings
        if (dbTimings.size > 0) {
            lines.push('# HELP fm_db_calls_total Total DB calls per query\n');
            lines.push('# TYPE fm_db_calls_total counter\n');
            lines.push(
                '# HELP fm_db_duration_ms_total Total DB duration per query in ms\n'
            );
            lines.push('# TYPE fm_db_duration_ms_total counter\n');
            lines.push(
                '# HELP fm_db_duration_ms_max Max DB duration per query in ms\n'
            );
            lines.push('# TYPE fm_db_duration_ms_max gauge\n');
            lines.push(
                '# HELP fm_db_duration_ms_avg Avg DB duration per query in ms\n'
            );
            lines.push('# TYPE fm_db_duration_ms_avg gauge\n');
            for (const [method, stats] of dbTimings) {
                lines.push(
                    promLabeled('fm_db_calls_total', {method}, stats.count)
                );
                lines.push(
                    promLabeled(
                        'fm_db_duration_ms_total',
                        {method},
                        Math.round(stats.totalMs)
                    )
                );
                lines.push(
                    promLabeled(
                        'fm_db_duration_ms_max',
                        {method},
                        Math.round(stats.maxMs)
                    )
                );
                lines.push(
                    promLabeled(
                        'fm_db_duration_ms_avg',
                        {method},
                        Math.round(stats.totalMs / stats.count)
                    )
                );
            }
        }

        // WS message breakdown
        if (wsMessageTypes.size > 0) {
            lines.push(
                '# HELP fm_ws_messages_total WebSocket messages by type\n'
            );
            lines.push('# TYPE fm_ws_messages_total counter\n');
            for (const [type, count] of wsMessageTypes) {
                lines.push(promLabeled('fm_ws_messages_total', {type}, count));
            }
        }

        // Error ring buffers
        lines.push(
            promLine(
                'fm_rpc_error_buffer_size',
                'RPC errors in ring buffer',
                'gauge',
                rpcErrors.length
            )
        );
        lines.push(
            promLine(
                'fm_init_failure_buffer_size',
                'Init failures in ring buffer',
                'gauge',
                initFailures.length
            )
        );
    }

    return lines.join('');
}

// ── Debug Report ──────────────────────────────────────────────────────────
export function getDebugReport() {
    const metrics = getMetrics();
    return {
        ...metrics,
        rpcErrors: [...rpcErrors],
        initFailures: [...initFailures],
        wsMessageBreakdown: Object.fromEntries(wsMessageTypes),
        initDurations: [...initDurations],
        timestamp: Date.now()
    };
}
