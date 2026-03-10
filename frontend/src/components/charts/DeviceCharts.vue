<template>
    <div class="device-charts">
        <!-- Time range selector -->
        <div class="device-charts__toolbar">
            <button
                v-for="range in ranges"
                :key="range.value"
                class="device-charts__range-btn"
                :class="activeRange === range.value && 'device-charts__range-btn--active'"
                @click="changeRange(range.value)"
            >
                {{ range.label }}
            </button>
        </div>

        <!-- Loading state -->
        <div v-if="loading" class="device-charts__empty">
            <i class="fas fa-spinner fa-spin text-xl text-[var(--color-text-disabled)]"></i>
            <span class="text-[var(--color-text-disabled)] text-sm">Loading chart data…</span>
        </div>

        <!-- No data state -->
        <div v-else-if="!hasData" class="device-charts__empty">
            <i class="fas fa-chart-line text-2xl text-[var(--color-text-disabled)]"></i>
            <span class="text-[var(--color-text-disabled)] text-sm">No historical data available for this device</span>
        </div>

        <!-- Charts -->
        <template v-else>
            <MetricChart
                v-if="consumptionData.length"
                :data="consumptionData"
                title="Consumption"
                unit="kWh"
                icon="fas fa-bolt text-[var(--color-success-text)]"
                color="rgba(74, 222, 128, 1)"
                chart-type="bar"
                :precision="3"
            />

            <MetricChart
                v-if="returnedEnergyData.length"
                :data="returnedEnergyData"
                title="Returned Energy"
                unit="kWh"
                icon="fas fa-solar-panel text-[var(--color-orange-text)]"
                color="rgba(249, 115, 22, 1)"
                chart-type="bar"
                :precision="3"
            />

            <MetricChart
                v-if="powerData.length"
                :data="powerData"
                title="Power"
                unit="W"
                icon="fas fa-bolt text-[var(--color-danger-text)]"
                color="rgba(248, 113, 113, 1)"
                chart-type="line"
                :precision="1"
            />

            <MetricChart
                v-if="voltageData.length"
                :data="voltageData"
                title="Voltage"
                unit="V"
                icon="fas fa-plug text-[var(--color-warning-text)]"
                color="rgba(250, 204, 21, 1)"
                chart-type="line"
                :precision="1"
            />

            <MetricChart
                v-if="currentData.length"
                :data="currentData"
                title="Current"
                unit="A"
                icon="fas fa-water text-[var(--color-primary-text)]"
                color="rgba(96, 165, 250, 1)"
                chart-type="line"
                :precision="3"
            />
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue';
import * as ws from '@/tools/websocket';
import MetricChart from '@/components/analytics/charts/MetricChart.vue';

const props = defineProps<{
    shellyId: string;
}>();

interface DataPoint {
    bucket: string;
    value: number;
    min?: number | null;
    max?: number | null;
}

const ranges = [
    {label: '24h', value: '24h'},
    {label: '7d', value: '7d'},
    {label: '30d', value: '30d'}
];

const activeRange = ref('24h');
const loading = ref(false);
const consumptionData = ref<DataPoint[]>([]);
const returnedEnergyData = ref<DataPoint[]>([]);
const powerData = ref<DataPoint[]>([]);
const voltageData = ref<DataPoint[]>([]);
const currentData = ref<DataPoint[]>([]);

// Cache per device + range (5-minute TTL)
const cache = new Map<string, {ts: number; data: Record<string, DataPoint[]>}>();
const CACHE_TTL = 5 * 60 * 1000;

const hasData = computed(() =>
    consumptionData.value.length > 0 ||
    returnedEnergyData.value.length > 0 ||
    powerData.value.length > 0 ||
    voltageData.value.length > 0 ||
    currentData.value.length > 0
);

function getTimeRange(range: string): {from: string; to: string; granularity: 'hour' | 'day' | 'month'} {
    const to = new Date();
    const from = new Date();
    let granularity: 'hour' | 'day' | 'month' = 'hour';

    switch (range) {
        case '24h':
            from.setHours(from.getHours() - 24);
            granularity = 'hour';
            break;
        case '7d':
            from.setDate(from.getDate() - 7);
            granularity = 'hour';
            break;
        case '30d':
            from.setDate(from.getDate() - 30);
            granularity = 'day';
            break;
    }

    return {from: from.toISOString(), to: to.toISOString(), granularity};
}

async function fetchMetric(
    shellyId: string,
    metric: string,
    from: string,
    to: string,
    granularity: string
): Promise<DataPoint[]> {
    try {
        const result = await ws.sendRPC<{data: DataPoint[]}>(
            'FLEET_MANAGER',
            'fleetmanager.GetDeviceHistory',
            {shellyId, from, to, metric, granularity}
        );
        return result?.data ?? [];
    } catch {
        return [];
    }
}

async function loadData() {
    const {from, to, granularity} = getTimeRange(activeRange.value);
    const cacheKey = `${props.shellyId}_${activeRange.value}`;

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        consumptionData.value = cached.data.consumption;
        returnedEnergyData.value = cached.data.returned_energy;
        powerData.value = cached.data.power;
        voltageData.value = cached.data.voltage;
        currentData.value = cached.data.current;
        return;
    }

    loading.value = true;

    // Fetch all metrics in parallel
    const [consumption, returnedEnergy, power, voltage, current] = await Promise.all([
        fetchMetric(props.shellyId, 'consumption', from, to, granularity),
        fetchMetric(props.shellyId, 'returned_energy', from, to, granularity),
        fetchMetric(props.shellyId, 'power', from, to, granularity),
        fetchMetric(props.shellyId, 'voltage', from, to, granularity),
        fetchMetric(props.shellyId, 'current', from, to, granularity)
    ]);

    consumptionData.value = consumption;
    returnedEnergyData.value = returnedEnergy;
    powerData.value = power;
    voltageData.value = voltage;
    currentData.value = current;

    // Cache results
    cache.set(cacheKey, {
        ts: Date.now(),
        data: {consumption, returned_energy: returnedEnergy, power, voltage, current}
    });

    loading.value = false;
}

function changeRange(range: string) {
    activeRange.value = range;
    loadData();
}

// Load on mount and when shellyId changes
onMounted(loadData);
watch(() => props.shellyId, loadData);
</script>

<style scoped>
.device-charts {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.device-charts__toolbar {
    display: flex;
    gap: var(--space-1);
    padding: 0 var(--space-1);
}

.device-charts__range-btn {
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    background-color: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}

.device-charts__range-btn:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}

.device-charts__range-btn--active {
    background-color: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
}

.device-charts__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-8) 0;
}
</style>
