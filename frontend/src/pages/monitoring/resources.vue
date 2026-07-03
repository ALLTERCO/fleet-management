<template>
    <PageTemplate title="Resources" :tabs="monitoringTabs" fill>
        <ErrorBoundary>
            <MonitoringEmptyState
                v-if="store.obsLevel === 0"
                title="Monitoring is off"
                description="Enable light monitoring to inspect host and database pressure."
                action-label="Enable Light Monitoring"
                icon="fas fa-microchip"
                @action="store.changeLevel(1)"
            />

            <template v-else>
                <BasicBlock darker>
                    <div class="mon-stack">
                        <MonitoringSectionHeader title="Resource Health" :status="resourceStatus" />
                        <MonitoringGrid>
                            <StatCard label="CPU" :value="cpuValue" suffix="%" :warn="cpuValue > 70" :critical="cpuValue > 90" />
                            <StatCard label="RAM Free" :value="ramFreeValue" suffix="MB" :warn="ramFreeValue < 500" :critical="ramFreeValue < 200" />
                            <StatCard label="DB Waiting" :value="store.latest?.dbPoolWaiting ?? 0" :warn="(store.latest?.dbPoolWaiting ?? 0) > 0" :critical="(store.latest?.dbPoolWaiting ?? 0) > 5" />
                            <StatCard label="Queue" :value="store.latest?.statusQueueSize ?? 0" :warn="(store.latest?.statusQueueSize ?? 0) > 50" :critical="(store.latest?.statusQueueSize ?? 0) > 100" />
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <MonitoringGrid :columns="2">
                    <DrilldownCard
                        title="Host"
                        icon="fas fa-microchip"
                        to="/monitoring/host"
                        :status="hostStatus"
                        :items="hostItems"
                    />
                    <DrilldownCard
                        title="Database"
                        icon="fas fa-database"
                        to="/monitoring/database"
                        :status="store.databaseStatus"
                        :items="databaseItems"
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
import type {FlowStatus} from '@/stores/monitoring';
import {useMonitoringStore} from '@/stores/monitoring';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');
const store = useMonitoringStore();

const cpuValue = computed(
    () => (store.latest?.cpuUserPct ?? 0) + (store.latest?.cpuSystemPct ?? 0)
);
const ramFreeValue = computed(() => store.latest?.osFreeMemM ?? 0);

const hostStatus = computed<FlowStatus>(() => {
    if (!store.latest) return 'unknown';
    if (cpuValue.value > 90 || ramFreeValue.value < 200) return 'critical';
    if (cpuValue.value > 70 || ramFreeValue.value < 500) return 'warning';
    return 'healthy';
});

const resourceStatus = computed<FlowStatus>(() => {
    if (hostStatus.value === 'critical' || store.databaseStatus === 'critical')
        return 'critical';
    if (hostStatus.value === 'warning' || store.databaseStatus === 'warning')
        return 'warning';
    return store.latest ? 'healthy' : 'unknown';
});

const hostItems = computed(() => [
    {label: 'CPU', value: `${cpuValue.value}%`},
    {label: 'RSS', value: `${store.latest?.rssM ?? 0}MB`},
    {
        label: 'Heap',
        value: `${store.latest?.heapUsedM ?? 0}/${store.latest?.heapLimitM || store.latest?.heapTotalM || 0}MB`
    },
    {label: 'Load 1m', value: store.latest?.osLoadAvg1 ?? 0}
]);

const databaseItems = computed(() => [
    {label: 'Pool', value: `${store.latest?.dbPoolIdle ?? 0}/${store.latest?.dbPoolTotal ?? 0} idle`},
    {label: 'Waiting', value: store.latest?.dbPoolWaiting ?? 0},
    {label: 'Avg query', value: `${store.latest?.dbAvgMs ?? 0}ms`},
    {label: 'Audit queue', value: store.latest?.auditQueueLength ?? 0}
]);

</script>

<style scoped>
.mon-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
</style>
