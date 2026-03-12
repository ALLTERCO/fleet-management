<template>
    <div class="space-y-6 p-2">
        <!-- Header: overall health + control panel link -->
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-3">
                <HealthDot :status="store.overallStatus" />
                <h2 class="heading-section">System Health</h2>
                <span v-if="store.latestMetrics" class="text-xs font-mono overview-uptime">
                    Uptime: {{ formatUptime(store.latestMetrics.uptimeS) }}
                </span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-xs font-mono px-2 py-0.5 rounded" :class="levelBadgeClass">
                    {{ OBS_LEVEL_LABELS[store.obsLevel] }}
                </span>
                <router-link
                    to="/monitoring/control-panel"
                    class="px-3 py-1 text-xs font-mono rounded overview-control-link transition-colors"
                >
                    <i class="fa-solid fa-sliders mr-1" />Control Panel
                </router-link>
            </div>
        </div>

        <!-- DB Writes Disabled warning -->
        <BasicBlock v-if="store.dbWritesDisabled" darker class="border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]">
            <div class="flex items-center gap-2 text-[var(--color-danger-text)]">
                <i class="fa-solid fa-database" />
                <span class="text-sm font-semibold">DB Writes Disabled</span>
                <span class="text-xs opacity-75">— Status history and audit logs are not being recorded</span>
            </div>
        </BasicBlock>

        <!-- Bottleneck Analysis (Tier 1+) -->
        <BottleneckPanel v-if="store.obsLevel > 0" />

        <!-- Live System Flow Diagram (Tier 1+) -->
        <div class="overflow-x-auto">
            <SystemFlowDiagram v-if="store.obsLevel > 0 && store.latest" />
        </div>

        <!-- Monitoring disabled state -->
        <BasicBlock v-if="store.obsLevel === 0" darker class="text-center py-12">
            <div class="space-y-3">
                <i class="fa-solid fa-chart-line text-4xl overview-disabled-icon" />
                <p class="overview-disabled-text">Enable monitoring to see system metrics</p>
                <p class="text-xs overview-disabled-hint">
                    Light mode is safe for production. Medium adds RPC/DB timings.
                </p>
                <button
                    class="px-4 py-2 text-sm font-mono rounded overview-enable-btn transition-colors"
                    @click="store.changeLevel(1)"
                >
                    Enable Light Monitoring
                </button>
            </div>
        </BasicBlock>

        <!-- Core pipeline flow cards -->
        <div v-if="store.obsLevel > 0" class="space-y-2">
            <div class="text-xs font-mono overview-section-label font-semibold">Core Pipeline</div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <FlowCard
                title="Device Ingest"
                icon="fa-solid fa-tower-broadcast"
                :status="store.deviceIngestStatus"
                to="/monitoring/device-ingest"
                :metrics="deviceIngestMetrics"
                :spark-data="cachedHistory.initActive"
                spark-color="#60a5fa"
                tooltip="Tracks device connections, initialization queue, and failure rates"
            />
            <FlowCard
                title="Status Pipeline"
                icon="fa-solid fa-arrows-spin"
                :status="store.statusPipelineStatus"
                to="/monitoring/database"
                :metrics="statusPipelineMetrics"
                :spark-data="cachedHistory.statusQueueSize"
                spark-color="#a78bfa"
                tooltip="Buffers incoming device status updates and flushes to database"
            />
            <FlowCard
                title="RPC Commands"
                icon="fa-solid fa-terminal"
                :status="store.rpcCommandsStatus"
                to="/monitoring/commands"
                :metrics="rpcCommandsMetrics"
                :spark-data="cachedHistory.rpcAvgMs"
                spark-color="#34d399"
                tooltip="Relays commands from browser to devices, tracks latency and errors"
            />
            <FlowCard
                title="Database"
                icon="fa-solid fa-database"
                :status="store.databaseStatus"
                to="/monitoring/database"
                :metrics="databaseMetrics"
                :spark-data="cachedHistory.dbPoolWaiting"
                spark-color="#fbbf24"
                tooltip="PostgreSQL connection pool utilization and query performance"
            />
        </div>
        </div>

        <!-- Service flow cards -->
        <div v-if="store.obsLevel > 0" class="space-y-2">
            <div class="text-xs font-mono overview-section-label font-semibold">Services</div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <FlowCard
                title="Events & Plugins"
                icon="fa-solid fa-plug"
                :status="store.eventsStatus"
                to="/monitoring/events"
                :metrics="eventsPluginsMetrics"
                :spark-data="cachedHistory.eventsListeners"
                spark-color="#c084fc"
                tooltip="Event distribution to listeners and loaded plugin workers"
            />
            <FlowCard
                title="Energy Meters"
                icon="fa-solid fa-bolt"
                :status="store.emSyncStatus"
                to="/monitoring/services"
                :metrics="emSyncMetrics"
                :spark-data="cachedHistory.emActiveSyncs"
                spark-color="#fb923c"
                tooltip="Periodic energy data synchronization from EM devices"
            />
            <FlowCard
                title="Waiting Room"
                icon="fa-solid fa-hourglass-half"
                :status="store.waitingRoomStatus"
                to="/monitoring/services"
                :metrics="waitingRoomMetrics"
                :spark-data="cachedHistory.waitingRoomPending"
                spark-color="#f472b6"
                tooltip="Devices pending admin approval before joining the fleet"
            />
        </div>
        </div>

        <!-- System vitals (Tier 1+) — click to expand charts -->
        <BasicBlock v-if="store.obsLevel >= 1 && store.latest" darker bordered class="border-l-2 overview-border-primary">
            <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <i class="fa-solid fa-heart-pulse overview-icon-primary text-sm" />
                        <h3 class="font-semibold text-sm overview-block-title">System Vitals</h3>
                    </div>
                    <span class="text-xs overview-hint-text">Click to expand charts</span>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-4">
                    <ExpandedVitalCard
                        label="CPU Usage"
                        :value="`${store.latest.cpuUserPct + store.latest.cpuSystemPct}%`"
                        :text-color="(store.latest.cpuUserPct + store.latest.cpuSystemPct) > 90 ? 'vital-critical' : (store.latest.cpuUserPct + store.latest.cpuSystemPct) > 70 ? 'vital-warning' : 'vital-ok'"
                        :spark-data="cachedHistory.cpuUserPct"
                        color="#f97316"
                        unit="%"
                        :thresholds="[{value: 70, color: '#fbbf24', label: 'Warning'}, {value: 90, color: '#f87171', label: 'Critical'}]"
                        tooltip="Process CPU time as % of one core"
                    />
                    <ExpandedVitalCard
                        label="Event Loop Lag"
                        :value="`${store.latest.eventLoopLagMs}ms`"
                        :text-color="store.latest.eventLoopLagMs > 100 ? 'vital-critical' : store.latest.eventLoopLagMs > 50 ? 'vital-warning' : 'vital-ok'"
                        :spark-data="cachedHistory.eventLoopLagMs"
                        color="#34d399"
                        unit="ms"
                        :thresholds="[{value: 50, color: '#fbbf24', label: 'Warning'}, {value: 100, color: '#f87171', label: 'Critical'}]"
                        tooltip="Time the Node.js event loop is delayed. >50ms degraded, >100ms critical"
                    />
                    <ExpandedVitalCard
                        label="Memory (RSS)"
                        :value="`${store.latest.rssM}MB`"
                        :spark-data="cachedHistory.rssM"
                        color="#60a5fa"
                        unit="MB"
                        tooltip="Total process memory including heap, stack, and native allocations"
                    />
                    <ExpandedVitalCard
                        label="Heap"
                        :value="`${store.latest.heapUsedM}/${store.latest.heapTotalM}MB`"
                        :suffix="trendArrow(store.latest.heapTrend)"
                        :text-color="store.latest.heapTrend === 'growing' ? 'vital-critical' : store.latest.heapTrend === 'shrinking' ? 'vital-ok' : 'vital-neutral'"
                        :spark-data="cachedHistory.heapUsedM"
                        color="#a78bfa"
                        unit="MB"
                        tooltip="V8 JavaScript heap memory usage"
                    />
                    <ExpandedVitalCard
                        label="Browser Sessions"
                        :value="String(store.latest.wsClients)"
                        :spark-data="cachedHistory.wsClients"
                        color="#60a5fa"
                        tooltip="Active browser sessions connected via WebSocket"
                    />
                    <ExpandedVitalCard
                        label="Devices Online"
                        :value="String(store.latest.devicesTotal)"
                        :spark-data="cachedHistory.devicesTotal"
                        color="#60a5fa"
                        tooltip="Total number of Shelly devices currently connected"
                    />
                    <ExpandedVitalCard
                        label="Active Handles"
                        :value="String(store.latest.activeHandles)"
                        :spark-data="cachedHistory.activeHandles"
                        color="#94a3b8"
                        tooltip="Open OS resources (sockets, timers). Should correlate with device count"
                    />
                </div>
            </div>
        </BasicBlock>

        <!-- Auxiliary services (Tier 1+) -->
        <BasicBlock v-if="store.obsLevel >= 1 && store.latest" darker bordered class="border-l-2 overview-border-success">
            <div class="space-y-3">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-gear overview-icon-success text-sm" />
                    <h3 class="font-semibold text-sm overview-block-title">Auxiliary Services</h3>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <VitalCard
                        label="mDNS Scanner"
                        :value="store.latest.mdnsRunning ? 'Running' : 'Stopped'"
                        :color="store.latest.mdnsRunning ? 'green' : 'neutral'"
                        tooltip="Local network device discovery service"
                    />
                    <VitalCard
                        label="FW Scheduler"
                        :value="store.latest.firmwareRunning ? 'Running' : 'Stopped'"
                        :color="store.latest.firmwareRunning ? 'green' : 'neutral'"
                        tooltip="Firmware update scheduling service"
                    />
                    <VitalCard
                        label="Registry Cache"
                        :value="String(store.latest.registryCacheSize)"
                        color="blue"
                        :spark-data="cachedHistory.registryCacheSize"
                        tooltip="Cached device records in memory for fast lookup"
                    />
                    <VitalCard
                        label="RPC Components"
                        :value="String(store.latest.commanderComponents)"
                        color="blue"
                        tooltip="Registered RPC command handler components"
                    />
                    <VitalCard
                        label="Broadcast/min"
                        :value="String(store.latest.eventsBroadcastRate)"
                        color="blue"
                        :spark-data="cachedHistory.eventsBroadcastRate"
                        tooltip="Events broadcast to browser sessions per minute"
                    />
                    <VitalCard
                        label="OS Memory"
                        :value="`${store.latest.osFreeMemM}/${store.latest.osTotalMemM}MB`"
                        :color="store.latest.osFreeMemM < 200 ? 'red' : store.latest.osFreeMemM < 500 ? 'yellow' : 'blue'"
                        tooltip="Host machine available RAM"
                    />
                    <VitalCard
                        label="Load Average"
                        :value="`${store.latest.osLoadAvg1} / ${store.latest.osLoadAvg5} / ${store.latest.osLoadAvg15}`"
                        color="blue"
                        tooltip="OS CPU load average (1m / 5m / 15m). >CPU count = overloaded"
                    />
                    <VitalCard
                        label="GC Pauses"
                        :value="`${store.latest.gcMaxPauseMs}ms max`"
                        suffix=""
                        :color="store.latest.gcMaxPauseMs > 100 ? 'yellow' : 'green'"
                        tooltip="V8 garbage collection pause time"
                    />
                    <VitalCard
                        label="EL p99"
                        :value="`${store.latest.eventLoopP99}ms`"
                        :color="store.latest.eventLoopP99 > 50 ? 'yellow' : 'green'"
                        tooltip="99th percentile event loop delay"
                    />
                    <VitalCard
                        label="External Mem"
                        :value="`${store.latest.externalM}MB`"
                        color="blue"
                        tooltip="C++ objects and Buffer allocations outside V8 heap"
                    />
                </div>
            </div>
        </BasicBlock>

        <!-- Counter rates summary (Tier 2+) -->
        <BasicBlock v-if="store.obsLevel >= 2 && hasCounters" darker bordered class="border-l-2 overview-border-accent">
            <div class="space-y-3">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-chart-bar overview-icon-accent text-sm" />
                    <h3 class="font-semibold text-sm overview-block-title">Counter Rates</h3>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    <div
                        v-for="[key, rate] in sortedRates"
                        :key="key"
                        class="p-2 overview-counter-card rounded text-xs font-mono"
                    >
                        <span class="overview-counter-label">{{ key }}:</span>
                        <span class="overview-counter-value ml-1">{{ store.latestMetrics?.counters?.[key] ?? 0 }}</span>
                        <span v-if="rate" class="ml-1" :class="rate > 0 ? 'overview-counter-rate-active' : 'overview-counter-rate-idle'">
                            ({{ rate > 0 ? '+' : '' }}{{ rate }}/min)
                        </span>
                    </div>
                </div>
            </div>
        </BasicBlock>

    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import BottleneckPanel from '@/components/monitoring/BottleneckPanel.vue';
