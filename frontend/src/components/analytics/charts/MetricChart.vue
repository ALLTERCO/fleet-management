<template>
    <ChartCard
        :title="title"
        :icon="icon"
        :color="color"
        :height="180"
        :loading="loading"
        :empty="!data.length"
        :empty-text="`No ${title.toLowerCase()} data available`"
    >
        <template v-if="data.length" #summary>
            <span class="metric-stat">
                <span class="metric-stat__value">{{ statsAvg.toFixed(precision) }}</span>
                <span class="metric-stat__unit">{{ unit }} avg</span>
            </span>
        </template>

        <canvas ref="chartCanvas"></canvas>

        <template v-if="data.length" #stats>
            <span>Min: <strong>{{ statsMin.toFixed(precision) }} {{ unit }}</strong></span>
            <span>Max: <strong>{{ statsMax.toFixed(precision) }} {{ unit }}</strong></span>
        </template>
    </ChartCard>
</template>

<script setup lang="ts">
import {
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    Filler,
    Legend,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    Tooltip
} from 'chart.js';
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import ChartCard from '@/components/charts/ChartCard.vue';

Chart.register(
    BarController,
    BarElement,
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Tooltip,
    Legend,
    Filler
);

interface DataPoint {
    bucket: string;
    deviceId?: number;
    shellyId?: string;
    value: number;
    min?: number | null;
    max?: number | null;
}

const props = withDefaults(
    defineProps<{
        data: DataPoint[];
        title: string;
        unit: string;
        icon: string;
        color: string;
        chartType?: 'bar' | 'line';
        precision?: number;
        loading?: boolean;
    }>(),
    {
        chartType: 'line',
        precision: 2,
        loading: false
    }
);

const chartCanvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

interface BucketData {
    sumVal: number;
    countVal: number;
    realMin: number;
    realMax: number;
}

function groupByBucket(): Map<string, BucketData> {
    const grouped = new Map<string, BucketData>();
    for (const d of props.data) {
        const label = formatBucket(d.bucket);
        const existing = grouped.get(label) || {
            sumVal: 0,
            countVal: 0,
            realMin: Infinity,
            realMax: -Infinity
        };
        existing.sumVal += d.value;
        existing.countVal += 1;
        // Use actual min/max from data if available, otherwise use value
        const pointMin = d.min != null ? d.min : d.value;
        const pointMax = d.max != null ? d.max : d.value;
        if (pointMin < existing.realMin) existing.realMin = pointMin;
        if (pointMax > existing.realMax) existing.realMax = pointMax;
        grouped.set(label, existing);
    }
    return grouped;
}

const statsAvg = computed(() => {
    if (!props.data.length) return 0;
    const grouped = groupByBucket();
    const isEnergy = props.unit === 'kWh';
    let sum = 0;
    let count = 0;
    for (const b of grouped.values()) {
        sum += isEnergy ? b.sumVal : b.sumVal / b.countVal;
        count++;
    }
    return count > 0 ? sum / count : 0;
});

const statsMin = computed(() => {
    if (!props.data.length) return 0;
    const grouped = groupByBucket();
    let min = Infinity;
    for (const b of grouped.values()) {
        if (b.realMin < min) min = b.realMin;
    }
    return min === Infinity ? 0 : min;
});

const statsMax = computed(() => {
    if (!props.data.length) return 0;
    const grouped = groupByBucket();
    let max = -Infinity;
    for (const b of grouped.values()) {
        if (b.realMax > max) max = b.realMax;
    }
    return max === -Infinity ? 0 : max;
});

function getCSSColor(varName: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
}

function renderChart() {
    if (!chartCanvas.value || !props.data.length) {
        chart?.destroy();
        chart = null;
        return;
    }

    const ctx = chartCanvas.value.getContext('2d');
    if (!ctx) return;

    const tickColor = getCSSColor('--color-text-disabled', '#9ca3af');
    const gridColor = getCSSColor('--color-border-subtle', 'rgba(255,255,255,0.1)');

    const grouped = groupByBucket();
    const labels = Array.from(grouped.keys());
    const isEnergy = props.unit === 'kWh';

    const avgValues = labels.map((l) => {
        const b = grouped.get(l)!;
        return isEnergy ? b.sumVal : b.sumVal / b.countVal;
    });

    const hasMinMax = props.data.some((d) => d.min != null || d.max != null);

    const datasets: any[] = [];

    if (hasMinMax && props.chartType === 'line') {
        // Show min/max as a shaded band
        const minValues = labels.map((l) => grouped.get(l)!.realMin);
        const maxValues = labels.map((l) => grouped.get(l)!.realMax);

        datasets.push({
            label: `Max (${props.unit})`,
            data: maxValues,
            borderColor: props.color.replace('1)', '0.4)'),
            backgroundColor: props.color.replace('1)', '0.1)'),
            borderWidth: 1,
            pointRadius: 0,
            fill: '+1',
            tension: 0.3
        });
        datasets.push({
            label: `Avg (${props.unit})`,
            data: avgValues,
            borderColor: props.color,
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 2,
            pointBackgroundColor: props.color,
            tension: 0.3
        });
        datasets.push({
            label: `Min (${props.unit})`,
            data: minValues,
            borderColor: props.color.replace('1)', '0.4)'),
            backgroundColor: 'transparent',
            borderWidth: 1,
            pointRadius: 0,
            tension: 0.3
        });
    } else {
        datasets.push({
            label: `${props.title} (${props.unit})`,
            data: avgValues,
            backgroundColor:
                props.chartType === 'bar'
                    ? props.color.replace('1)', '0.7)')
                    : 'transparent',
            borderColor: props.color,
            borderWidth: props.chartType === 'line' ? 2 : 1,
            pointRadius: props.chartType === 'line' ? 2 : 0,
            pointBackgroundColor: props.color,
            tension: 0.3
        });
    }

    chart?.destroy();
    chart = new Chart(ctx, {
        type: props.chartType,
        data: {labels, datasets},
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: props.unit === 'kWh' || props.unit === 'A',
                    grid: {color: gridColor},
                    ticks: {color: tickColor}
                },
                x: {
                    grid: {display: false},
                    ticks: {color: tickColor}
                }
            },
            plugins: {
                legend: {display: hasMinMax},
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(props.precision)} ${props.unit}`;
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

onUnmounted(() => {
    chart?.destroy();
});
</script>

<style scoped>
.metric-stat {
    display: flex;
    align-items: baseline;
    gap: 4px;
}
.metric-stat__value {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    line-height: 1;
}
.metric-stat__unit {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
}
</style>
