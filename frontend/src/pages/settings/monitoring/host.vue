<template>
    <PageTemplate title="Host" :tabs="monitoringTabs" fill>
        <ErrorBoundary>
            <PageSkeleton
                v-if="store.obsLevel > 0 && !store.latest"
                variant="cards"
                :count="7"
            />

            <BasicBlock
                v-if="store.obsLevel === 0"
                darker
                class="text-center py-12"
            >
                <div class="space-y-3">
                    <i class="fas fa-chart-line text-4xl host-disabled-icon" />
                    <p class="host-disabled-text">
                        Enable monitoring to see host metrics
                    </p>
                    <p class="text-xs host-disabled-hint">
                        Light mode is safe for production. Medium adds RPC/DB
                        timings.
                    </p>
                    <button
                        type="button"
                        class="px-4 py-2 text-sm font-mono rounded host-enable-btn transition-colors"
                        @click="store.changeLevel(1)"
                    >
                        Enable Light Monitoring
                    </button>
                </div>
            </BasicBlock>

            <div
                v-if="store.obsLevel > 0 && store.latest"
                class="space-y-2"
            >
                <div class="text-xs font-mono host-section-label font-semibold">
                    Core Pipeline
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    <FlowCard
                        title="Device Ingest"
                        icon="fas fa-tower-broadcast"
                        :status="store.deviceIngestStatus"
                        :metrics="deviceIngestMetrics"
                        :spark-data="cachedHistory.initActive"
                        :spark-color="chartColors.primary"
                        tooltip="Tracks device connections, initialization queue, and failure rates"
                    />
                    <FlowCard
                        title="Status Pipeline"
                        icon="fas fa-arrows-spin"
                        :status="store.statusPipelineStatus"
                        :metrics="statusPipelineMetrics"
                        :spark-data="cachedHistory.statusQueueSize"
                        :spark-color="chartColors.chart5"
                        tooltip="Buffers incoming device status updates and flushes to database"
                    />
                    <FlowCard
                        title="RPC Commands"
                        icon="fas fa-terminal"
                        :status="store.rpcCommandsStatus"
                        :metrics="rpcCommandsMetrics"
                        :spark-data="cachedHistory.rpcAvgMs"
                        :spark-color="chartColors.success"
                        tooltip="Relays commands from browser to devices, tracks latency and errors"
                    />
                    <FlowCard
                        title="Database"
                        icon="fas fa-database"
                        :status="store.databaseStatus"
                        :metrics="databaseMetrics"
                        :spark-data="cachedHistory.dbPoolWaiting"
                        :spark-color="chartColors.warning"
                        tooltip="PostgreSQL connection pool utilization and query performance"
                    />
                </div>
            </div>

            <div
                v-if="store.obsLevel > 0 && store.latest"
                class="space-y-2"
            >
                <div class="text-xs font-mono host-section-label font-semibold">
                    Services
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    <FlowCard
                        title="Events & Plugins"
                        icon="fas fa-plug"
                        :status="store.eventsStatus"
                        :metrics="eventsPluginsMetrics"
                        :spark-data="cachedHistory.eventsListeners"
                        :spark-color="chartColors.chart5"
                        tooltip="Event distribution to listeners and loaded plugin workers"
                    />
                    <FlowCard
                        title="Energy Meters"
                        icon="fas fa-bolt"
                        :status="store.emSyncStatus"
                        :metrics="emSyncMetrics"
                        :spark-data="cachedHistory.emActiveSyncs"
                        :spark-color="chartColors.chart7"
                        tooltip="Periodic energy data synchronization from EM devices"
                    />
                    <FlowCard
                        title="Waiting Room"
                        icon="fas fa-hourglass-half"
                        :status="store.waitingRoomStatus"
                        :metrics="waitingRoomMetrics"
                        :spark-data="cachedHistory.waitingRoomPending"
                        :spark-color="chartColors.chart8"
                        tooltip="Devices pending admin approval before joining the fleet"
                    />
                </div>
            </div>

            <BasicBlock
                v-if="store.obsLevel >= 1 && store.latest"
                darker
                bordered
                class="border-l-2 host-border-primary"
            >
                <div class="space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <i class="fas fa-heart-pulse host-icon-primary text-sm" />
                            <h3 class="font-semibold text-sm host-block-title">
                                System Vitals
                            </h3>
                        </div>
                        <span class="text-xs host-hint-text">
                            Click to expand charts
                        </span>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-4">
                        <ExpandedVitalCard
                            label="CPU Usage"
                            :value="`${store.latest.cpuUserPct + store.latest.cpuSystemPct}%`"
                            :text-color="(store.latest.cpuUserPct + store.latest.cpuSystemPct) > 90 ? 'vital-critical' : (store.latest.cpuUserPct + store.latest.cpuSystemPct) > 70 ? 'vital-warning' : 'vital-ok'"
                            :spark-data="cachedHistory.cpuUserPct"
                            :color="chartColors.chart7"
                            unit="%"
                            :thresholds="[{value: 70, color: chartColors.warning, label: 'Warning'}, {value: 90, color: chartColors.danger, label: 'Critical'}]"
                            tooltip="Process CPU time as % of one core"
                        />
                        <ExpandedVitalCard
                            label="Event Loop Lag"
                            :value="formatMs(store.latest.eventLoopLagMs)"
                            :text-color="store.latest.eventLoopLagMs > 100 ? 'vital-critical' : store.latest.eventLoopLagMs > 50 ? 'vital-warning' : 'vital-ok'"
                            :spark-data="cachedHistory.eventLoopLagMs"
                            :color="chartColors.success"
                            unit="ms"
                            :thresholds="[{value: 50, color: chartColors.warning, label: 'Warning'}, {value: 100, color: chartColors.danger, label: 'Critical'}]"
                            tooltip="Time the Node.js event loop is delayed. >50ms degraded, >100ms critical"
                        />
                        <ExpandedVitalCard
                            label="Memory (RSS)"
                            :value="`${store.latest.rssM}MB`"
                            :spark-data="cachedHistory.rssM"
                            :color="chartColors.primary"
                            unit="MB"
                            tooltip="Total process memory including heap, stack, and native allocations"
                        />
                        <ExpandedVitalCard
                            label="Heap"
                            :value="`${store.latest.heapUsedM}/${store.latest.heapLimitM || store.latest.heapTotalM}MB`"
                            :suffix="trendArrow(store.latest.heapTrend)"
                            :text-color="store.latest.heapTrend === 'growing' ? 'vital-critical' : store.latest.heapTrend === 'shrinking' ? 'vital-ok' : 'vital-neutral'"
                            :spark-data="cachedHistory.heapUsedM"
                            :color="chartColors.chart5"
                            unit="MB"
                            tooltip="V8 heap used vs the --max-old-space-size limit"
                        />
                        <ExpandedVitalCard
                            label="Browser Sessions"
                            :value="String(store.latest.wsClients)"
                            :spark-data="cachedHistory.wsClients"
                            :color="chartColors.primary"
                            tooltip="Active browser sessions connected via WebSocket"
                        />
                        <ExpandedVitalCard
                            label="Devices Online"
                            :value="String(store.latest.devicesTotal)"
                            :spark-data="cachedHistory.devicesTotal"
                            :color="chartColors.primary"
                            tooltip="Total number of Shelly devices currently connected"
                        />
                        <ExpandedVitalCard
                            label="Active Handles"
                            :value="String(store.latest.activeHandles)"
                            :spark-data="cachedHistory.activeHandles"
                            :color="chartColors.textTertiary"
                            tooltip="Open OS resources (sockets, timers). Should correlate with device count"
                        />
                    </div>
                </div>
            </BasicBlock>

            <BasicBlock
                v-if="store.obsLevel >= 1 && store.latest"
                darker
                bordered
                class="border-l-2 host-border-success"
            >
                <div class="space-y-3">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-gear host-icon-success text-sm" />
                        <h3 class="font-semibold text-sm host-block-title">
                            Auxiliary Services
                        </h3>
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
                            :value="`${formatMs(store.latest.gcMaxPauseMs)} max`"
                            suffix=""
                            :color="store.latest.gcMaxPauseMs > 100 ? 'yellow' : 'green'"
                            tooltip="V8 garbage collection pause time"
                        />
                        <VitalCard
                            label="EL p99"
                            :value="formatMs(store.latest.eventLoopP99)"
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

            <BasicBlock
                v-if="store.obsLevel >= 2 && hasCounters"
                darker
                bordered
                class="border-l-2 host-border-accent"
            >
                <div class="space-y-3">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-chart-bar host-icon-accent text-sm" />
                        <h3 class="font-semibold text-sm host-block-title">
                            Counter Rates
                        </h3>
                    </div>
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        <div
                            v-for="[key, rate] in sortedRates"
                            :key="key"
                            class="p-2 host-counter-card rounded text-xs font-mono"
                        >
                            <span class="host-counter-label">{{ key }}:</span>
                            <span class="host-counter-value ml-1">
                                {{ store.latestMetrics?.counters?.[key] ?? 0 }}
                            </span>
                            <span
                                v-if="rate"
                                class="ml-1"
                                :class="rate > 0 ? 'host-counter-rate-active' : 'host-counter-rate-idle'"
                            >
                                ({{ rate > 0 ? '+' : '' }}{{ rate }}/min)
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>
        </ErrorBoundary>
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageSkeleton from '@/components/core/PageSkeleton.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ExpandedVitalCard from '@/components/monitoring/ExpandedVitalCard.vue';
import FlowCard from '@/components/monitoring/FlowCard.vue';
import VitalCard from '@/components/monitoring/VitalCard.vue';
import {chartColors} from '@/helpers/chartUtils';
import {formatMs} from '@/helpers/format';
import {useMonitoringStore} from '@/stores/monitoring';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const store = useMonitoringStore();

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
        {label: 'avg', value: formatMs(s.rpcAvgMs)},
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
        {label: 'avg', value: formatMs(s.dbAvgMs)}
    ];
});

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