import ExpandedVitalCard from '@/components/monitoring/ExpandedVitalCard.vue';
import FlowCard from '@/components/monitoring/FlowCard.vue';
import HealthDot from '@/components/monitoring/HealthDot.vue';
import SystemFlowDiagram from '@/components/monitoring/SystemFlowDiagram.vue';
import VitalCard from '@/components/monitoring/VitalCard.vue';
import {useMonitoringStore} from '@/stores/monitoring';
import {OBS_LEVEL_LABELS} from '@/tools/observability';

const store = useMonitoringStore();

// ── Cached history fields (avoid new arrays each render) ─────────
const cachedHistory = computed(() => ({
    initActive: store.historyField('initActive'),
    statusQueueSize: store.historyField('statusQueueSize'),
    rpcAvgMs: store.historyField('rpcAvgMs'),
    dbPoolWaiting: store.historyField('dbPoolWaiting'),
    eventLoopLagMs: store.historyField('eventLoopLagMs'),
    rssM: store.historyField('rssM'),
    heapUsedM: store.historyField('heapUsedM'),
    wsClients: store.historyField('wsClients'),
    devicesTotal: store.historyField('devicesTotal'),
    eventsListeners: store.historyField('eventsListeners'),
    emActiveSyncs: store.historyField('emActiveSyncs'),
    waitingRoomPending: store.historyField('waitingRoomPending'),
    registryCacheSize: store.historyField('registryCacheSize'),
    eventsBroadcastRate: store.historyField('eventsBroadcastRate'),
    cpuUserPct: store.historyField('cpuUserPct'),
    activeHandles: store.historyField('activeHandles')
}));

