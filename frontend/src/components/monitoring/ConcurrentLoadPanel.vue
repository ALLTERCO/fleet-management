<template>
    <div class="cl-stack">
        <MonitoringSectionHeader
            title="Concurrent Browser Load"
            :status="loadStatus"
        />
        <MonitoringGrid :columns="3">
            <StatCard
                label="Connected Browsers"
                :value="latest.wsClients"
                :spark-data="hist.wsClients"
                :color="chartColors.primary"
            />
            <StatCard
                label="Struggling Clients"
                :value="latest.wsStrugglingClients"
                :spark-data="hist.wsStrugglingClients"
                :color="chartColors.danger"
                :warn="latest.wsStrugglingClients > 0"
            />
            <StatCard
                label="Worst Buffer"
                :value="latest.wsWorstBufferedKB"
                suffix="KB"
                :spark-data="hist.wsWorstBufferedKB"
                :color="chartColors.warning"
            />
            <StatCard
                label="Broadcast Max"
                :value="latest.broadcastMaxMs"
                suffix="ms"
                :spark-data="hist.broadcastMaxMs"
                :color="chartColors.success"
                :warn="latest.broadcastMaxMs > 100"
            />
            <StatCard
                label="Serialize Max"
                :value="latest.serializeMaxMs"
                suffix="ms"
                :spark-data="hist.serializeMaxMs"
                :color="chartColors.chart5"
            />
            <StatCard
                label="Event-loop Lag"
                :value="latest.eventLoopLagMs"
                suffix="ms"
                :spark-data="hist.eventLoopLagMs"
                :color="chartColors.chart7"
                :warn="latest.eventLoopLagMs > 50"
                :critical="latest.eventLoopLagMs > 200"
            />
        </MonitoringGrid>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import MonitoringGrid from '@/components/monitoring/MonitoringGrid.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import StatCard from '@/components/monitoring/StatCard.vue';
import {chartColors} from '@/helpers/chartUtils';
import {type FlowStatus, useMonitoringStore} from '@/stores/monitoring';

const store = useMonitoringStore();

// Zeroed defaults so the cards render before the first snapshot.
const EMPTY = {
    wsClients: 0,
    wsStrugglingClients: 0,
    wsWorstBufferedKB: 0,
    broadcastMaxMs: 0,
    serializeMaxMs: 0,
    eventLoopLagMs: 0
};
const latest = computed(() => store.latest ?? EMPTY);

const hist = computed(() => ({
    wsClients: store.historyField('wsClients'),
    wsStrugglingClients: store.historyField('wsStrugglingClients'),
    wsWorstBufferedKB: store.historyField('wsWorstBufferedKB'),
    broadcastMaxMs: store.historyField('broadcastMaxMs'),
    serializeMaxMs: store.historyField('serializeMaxMs'),
    eventLoopLagMs: store.historyField('eventLoopLagMs')
}));

// Breaking point: any client dropping/lagging, or the server itself stalling.
const loadStatus = computed<FlowStatus>(() => {
    const s = latest.value;
    if (s.wsStrugglingClients > 0 || s.eventLoopLagMs > 200) return 'critical';
    if (s.broadcastMaxMs > 100 || s.eventLoopLagMs > 50) return 'warning';
    return 'healthy';
});
</script>

<style scoped>
.cl-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
</style>
