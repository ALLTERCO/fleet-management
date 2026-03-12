import {defineStore} from 'pinia';
import {computed, ref, watch} from 'vue';
import apiClient from '@/helpers/axios';
import {isDebugEnabled, setDebug} from '@/tools/debug';
import {
    fetchBackendMetrics,
    getCounterRates,
    getObsLevel,
    getPendingRpcCount,
    getRpcTimings,
    getWsMessagesPerSec,
    getWsTelemetry,
    isWsTelemetryEnabled,
    type ObsLevel,
    type RpcTimingEntry,
    setObsLevel,
    setWsTelemetry
} from '@/tools/observability';

export type FlowStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export interface MetricSnapshot {
    ts: number;
    eventLoopLagMs: number;
    rssM: number;
    heapUsedM: number;
    heapTotalM: number;
    heapTrend: string;
    wsClients: number;
    // Module gauges
    devicesTotal: number;
    initActive: number;
    initQueued: number;
    statusQueueSize: number;
    statusFlushing: boolean;
    dbPoolTotal: number;
    dbPoolIdle: number;
    dbPoolWaiting: number;
    auditQueueLength: number;
    // Service gauges
    waitingRoomPending: number;
    emQueueSize: number;
    emActiveSyncs: number;
    pluginsLoaded: number;
    pluginWorkers: number;
    eventsListeners: number;
    eventsTypes: number;
    eventsBroadcastRate: number;
    commanderComponents: number;
    mdnsRunning: number;
    firmwareRunning: number;
    registryCacheSize: number;
    // System metrics
    cpuUserPct: number;
    cpuSystemPct: number;
    osFreeMemM: number;
    osTotalMemM: number;
    osLoadAvg1: number;
    osLoadAvg5: number;
    osLoadAvg15: number;
    eventLoopP50: number;
    eventLoopP95: number;
    eventLoopP99: number;
    gcTotalPauseMs: number;
    gcPauseCount: number;
    gcMaxPauseMs: number;
    externalM: number;
    arrayBuffersM: number;
    activeHandles: number;
    // Bottleneck isolation gauges
    lastFlushMs: number;
    lastFlushBatchSize: number;
    statusCacheEntries: number;
    broadcastMaxMs: number;
    serializeMaxMs: number;
    wsMaxBufferedKB: number;
    // Tier 2+ (0 when unavailable)
    rpcSuccessRate: number;
    rpcErrorRate: number;
    rpcAvgMs: number;
    dbAvgMs: number;
    initFailureRate: number;
    statusMsgRate: number;
}

const HISTORY_SIZE = 720;

function ringPush<T>(arr: T[], item: T, max: number) {
    if (arr.length >= max) arr.shift();
    arr.push(item);
}

function worstStatus(...statuses: FlowStatus[]): FlowStatus {
    if (statuses.includes('critical')) return 'critical';
    if (statuses.includes('warning')) return 'warning';
    if (statuses.includes('unknown')) return 'unknown';
    return 'healthy';
}

function computeAvgMs(timings: any): number {
    if (!timings) return 0;
    const entries = Object.values(timings) as any[];
    if (entries.length === 0) return 0;
    return Math.round(
        entries.reduce((s: number, e: any) => s + e.avgMs, 0) / entries.length
    );
}

