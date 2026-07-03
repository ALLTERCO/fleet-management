<template>
    <PageTemplate title="Investigate" :tabs="monitoringTabs" fill>
        <ErrorBoundary>
            <div class="inv">
                <!-- ── Signals overview ── -->
                <section class="inv-panel">
                    <MonitoringSectionHeader
                        title="Signals"
                        icon="fas fa-wave-square"
                        :status="store.overallStatus"
                        description="Live health indicators across the Fleet Manager backend."
                    />
                    <MonitoringGrid :columns="4">
                        <StatCard label="RPC Errors / min" :value="store.latest?.rpcErrorRate ?? 0" :warn="(store.latest?.rpcErrorRate ?? 0) > 2" :critical="(store.latest?.rpcErrorRate ?? 0) > 10" />
                        <StatCard label="DB Avg" :value="store.latest?.dbAvgMs ?? 0" suffix="ms" :warn="(store.latest?.dbAvgMs ?? 0) > 200" :critical="(store.latest?.dbAvgMs ?? 0) > 500" />
                        <StatCard label="Init Failures / min" :value="store.latest?.initFailureRate ?? 0" :warn="(store.latest?.initFailureRate ?? 0) > 2" :critical="(store.latest?.initFailureRate ?? 0) > 10" />
                        <StatCard label="Observability" :value="OBS_LEVEL_LABELS[store.obsLevel]" />
                    </MonitoringGrid>
                </section>

                <!-- ── Investigation tools catalog ── -->
                <section class="inv-panel">
                    <MonitoringSectionHeader
                        title="Investigation tools"
                        icon="fas fa-toolbox"
                        description="Pick a surface to drill into. Each tool opens with the current signal snapshot."
                    />
                    <MonitoringGrid :columns="3">
                        <DrilldownCard
                            title="Logs"
                            description="Live backend log stream with search, filters, and export."
                            icon="fas fa-file-lines"
                            to="/monitoring/logs"
                            :status="logStatus"
                            :items="logItems"
                        />
                        <DrilldownCard
                            title="Audit Log"
                            description="Who did what — searchable, exportable trail of every change."
                            icon="fas fa-clipboard-list"
                            to="/monitoring/audit-log"
                            status="healthy"
                            :items="auditItems"
                        />
                        <DrilldownCard
                            title="Troubleshoot"
                            description="Live per-device event stream with smart-parse diagnostics."
                            icon="fas fa-wave-square"
                            to="/monitoring/troubleshoot"
                            status="healthy"
                            :items="troubleshootItems"
                        />
                        <DrilldownCard
                            title="Commands"
                            description="RPC latency, slow operations and command throughput."
                            icon="fas fa-gauge-high"
                            to="/monitoring/commands"
                            :status="store.rpcCommandsStatus"
                            :items="slowRpcItems"
                        />
                        <DrilldownCard
                            title="Controls"
                            description="Observability level, backend log levels and runtime toggles."
                            icon="fas fa-sliders"
                            to="/monitoring/control-panel"
                            :status="controlStatus"
                            :items="controlItems"
                        />
                    </MonitoringGrid>
                </section>
            </div>
        </ErrorBoundary>
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject} from 'vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import DrilldownCard from '@/components/monitoring/MonitoringDrilldownCard.vue';
import MonitoringGrid from '@/components/monitoring/MonitoringGrid.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import StatCard from '@/components/monitoring/StatCard.vue';
import type {FlowStatus} from '@/stores/monitoring';
import {useMonitoringStore} from '@/stores/monitoring';
import {OBS_LEVEL_LABELS} from '@/tools/observability';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');
const store = useMonitoringStore();

const logStatus = computed<FlowStatus>(() =>
    store.latest?.rpcErrorRate || store.latest?.initFailureRate
        ? 'warning'
        : 'healthy'
);

const controlStatus = computed<FlowStatus>(() =>
    store.dbWritesDisabled ? 'critical' : 'healthy'
);

const logItems = computed(() => [
    {label: 'RPC errors/min', value: store.latest?.rpcErrorRate ?? 0},
    {label: 'Init failures/min', value: store.latest?.initFailureRate ?? 0},
    {label: 'DB waiting', value: store.latest?.dbPoolWaiting ?? 0},
    {label: 'Event loop', value: `${store.latest?.eventLoopLagMs ?? 0}ms`}
]);

const auditItems = computed(() => [
    {label: 'Audit queue', value: store.latest?.auditQueueLength ?? 0},
    {label: 'DB writes', value: store.dbWritesDisabled ? 'disabled' : 'normal'},
    {label: 'Search', value: 'available'},
    {label: 'Export', value: 'available'}
]);

const troubleshootItems = computed(() => [
    {label: 'Live changes', value: 'stream'},
    {label: 'Multi-device', value: 'yes'},
    {label: 'Smart parse', value: 'toggle'},
    {label: 'History', value: '30d'}
]);

const slowRpcItems = computed(() => [
    {label: 'Avg latency', value: `${store.latest?.rpcAvgMs ?? 0}ms`},
    {label: 'Errors/min', value: store.latest?.rpcErrorRate ?? 0},
    {label: 'FE timings', value: store.rpcTimings.length},
    {label: 'Pending RPCs', value: store.pendingRpcCount}
]);

const controlItems = computed(() => [
    {label: 'Observability', value: OBS_LEVEL_LABELS[store.obsLevel]},
    {label: 'Log levels', value: Object.keys(store.logLevels).length},
    {label: 'WS telemetry', value: store.wsTelemetryEnabled ? 'on' : 'off'},
    {label: 'DB writes', value: store.dbWritesDisabled ? 'disabled' : 'normal'}
]);
</script>

<style scoped>
.inv {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}
/* Console panel: a titled surface card that groups related content. */
.inv-panel {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    padding: var(--gap-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg, 12px);
}
</style>