// ── Core pipeline metrics ─────────────────────────────────────────
const deviceIngestMetrics = computed(() => {
    const s = store.latest;
    if (!s) return [];
    return [
        {label: 'online', value: s.devicesTotal},
        {label: 'init queue', value: s.initActive},
        {label: 'failures/min', value: s.initFailureRate}
    ];
});

const statusPipelineMetrics = computed(() => {
    const s = store.latest;
    if (!s) return [];
    return [
        {label: 'msg/min', value: s.statusMsgRate},
        {label: 'queue', value: s.statusQueueSize},
        {label: 'flushing', value: s.statusFlushing ? 'yes' : 'no'}
    ];
});

const rpcCommandsMetrics = computed(() => {
    const s = store.latest;
    if (!s) return [];
    return [
        {label: 'avg', value: `${s.rpcAvgMs}ms`},
        {label: 'err/min', value: s.rpcErrorRate},
        {label: 'ok/min', value: s.rpcSuccessRate}
    ];
});

const databaseMetrics = computed(() => {
    const s = store.latest;
    if (!s) return [];
    return [
        {
            label: 'pool',
            value: `${s.dbPoolTotal - s.dbPoolIdle}/${s.dbPoolTotal}`
        },
        {label: 'waiting', value: s.dbPoolWaiting},
        {label: 'avg', value: `${s.dbAvgMs}ms`}
    ];
});