const hasCounters = computed(() => Object.keys(store.counterRates).length > 0);
const sortedRates = computed(() => {
    return Object.entries(store.counterRates).sort(([a], [b]) =>
        a.localeCompare(b)
    );
});

function trendArrow(trend: string): string {
    switch (trend) {
        case 'growing':
            return ' ↑';
        case 'shrinking':
            return ' ↓';
        default:
            return ' →';
    }
}
</script>

<style scoped>
.host-section-label { color: var(--color-text-disabled); }
.host-block-title { color: var(--color-text-secondary); }
.host-hint-text { color: var(--color-border-strong); }

.host-disabled-icon { color: var(--color-border-strong); }
.host-disabled-text { color: var(--color-text-tertiary); }
.host-disabled-hint { color: var(--color-text-disabled); }

.host-enable-btn {
    background-color: var(--color-primary-hover);
    color: var(--color-primary-text);
}
.host-enable-btn:hover {
    background-color: var(--color-primary);
}

.host-border-primary { border-left-color: var(--color-primary-active); }
.host-border-success { border-left-color: var(--color-success-subtle); }
.host-border-accent { border-left-color: var(--color-accent-subtle); }

.host-icon-primary { color: var(--color-primary-text); }
.host-icon-success { color: var(--color-success-text); }
.host-icon-accent { color: var(--color-accent-text); }

.host-counter-card {
    background-color: var(--color-surface-1);
    border: 1px solid color-mix(in srgb, var(--color-border-default) 30%, transparent);
}
.host-counter-label { color: var(--color-text-disabled); }
.host-counter-value { color: var(--color-text-secondary); }
.host-counter-rate-active { color: var(--color-primary-text); }
.host-counter-rate-idle { color: var(--color-border-strong); }
</style>
