<template>
    <PageTemplate title="Activity" :tabs="monitoringTabs" fill>
        <ErrorBoundary>
            <MonitoringEmptyState
                v-if="store.obsLevel === 0"
                title="Monitoring is off"
                description="Enable light monitoring to inspect devices, commands, connections, events, and services."
                action-label="Enable Light Monitoring"
                icon="fas fa-wave-square"
                @action="store.changeLevel(1)"
            />

            <template v-else>
                <BasicBlock darker>
                    <div class="mon-stack">
                        <MonitoringSectionHeader title="Live Activity" :status="store.overallStatus" />
                        <MonitoringGrid>
                            <StatCard label="Devices" :value="store.latest?.devicesTotal ?? 0" :spark-data="history.devicesTotal" />
                            <StatCard label="RPC Avg" :value="store.latest?.rpcAvgMs ?? 0" suffix="ms" :warn="(store.latest?.rpcAvgMs ?? 0) > 500" :critical="(store.latest?.rpcAvgMs ?? 0) > 1000" />
                            <StatCard label="Events/min" :value="store.latest?.eventsBroadcastRate ?? 0" :spark-data="history.eventsBroadcastRate" />
                            <StatCard label="Connections" :value="store.latest?.wsClients ?? 0" :spark-data="history.wsClients" />
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <MonitoringGrid :columns="2">
                    <DrilldownCard
                        title="Device Ingest"
                        icon="fas fa-arrow-right-to-bracket"
                        :status="store.deviceIngestStatus"
                        :items="deviceItems"
                    />
                    <DrilldownCard
                        title="Commands"
                        icon="fas fa-terminal"
                        :status="store.rpcCommandsStatus"
                        :items="commandItems"
                    />
                    <DrilldownCard
                        title="Connections"
                        icon="fas fa-plug"
                        :status="connectionStatus"
                        :items="connectionItems"
                    />
                    <DrilldownCard
                        title="Events"
                        icon="fas fa-bolt"
                        :status="store.eventsStatus"
                        :items="eventItems"
                    />
                    <DrilldownCard
                        title="Services"
                        icon="fas fa-server"
                        :status="servicesStatus"
                        :items="serviceItems"
                    />
                </MonitoringGrid>
            </template>
        </ErrorBoundary>
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import DrilldownCard from '@/components/monitoring/MonitoringDrilldownCard.vue';
import MonitoringEmptyState from '@/components/monitoring/MonitoringEmptyState.vue';
import MonitoringGrid from '@/components/monitoring/MonitoringGrid.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import StatCard from '@/components/monitoring/StatCard.vue';
import {formatMs} from '@/helpers/format';
import type {FlowStatus} from '@/stores/monitoring';
import {useMonitoringStore} from '@/stores/monitoring';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');
const store = useMonitoringStore();

const history = computed(() => ({
    devicesTotal: store.historyField('devicesTotal'),
    eventsBroadcastRate: store.historyField('eventsBroadcastRate'),
    wsClients: store.historyField('wsClients')
}));

const connectionStatus = computed<FlowStatus>(() => {
    if (!store.latest) return 'unknown';
    return store.latest.wsClients > 0 ? 'healthy' : 'unknown';
});

const servicesStatus = computed<FlowStatus>(() => {
    const statuses = [store.emSyncStatus, store.waitingRoomStatus, store.eventsStatus];
    if (statuses.includes('critical')) return 'critical';
    if (statuses.includes('warning')) return 'warning';
    return store.latest ? 'healthy' : 'unknown';
});

const deviceItems = computed(() => [
    {label: 'Online', value: store.latest?.devicesTotal ?? 0},
    {label: 'Init active', value: store.latest?.initActive ?? 0},
    {label: 'Init queued', value: store.latest?.initQueued ?? 0},
    {label: 'Failures/min', value: store.latest?.initFailureRate ?? 0}
]);

const commandItems = computed(() => [
    {label: 'Avg latency', value: formatMs(store.latest?.rpcAvgMs ?? 0)},
    {label: 'Errors/min', value: store.latest?.rpcErrorRate ?? 0},
    {label: 'Success/min', value: store.counterRates.rpc_success ?? 0},
    {label: 'Pending', value: store.pendingRpcCount}
]);

const connectionItems = computed(() => [
    {label: 'Browser sessions', value: store.latest?.wsClients ?? 0},
    {label: 'WS msg/s', value: store.wsMessagesPerSec},
    {label: 'Max buffer', value: `${store.latest?.wsMaxBufferedKB ?? 0}KB`},
    {label: 'Active handles', value: store.latest?.activeHandles ?? 0}
]);

const eventItems = computed(() => [
    {label: 'Listeners', value: store.latest?.eventsListeners ?? 0},
    {label: 'Types', value: store.latest?.eventsTypes ?? 0},
    {label: 'Broadcast/min', value: store.latest?.eventsBroadcastRate ?? 0},
    {label: 'Broadcast max', value: formatMs(store.latest?.broadcastMaxMs ?? 0)}
]);

const serviceItems = computed(() => [
    {label: 'Waiting room', value: store.latest?.waitingRoomPending ?? 0},
    {label: 'EM syncs', value: store.latest?.emActiveSyncs ?? 0},
    {label: 'Plugins', value: store.latest?.pluginsLoaded ?? 0},
    {label: 'Registry cache', value: store.latest?.registryCacheSize ?? 0}
]);
</script>

<style scoped>
.mon-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
</style>