// ── Service metrics ───────────────────────────────────────────────
const eventsPluginsMetrics = computed(() => {
    const s = store.latest;
    if (!s) return [];
    return [
        {label: 'listeners', value: s.eventsListeners},
        {label: 'event types', value: s.eventsTypes},
        {label: 'plugins', value: s.pluginsLoaded},
        {label: 'workers', value: s.pluginWorkers}
    ];
});

const emSyncMetrics = computed(() => {
    const s = store.latest;
    if (!s) return [];
    return [
        {label: 'queue', value: s.emQueueSize},
        {label: 'active', value: `${s.emActiveSyncs}/40`}
    ];
});

const waitingRoomMetrics = computed(() => {
    const s = store.latest;
    if (!s) return [];
    return [{label: 'pending', value: s.waitingRoomPending}];
});

// ── Counter rates ──────────────────────────────────────────────────
const hasCounters = computed(() => Object.keys(store.counterRates).length > 0);
const sortedRates = computed(() => {
    return Object.entries(store.counterRates).sort(([a], [b]) =>
        a.localeCompare(b)
    );
});

// ── Helpers ────────────────────────────────────────────────────────
function formatUptime(seconds?: number): string {
    if (!seconds) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function trendArrow(trend: string): string {
    switch (trend) {
        case 'growing':
            return ' \u2191';
        case 'shrinking':
            return ' \u2193';
        default:
            return ' \u2192';
    }
}

const levelBadgeClass = computed(() => {
    switch (store.obsLevel) {
        case 0:
            return 'level-badge-off';
        case 1:
            return 'level-badge-light';
        case 2:
            return 'level-badge-medium';
        case 3:
            return 'level-badge-heavy';
        default:
            return 'level-badge-off';
    }
});
</script>

<style scoped>
/* -- Heading & labels -- */
.overview-heading { color: var(--color-text-primary); }
.overview-uptime { color: var(--color-text-disabled); }
.overview-section-label { color: var(--color-text-disabled); }
.overview-block-title { color: var(--color-text-secondary); }
.overview-hint-text { color: var(--color-border-strong); }

/* -- Disabled / empty state -- */
.overview-disabled-icon { color: var(--color-border-strong); }
.overview-disabled-text { color: var(--color-text-tertiary); }
.overview-disabled-hint { color: var(--color-text-disabled); }

/* -- Enable button (primary action) -- */
.overview-enable-btn {
    background-color: var(--color-primary-hover);
    color: var(--primitive-blue-100);
}
.overview-enable-btn:hover {
    background-color: var(--color-primary);
}

/* -- Control panel link -- */
.overview-control-link {
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
}
.overview-control-link:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
}