function extractSnapshot(
    metrics: any,
    rates: Record<string, number>
): MetricSnapshot {
    const modules = metrics?.modules ?? {};
    const di = modules.deviceInit ?? {};
    const sq = modules.statusQueue ?? {};
    const pool = modules.dbPool ?? {};
    const audit = modules.audit ?? {};
    const devices = modules.devices ?? {};
    const waitingRoom = modules.waitingRoom ?? {};
    const emSync = modules.emSync ?? {};
    const plugins = modules.plugins ?? {};
    const pluginWorkersM = modules.pluginWorkers ?? {};
    const events = modules.events ?? {};
    const commander = modules.commander ?? {};
    const mdnsM = modules.mdns ?? {};
    const firmware = modules.firmwareScheduler ?? {};
    const registry = modules.registry ?? {};

    const rpcAvgMs = computeAvgMs(metrics?.rpcTimings);
    const dbAvgMs = computeAvgMs(metrics?.dbTimings);

    return {
        ts: Date.now(),
        eventLoopLagMs: metrics?.eventLoopLagMs ?? 0,
        rssM: metrics?.memory?.rssM ?? 0,
        heapUsedM: metrics?.memory?.heapUsedM ?? 0,
        heapTotalM: metrics?.memory?.heapTotalM ?? 0,
        heapTrend: metrics?.memory?.heapTrend ?? 'stable',
        externalM: metrics?.memory?.externalM ?? 0,
        arrayBuffersM: metrics?.memory?.arrayBuffersM ?? 0,
        wsClients: metrics?.wsClients ?? 0,
        cpuUserPct: metrics?.cpu?.userPct ?? 0,
        cpuSystemPct: metrics?.cpu?.systemPct ?? 0,
        osFreeMemM: metrics?.os?.freeMemM ?? 0,
        osTotalMemM: metrics?.os?.totalMemM ?? 0,
        osLoadAvg1: metrics?.os?.loadAvg?.[0] ?? 0,
        osLoadAvg5: metrics?.os?.loadAvg?.[1] ?? 0,
        osLoadAvg15: metrics?.os?.loadAvg?.[2] ?? 0,
        eventLoopP50: metrics?.eventLoopHistogram?.p50 ?? 0,
        eventLoopP95: metrics?.eventLoopHistogram?.p95 ?? 0,
        eventLoopP99: metrics?.eventLoopHistogram?.p99 ?? 0,
        gcTotalPauseMs: metrics?.gc?.totalPauseMs ?? 0,
        gcPauseCount: metrics?.gc?.pauseCount ?? 0,
        gcMaxPauseMs: metrics?.gc?.maxPauseMs ?? 0,
        activeHandles: metrics?.activeHandles ?? 0,
        devicesTotal: devices.total ?? 0,
        initActive: di.active ?? 0,
        initQueued: di.queued ?? 0,
        statusQueueSize: sq.queueSize ?? sq.pending ?? 0,
        statusFlushing: sq.flushing ?? false,
        dbPoolTotal: pool.totalCount ?? 0,
        dbPoolIdle: pool.idleCount ?? 0,
        dbPoolWaiting: pool.waitingCount ?? 0,
        auditQueueLength: audit.queueLength ?? 0,
        waitingRoomPending: waitingRoom.pendingDevices ?? 0,
        emQueueSize: emSync.queueSize ?? 0,
        emActiveSyncs: emSync.activeSyncs ?? 0,
        pluginsLoaded: plugins.loadedPlugins ?? 0,
        pluginWorkers: pluginWorkersM.activeWorkers ?? 0,
        eventsListeners: events.listeners ?? 0,
        eventsTypes: events.eventTypes ?? 0,
        eventsBroadcastRate: rates.events_broadcast ?? 0,
        commanderComponents: commander.registered ?? 0,
        mdnsRunning: mdnsM.running ?? 0,
        firmwareRunning: firmware.running ?? 0,
        registryCacheSize:
            (registry.fileCacheSize ?? 0) + (registry.dbCacheSize ?? 0),
        lastFlushMs: sq.lastFlushMs ?? 0,
        lastFlushBatchSize: sq.lastFlushBatchSize ?? 0,
        statusCacheEntries: sq.statusCacheEntries ?? 0,
        broadcastMaxMs: events.broadcastMaxMs ?? 0,
        serializeMaxMs: events.serializeMaxMs ?? 0,
        wsMaxBufferedKB: metrics?.gauges?.ws_max_buffered_kb ?? 0,
        rpcSuccessRate: rates.rpc_success ?? 0,
        rpcErrorRate: rates.rpc_errors ?? 0,
        rpcAvgMs,
        dbAvgMs,
        initFailureRate: rates.device_inits_failed ?? 0,
        statusMsgRate: rates.status_messages ?? 0
    };
}

