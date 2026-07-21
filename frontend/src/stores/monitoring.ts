import {defineStore} from 'pinia';
import {computed, ref, watch} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {
    DB_AVG_CRITICAL_MS,
    DB_AVG_WARN_MS,
    DB_POOL_WAITING_CRITICAL,
    DB_POOL_WAITING_WARN,
    EVENT_LISTENERS_CRITICAL,
    EVENT_LISTENERS_WARN,
    RPC_AVG_CRITICAL_MS,
    RPC_AVG_WARN_MS,
    RPC_ERR_RATE_CRITICAL_PCT,
    RPC_ERR_RATE_WARN_PCT
} from '@/helpers/monitoring-thresholds';
import {isDebugEnabled, setDebug} from '@/tools/debug';
import {
    counterRatesBetween,
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
import {sendRPC} from '@/tools/websocket';
import {createStaleGuard} from './staleGuard';
import {useToastStore} from './toast';

export type FlowStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export interface MetricSnapshot {
    ts: number;
    eventLoopLagMs: number;
    rssM: number;
    heapUsedM: number;
    heapTotalM: number;
    heapLimitM: number;
    heapTrend: string;
    wsClients: number;
    // Module gauges
    devicesTotal: number;
    initActive: number;
    initQueued: number;
    initOldestHeldMs: number;
    initOldestQueuedMs: number;
    initReclaimedTotal: number;
    buildSlowCount: number;
    buildSlowestMs: number;
    statusQueueSize: number;
    statusFlushing: boolean;
    dbPoolTotal: number;
    dbPoolIdle: number;
    dbPoolWaiting: number;
    dbRuntimeStatus: string;
    dbRuntimeStatusCode: number;
    dbRuntimeCheckedAt: string;
    dbRuntimeCheckAgeSec: number;
    dbRuntimeLastSuccessfulAt: string;
    dbRuntimeLastSuccessfulAgeSec: number;
    dbRuntimePostgresVersion: string;
    dbRuntimePostgresMajor: number;
    dbRuntimeTimescaleVersion: string;
    dbRuntimeExpectedTimescaleImage: string;
    dbRuntimeExpectedTimescaleVersion: string;
    dbRuntimeError: string;
    auditQueueLength: number;
    // Service gauges
    waitingRoomPending: number;
    emQueueSize: number;
    emActiveSyncs: number;
    emSyncOldestHeldMs: number;
    emSyncStuck: number;
    emSyncStreamDepth: number;
    emSyncStreamOldestAgeMs: number;
    emSyncStreamPending: number;
    emSyncRowsWrittenPerMin: number;
    emSyncLastWriteRows: number;
    emSyncLastWriteMs: number;
    emSyncLastWriteRowsPerSec: number;
    emSyncLastRpcFetchMs: number;
    emSyncLastRpcRecords: number;
    emSyncLastPassBlocks: number;
    emSyncLastPassMs: number;
    emSyncWorstChannelLagSec: number;
    emSyncLaggedChannels: number;
    emSyncWorstLagDeviceId: string;
    emSyncWorstLagChannel: number;
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
    wsStrugglingClients: number;
    wsWorstBufferedKB: number;
    // Tier 2+ (0 when unavailable)
    rpcSuccessRate: number;
    rpcErrorRate: number;
    rpcAvgMs: number;
    dbAvgMs: number;
    initFailureRate: number;
    statusMsgRate: number;
}

const HISTORY_SIZE = 720;

function ringPush<T>(arr: T[], entry: {item: T; max: number}) {
    if (arr.length >= entry.max) arr.shift();
    arr.push(entry.item);
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
    // A timing entry from an older or partial backend shape may lack avgMs;
    // treat it as 0 so one gap can't poison the whole average to NaN.
    return Math.round(
        entries.reduce(
            (s: number, e: any) =>
                s + (Number.isFinite(e?.avgMs) ? e.avgMs : 0),
            0
        ) / entries.length
    );
}

interface LabeledMetricEntry {
    labels: Record<string, string>;
    value: number;
}

function labeledMetricEntries(
    metrics: any,
    bucket: 'labeledCounters' | 'labeledGauges',
    name: string
): LabeledMetricEntry[] {
    const source = metrics?.[bucket] ?? {};
    const entries: LabeledMetricEntry[] = [];
    for (const [key, rawValue] of Object.entries(source)) {
        let parsed: {name?: unknown; labels?: unknown};
        try {
            parsed = JSON.parse(key);
        } catch {
            continue;
        }
        if (parsed.name !== name || !parsed.labels) continue;
        const value = Number(rawValue);
        if (!Number.isFinite(value)) continue;
        entries.push({
            labels: parsed.labels as Record<string, string>,
            value
        });
    }
    return entries;
}

function labeledGaugeValue(
    metrics: any,
    name: string,
    labels: Record<string, string>
): number {
    return (
        labeledMetricEntries(metrics, 'labeledGauges', name).find((entry) =>
            Object.entries(labels).every(
                ([key, value]) => entry.labels[key] === value
            )
        )?.value ?? 0
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
    const dbRuntime = modules.dbRuntime ?? {};
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
    const gauges = metrics?.gauges ?? {};
    const rpcAvgMs = computeAvgMs(metrics?.rpcTimings);
    const dbAvgMs = computeAvgMs(metrics?.dbTimings);

    return {
        ts: Date.now(),
        eventLoopLagMs: metrics?.eventLoopLagMs ?? 0,
        rssM: metrics?.memory?.rssM ?? 0,
        heapUsedM: metrics?.memory?.heapUsedM ?? 0,
        heapTotalM: metrics?.memory?.heapTotalM ?? 0,
        heapLimitM: metrics?.memory?.heapLimitM ?? 0,
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
        initOldestHeldMs: di.oldestHeldMs ?? 0,
        initOldestQueuedMs: di.oldestQueuedMs ?? 0,
        initReclaimedTotal: di.reclaimedTotal ?? 0,
        buildSlowCount: di.slowBuilds ?? 0,
        buildSlowestMs: di.slowestBuildMs ?? 0,
        statusQueueSize: sq.queueSize ?? sq.pending ?? 0,
        statusFlushing: sq.flushing ?? false,
        dbPoolTotal: pool.totalCount ?? 0,
        dbPoolIdle: pool.idleCount ?? 0,
        dbPoolWaiting: pool.waitingCount ?? 0,
        dbRuntimeStatus: dbRuntime.status ?? 'unknown',
        dbRuntimeStatusCode: dbRuntime.statusCode ?? 0,
        dbRuntimeCheckedAt: dbRuntime.checkedAt ?? '',
        dbRuntimeCheckAgeSec: dbRuntime.checkAgeSeconds ?? -1,
        dbRuntimeLastSuccessfulAt: dbRuntime.lastSuccessfulAt ?? '',
        dbRuntimeLastSuccessfulAgeSec: dbRuntime.lastSuccessfulAgeSeconds ?? -1,
        dbRuntimePostgresVersion: dbRuntime.postgresVersion ?? '',
        dbRuntimePostgresMajor: dbRuntime.postgresMajor ?? -1,
        dbRuntimeTimescaleVersion: dbRuntime.timescaleVersion ?? '',
        dbRuntimeExpectedTimescaleImage: dbRuntime.expectedTimescaleImage ?? '',
        dbRuntimeExpectedTimescaleVersion:
            dbRuntime.expectedTimescaleVersion ?? '',
        dbRuntimeError: dbRuntime.error ?? '',
        auditQueueLength: audit.queueLength ?? 0,
        waitingRoomPending: waitingRoom.pendingDevices ?? 0,
        emQueueSize: emSync.queueSize ?? 0,
        emActiveSyncs: emSync.activeSyncs ?? 0,
        emSyncOldestHeldMs: emSync.oldestHeldMs ?? 0,
        emSyncStuck: emSync.stuck ?? 0,
        emSyncStreamDepth: labeledGaugeValue(metrics, 'stream_length', {
            stream: 'em-sync-buffer'
        }),
        emSyncStreamOldestAgeMs: labeledGaugeValue(
            metrics,
            'stream_oldest_age_ms',
            {stream: 'em-sync-buffer'}
        ),
        emSyncStreamPending: labeledGaugeValue(
            metrics,
            'stream_pending_entries',
            {stream: 'em-sync-buffer'}
        ),
        emSyncRowsWrittenPerMin: rates.em_sync_buffer_rows_written ?? 0,
        emSyncLastWriteRows: gauges.em_sync_last_write_rows ?? 0,
        emSyncLastWriteMs: gauges.em_sync_last_write_ms ?? 0,
        emSyncLastWriteRowsPerSec: gauges.em_sync_last_write_rows_per_sec ?? 0,
        emSyncLastRpcFetchMs: gauges.em_sync_last_rpc_fetch_ms ?? 0,
        emSyncLastRpcRecords: gauges.em_sync_last_rpc_records ?? 0,
        emSyncLastPassBlocks: gauges.em_sync_last_pass_blocks ?? 0,
        emSyncLastPassMs: gauges.em_sync_last_pass_ms ?? 0,
        emSyncWorstChannelLagSec: Math.round(
            emSync.worstChannelLagSeconds ??
                gauges.em_sync_worst_channel_lag_seconds ??
                0
        ),
        emSyncLaggedChannels:
            emSync.laggedChannels ?? gauges.em_sync_lagged_channels ?? 0,
        emSyncWorstLagDeviceId: emSync.worstLagDeviceId ?? '',
        emSyncWorstLagChannel: emSync.worstLagChannel ?? -1,
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
        wsStrugglingClients: metrics?.wsClientHealth?.strugglingClients ?? 0,
        wsWorstBufferedKB: Math.round(
            (metrics?.wsClientHealth?.worstBufferedBytes ?? 0) / 1024
        ),
        rpcSuccessRate: rates.rpc_success ?? 0,
        rpcErrorRate: rates.rpc_errors ?? 0,
        rpcAvgMs,
        dbAvgMs,
        initFailureRate: rates.device_inits_failed ?? 0,
        statusMsgRate: rates.status_messages ?? 0
    };
}

export const useMonitoringStore = defineStore('monitoring', () => {
    const toast = useToastStore();
    const obsLevel = ref<ObsLevel>(getObsLevel());
    const latestMetrics = ref<any>(null);
    const history = ref<MetricSnapshot[]>([]);
    const counterRates = ref<Record<string, number>>({});
    const rpcTimings = ref<readonly RpcTimingEntry[]>([]);
    const wsMessagesPerSec = ref(0);
    const pendingRpcCount = ref(0);
    const polling = ref(false);
    const logLevels = ref<Record<string, string>>({});
    // Guards logLevels: a setLogLevel bump invalidates an in-flight list fetch.
    const logLevelGuard = createStaleGuard();
    const frontendDebug = ref(isDebugEnabled());
    const dbWritesDisabled = ref(false);
    const wsTelemetryEnabled = ref(isWsTelemetryEnabled());
    const wsTelemetryData = ref({
        patchBufferMaxDepth: 0,
        droppedFrameCount: 0,
        rafFrameTimeMaxMs: 0,
        shellyConnectReceived: 0,
        shellyDisconnectReceived: 0,
        shellyConnectLatencyMs: {count: 0, last: 0, max: 0, p50: 0, p95: 0},
        shellyDisconnectLatencyMs: {count: 0, last: 0, max: 0, p50: 0, p95: 0}
    });
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
        if (
            snap.rpcErrorRate > RPC_ERR_RATE_CRITICAL_PCT ||
            snap.rpcAvgMs > RPC_AVG_CRITICAL_MS
        )
            return 'critical';
        if (
            snap.rpcErrorRate > RPC_ERR_RATE_WARN_PCT ||
            snap.rpcAvgMs > RPC_AVG_WARN_MS
        )
            return 'warning';
        return 'healthy';
    });

    const databaseStatus = computed<FlowStatus>(() => {
        if (!latest.value || obsLevel.value === 0) return 'unknown';
        const snap = latest.value;
        if ([3, 4].includes(snap.dbRuntimeStatusCode)) return 'critical';
        if (snap.dbRuntimeStatusCode === 2 || snap.dbRuntimeCheckAgeSec > 900)
            return 'warning';
        if (
            snap.dbPoolWaiting > DB_POOL_WAITING_CRITICAL ||
            snap.dbAvgMs > DB_AVG_CRITICAL_MS
        )
            return 'critical';
        if (
            snap.dbPoolWaiting > DB_POOL_WAITING_WARN ||
            snap.dbAvgMs > DB_AVG_WARN_MS
        )
            return 'warning';
        return 'healthy';
    });

    const emSyncStatus = computed<FlowStatus>(() => {
        if (!latest.value || obsLevel.value === 0) return 'unknown';
        const snap = latest.value;
        if (
            snap.emSyncStreamDepth > 200000 ||
            snap.emSyncStreamOldestAgeMs > 30 * 60 * 1000 ||
            snap.emSyncStreamPending > 10000 ||
            snap.emSyncLastWriteMs > 5000 ||
            snap.emSyncLastRpcFetchMs > 10000 ||
            snap.emSyncWorstChannelLagSec > 6 * 3600
        )
            return 'critical';
        if (snap.emActiveSyncs >= 40 && snap.emQueueSize > 200)
            return 'critical';
        if (
            snap.emSyncStreamDepth > 50000 ||
            snap.emSyncStreamOldestAgeMs > 5 * 60 * 1000 ||
            snap.emSyncStreamPending > 1000 ||
            snap.emSyncLastWriteMs > 1500 ||
            snap.emSyncLastRpcFetchMs > 3000 ||
            snap.emSyncWorstChannelLagSec > 3600
        )
            return 'warning';
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
        if (snap.eventsListeners > EVENT_LISTENERS_CRITICAL) return 'critical';
        if (snap.eventsListeners > EVENT_LISTENERS_WARN) return 'warning';
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
        ringPush(history.value, {item: snapshot, max: HISTORY_SIZE});
        _historyGen++;
        _historyFieldCache.clear();

        // Snapshot WS telemetry (resets peak values on read)
        if (wsTelemetryEnabled.value) {
            wsTelemetryData.value = getWsTelemetry();
        }
    }

    async function loadHistory() {
        try {
            const data = await sendRPC<{
                history?: Array<{ts: number; metrics: unknown}>;
            }>('FLEET_MANAGER', 'System.Health.GetHistory', {});
            if (Array.isArray(data?.history)) {
                // Reconstruct per-minute counter rates from consecutive history
                // points via the same shared helper the live path uses, so the
                // rate-backed fields show real historical values instead of a
                // fabricated flat zero. The first point has no predecessor.
                let prevCounters: Record<string, number> | null = null;
                let prevTs = 0;
                const snapshots = data.history.map((entry) => {
                    const counters =
                        ((entry.metrics as any)?.counters as Record<
                            string,
                            number
                        >) ?? {};
                    const rates = prevCounters
                        ? counterRatesBetween(
                              prevCounters,
                              counters,
                              (entry.ts - prevTs) / 60000
                          )
                        : {};
                    prevCounters = counters;
                    prevTs = entry.ts;
                    return extractSnapshot(entry.metrics, rates);
                });
                history.value = snapshots.slice(-HISTORY_SIZE);
                _historyGen++;
                _historyFieldCache.clear();
            }
        } catch (err) {
            // Fail loud: a rejected RPC or a malformed history payload (an array
            // whose entries fail to parse) is a real fault — not the benign "no
            // history yet" case, which returns a non-array and never reaches
            // here. Surface it and re-throw so the failure is visible instead of
            // masquerading as empty history.
            console.error('Failed to load monitoring history', err);
            toastRpcError(toast, err, 'Failed to load monitoring history');
            throw err;
        }
    }

    function startPolling() {
        if (polling.value) return;
        polling.value = true;
        // loadHistory surfaces its own error; swallow here only to keep polling
        // live metrics when historical backfill fails.
        loadHistory()
            .catch(() => {})
            .then(() => fetchAndRecord());
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

    async function changeLevel(l: ObsLevel) {
        const previous = obsLevel.value;
        obsLevel.value = l;
        setObsLevel(l);
        restartPollingForLevel(l);

        try {
            await sendRPC('FLEET_MANAGER', 'System.Observability.Set', {
                level: l
            });
        } catch (err) {
            obsLevel.value = previous;
            setObsLevel(previous);
            restartPollingForLevel(previous);
            toastRpcError(toast, err, 'Failed to set observability level');
        }
    }

    function restartPollingForLevel(l: ObsLevel) {
        if (!polling.value) return;
        stopPolling();
        if (l > 0) startPolling();
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
        const token = logLevelGuard.bump();
        try {
            const data = await sendRPC<{levels?: Record<string, string>}>(
                'FLEET_MANAGER',
                'System.Log.ListLevels',
                {}
            );
            if (logLevelGuard.isStale(token)) return;
            logLevels.value = data.levels ?? {};
        } catch {
            // Endpoint may not be available
        }
    }

    async function setLogLevel(category: string, level: string) {
        await sendRPC('FLEET_MANAGER', 'System.Log.SetLevel', {
            category,
            level
        });
        logLevels.value[category] = level;
        logLevelGuard.bump();
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
            wsTelemetryData.value = {
                patchBufferMaxDepth: 0,
                droppedFrameCount: 0,
                rafFrameTimeMaxMs: 0,
                shellyConnectReceived: 0,
                shellyDisconnectReceived: 0,
                shellyConnectLatencyMs: {
                    count: 0,
                    last: 0,
                    max: 0,
                    p50: 0,
                    p95: 0
                },
                shellyDisconnectLatencyMs: {
                    count: 0,
                    last: 0,
                    max: 0,
                    p50: 0,
                    p95: 0
                }
            };
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