/* -- Block border accents -- */
.overview-border-primary { border-left-color: var(--color-primary-active); }
.overview-border-success { border-left-color: var(--color-success-subtle); }
.overview-border-accent { border-left-color: var(--color-accent-subtle); }

/* -- Icon colors -- */
.overview-icon-primary { color: var(--color-primary-text); }
.overview-icon-success { color: var(--color-success-text); }
.overview-icon-accent { color: var(--color-accent-text); }

/* -- Counter rate cards -- */
.overview-counter-card {
    background-color: var(--color-surface-1);
    border: 1px solid rgba(var(--primitive-neutral-700), 0.3);
    border-color: color-mix(in srgb, var(--color-border-default) 30%, transparent);
}
.overview-counter-label { color: var(--color-text-disabled); }
.overview-counter-value { color: var(--color-text-secondary); }
.overview-counter-rate-active { color: var(--color-primary-text); }
.overview-counter-rate-idle { color: var(--color-border-strong); }

/* -- Level badge variants -- */
.level-badge-off {
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
}
.level-badge-light {
    background-color: color-mix(in srgb, var(--color-primary-subtle) 60%, transparent);
    color: var(--primitive-blue-300);
}
.level-badge-medium {
    background-color: color-mix(in srgb, var(--color-warning-subtle) 60%, transparent);
    color: var(--primitive-amber-300);
}
.level-badge-heavy {
    background-color: color-mix(in srgb, var(--color-danger-subtle) 60%, transparent);
    color: var(--primitive-red-300);
}
</style>
