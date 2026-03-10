<template>
    <ChartCard
        title="Consumption"
        icon="fas fa-chart-bar text-[var(--color-success-text)]"
        :loading="loading"
        :empty="!data.length"
        empty-text="No consumption data available"
    >
        <template #actions>
            <button
                v-for="view in views"
                :key="view.value"
                class="chart-card-toggle"
                :class="currentView === view.value && 'chart-card-toggle--active'"
                @click="currentView = view.value"
            >
                {{ view.label }}
            </button>
        </template>

        <canvas ref="chartCanvas"></canvas>

        <template v-if="showTotal" #stats>
            <span>Total: <strong>{{ totalConsumption.toFixed(3) }} kWh</strong></span>
            <span v-if="tariff > 0">
                Cost: <strong class="text-[var(--color-success-text)]">{{ totalCost.toFixed(2) }} {{ currency }}</strong>
            </span>
        </template>
    </ChartCard>
</template>

<script setup lang="ts">
import {
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    Legend,
    LinearScale,
    Tooltip
} from 'chart.js';
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import ChartCard from '@/components/charts/ChartCard.vue';

Chart.register(
    BarController,
    BarElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend
);

interface ConsumptionDataPoint {
    bucket: string;
    deviceId?: number;
    deviceName?: string;
    value: number;
    cost?: number;
}

const props = withDefaults(
    defineProps<{
        data: ConsumptionDataPoint[];
        tariff?: number;
        currency?: string;
        loading?: boolean;
        showTotal?: boolean;
    }>(),
    {
        tariff: 0,
        currency: 'EUR',
        loading: false,
        showTotal: true
    }
);

const chartCanvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

const views = [
    {label: 'kWh', value: 'kwh'},
    {label: 'Cost', value: 'cost'}
];
const currentView = ref('kwh');

const totalConsumption = computed(() => {
    return props.data.reduce((sum, d) => sum + (d.value || 0), 0);
});

const totalCost = computed(() => {
    return totalConsumption.value * props.tariff;
});

function renderChart() {
    if (!chartCanvas.value || !props.data.length) {
        chart?.destroy();
        chart = null;
        return;
    }

    const ctx = chartCanvas.value.getContext('2d');
    if (!ctx) return;

    // Group by bucket (date/time)
    const groupedData = new Map<string, number>();
    for (const d of props.data) {
        const label = formatBucket(d.bucket);
        const current = groupedData.get(label) || 0;
        groupedData.set(label, current + d.value);
    }

    const labels = Array.from(groupedData.keys());
    const values = Array.from(groupedData.values());
    const displayValues =
        currentView.value === 'cost'
            ? values.map((v) => v * props.tariff)
            : values;

    chart?.destroy();
    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label:
                        currentView.value === 'cost'
                            ? `Cost (${props.currency})`
                            : 'Consumption (kWh)',
                    data: displayValues,
                    backgroundColor:
                        currentView.value === 'cost'
                            ? 'rgba(168, 85, 247, 0.7)' // purple
                            : 'rgba(74, 222, 128, 0.7)', // green
                    borderColor:
                        currentView.value === 'cost'
                            ? 'rgba(168, 85, 247, 1)'
                            : 'rgba(74, 222, 128, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {color: 'rgba(255,255,255,0.1)'},
                    ticks: {color: '#9ca3af'}
                },
                x: {
                    grid: {display: false},
                    ticks: {color: '#9ca3af'}
                }
            },
            plugins: {
                legend: {display: false},
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            const val = ctx.parsed.y ?? 0;
                            return currentView.value === 'cost'
                                ? `${val.toFixed(2)} ${props.currency}`
                                : `${val.toFixed(3)} kWh`;
                        }
                    }
                }
            }
        }
    });
}

function formatBucket(bucket: string): string {
    try {
        const date = new Date(bucket);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return bucket;
    }
}

onMounted(renderChart);
watch(() => props.data, renderChart, {deep: true});
watch(currentView, renderChart);

onUnmounted(() => {
    chart?.destroy();
});
</script>

<style scoped>
.chart-card-toggle {
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
    cursor: pointer;
}
.chart-card-toggle:hover {
    color: var(--color-text-primary);
}
.chart-card-toggle--active {
    background-color: var(--color-primary);
    color: white;
}
</style>