export const useMonitoringStore = defineStore('monitoring', () => {
    const obsLevel = ref<ObsLevel>(getObsLevel());
    const latestMetrics = ref<any>(null);
    const history = ref<MetricSnapshot[]>([]);
    const counterRates = ref<Record<string, number>>({});
    const rpcTimings = ref<readonly RpcTimingEntry[]>([]);
    const wsMessagesPerSec = ref(0);
    const pendingRpcCount = ref(0);
    const polling = ref(false);
    const logLevels = ref<Record<string, string>>({});
    const frontendDebug = ref(isDebugEnabled());
    const dbWritesDisabled = ref(false);
    const wsTelemetryEnabled = ref(isWsTelemetryEnabled());
    const wsTelemetryData = ref({ patchBufferMaxDepth: 0, droppedFrameCount: 0, rafFrameTimeMaxMs: 0 });
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let _historyGen = 0;
    const _historyFieldCache = new Map<string, {gen: number; data: number[]}>();

    // ── Health derivation ─────────────────────────────────────────────
    const latest = computed(() =>
        history.value.length > 0
            ? history.value[history.value.length - 1]
            : null
    );

    const deviceIngestStatus = computed<FlowStatus>(() => {
        if (!latest.value || obsLevel.value === 0) return 'unknown';
        const snap = latest.value;
        if (snap.initFailureRate > 10 || snap.initActive > 100)
            return 'critical';
        if (snap.initFailureRate > 2 || snap.initActive > 50) return 'warning';
        return 'healthy';
    });

    const statusPipelineStatus = computed<FlowStatus>(() => {
        if (!latest.value || obsLevel.value === 0) return 'unknown';
        const snap = latest.value;
        if (snap.statusFlushing && snap.statusQueueSize > 100)
            return 'critical';
        if (snap.statusQueueSize > 50) return 'warning';
        return 'healthy';
    });

    const rpcCommandsStatus = computed<FlowStatus>(() => {
        if (!latest.value || obsLevel.value === 0) return 'unknown';
        const snap = latest.value;
        if (snap.rpcErrorRate > 10 || snap.rpcAvgMs > 1000) return 'critical';
        if (snap.rpcErrorRate > 2 || snap.rpcAvgMs > 500) return 'warning';
        return 'healthy';
    });

    const databaseStatus = computed<FlowStatus>(() => {
        if (!latest.value || obsLevel.value === 0) return 'unknown';
        const snap = latest.value;
        if (snap.dbPoolWaiting > 5 || snap.dbAvgMs > 500) return 'critical';
        if (snap.dbPoolWaiting > 0 || snap.dbAvgMs > 200) return 'warning';
        return 'healthy';
    });

    const emSyncStatus = computed<FlowStatus>(() => {
        if (!latest.value || obsLevel.value === 0) return 'unknown';
        const snap = latest.value;
        if (snap.emActiveSyncs >= 40 && snap.emQueueSize > 200)
            return 'critical';
        if (snap.emActiveSyncs > 30) return 'warning';
        return 'healthy';
    });

    const waitingRoomStatus = computed<FlowStatus>(() => {
        if (!latest.value || obsLevel.value === 0) return 'unknown';
        const snap = latest.value;
        if (snap.waitingRoomPending > 100) return 'critical';
        if (snap.waitingRoomPending > 20) return 'warning';
        return 'healthy';
    });

    const eventsStatus = computed<FlowStatus>(() => {
        if (!latest.value || obsLevel.value === 0) return 'unknown';
        const snap = latest.value;
        if (snap.eventsListeners > 1000) return 'critical';
        if (snap.eventsListeners > 500) return 'warning';
        return 'healthy';
    });

    const overallStatus = computed<FlowStatus>(() => {
        return worstStatus(
            deviceIngestStatus.value,
            statusPipelineStatus.value,
            rpcCommandsStatus.value,
            databaseStatus.value,
            emSyncStatus.value,
            waitingRoomStatus.value,
            eventsStatus.value
        );
    });

    // ── Actions ───────────────────────────────────────────────────────
    async function fetchAndRecord() {
        const metrics = await fetchBackendMetrics();
        if (!metrics) return;
        latestMetrics.value = metrics;
        dbWritesDisabled.value = metrics.dbWritesDisabled ?? false;
        counterRates.value = getCounterRates();
        rpcTimings.value = [...getRpcTimings()];
        wsMessagesPerSec.value = getWsMessagesPerSec();
        pendingRpcCount.value = getPendingRpcCount();

        const snapshot = extractSnapshot(metrics, counterRates.value);
        ringPush(history.value, snapshot, HISTORY_SIZE);
        _historyGen++;
        _historyFieldCache.clear();

        // Snapshot WS telemetry (resets peak values on read)
        if (wsTelemetryEnabled.value) {
            wsTelemetryData.value = getWsTelemetry();
        }
    }

    async function loadHistory() {
        try {
            const res = await fetch('/health/history');
            const data = await res.json();
            if (Array.isArray(data.history)) {
                const snapshots = data.history.map((entry: any) =>
                    extractSnapshot(entry.metrics, {})
                );
                // Replace history with backend data, keep within size limit
                history.value = snapshots.slice(-HISTORY_SIZE);
                _historyGen++;
                _historyFieldCache.clear();
            }
        } catch {
            // Backend history not available, start from scratch
        }
    }

    function startPolling() {
        if (polling.value) return;
        polling.value = true;
        loadHistory().then(() => fetchAndRecord());
        const POLL_INTERVAL_HIGH = 2000;
        const POLL_INTERVAL_DEFAULT = 5000;
        const interval =
            obsLevel.value >= 3 ? POLL_INTERVAL_HIGH : POLL_INTERVAL_DEFAULT;
        pollTimer = setInterval(fetchAndRecord, interval);
    }

    function stopPolling() {
        polling.value = false;
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = undefined;
        }
    }

    function changeLevel(l: ObsLevel) {
        obsLevel.value = l;
        setObsLevel(l);
        apiClient.post('/health/observability', {level: l}).catch(() => {});

        // Restart polling with new interval
        if (polling.value) {
            stopPolling();
            if (l > 0) startPolling();
        }
    }

    function historyField(field: keyof MetricSnapshot): number[] {
        const key = field as string;
        const cached = _historyFieldCache.get(key);
        if (cached && cached.gen === _historyGen) return cached.data;
        const data = history.value.map((s) => {
            const v = s[field];
            return typeof v === 'number' ? v : 0;
        });
        _historyFieldCache.set(key, {gen: _historyGen, data});
        return data;
    }

    // ── Log level management ─────────────────────────────────────────
    async function fetchLogLevels() {
        try {
            const {data} = await apiClient.get('/health/log-levels');
            logLevels.value = data.levels ?? {};
        } catch {
            // Endpoint may not be available
        }
    }

    async function setLogLevel(category: string, level: string) {
        await apiClient.post('/health/log-level', {category, level});
        logLevels.value[category] = level;
    }

    async function setAllLogLevels(level: string) {
        const categories = Object.keys(logLevels.value);
        await Promise.all(categories.map((cat) => setLogLevel(cat, level)));
    }

    function toggleFrontendDebug(value: boolean) {
        setDebug(value);
        frontendDebug.value = value;
    }

    function toggleWsTelemetry(value: boolean) {
        setWsTelemetry(value);
        wsTelemetryEnabled.value = value;
        if (!value) {
            wsTelemetryData.value = { patchBufferMaxDepth: 0, droppedFrameCount: 0, rafFrameTimeMaxMs: 0 };
        }
    }

    // Restart polling when level changes externally (e.g. from another tab)
    watch(obsLevel, (newLevel) => {
        if (polling.value && newLevel === 0) stopPolling();
    });

    return {
        obsLevel,
        latestMetrics,
        history,
        counterRates,
        rpcTimings,
        wsMessagesPerSec,
        pendingRpcCount,
        polling,
        logLevels,
        frontendDebug,
        dbWritesDisabled,
        wsTelemetryEnabled,
        wsTelemetryData,
        latest,
        deviceIngestStatus,
        statusPipelineStatus,
        rpcCommandsStatus,
        databaseStatus,
        emSyncStatus,
        waitingRoomStatus,
        eventsStatus,
        overallStatus,
        fetchAndRecord,
        loadHistory,
        startPolling,
        stopPolling,
        changeLevel,
        historyField,
        fetchLogLevels,
        setLogLevel,
        setAllLogLevels,
        toggleFrontendDebug,
        toggleWsTelemetry
    };
});
