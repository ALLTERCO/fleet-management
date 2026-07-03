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

        <div ref="chartEl" class="metric-chart"></div>

        <template v-if="data.length" #stats>
            <span>Min: <strong>{{ statsMin.toFixed(precision) }} {{ unit }}</strong></span>
            <span>Max: <strong>{{ statsMax.toFixed(precision) }} {{ unit }}</strong></span>
        </template>
    </ChartCard>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import ChartCard from '@/components/charts/ChartCard.vue';
import {useEChart} from '@/composables/useEChart';
import {hexToRgba} from '@/helpers/chartUtils';
import {escapeHtml} from '@/helpers/texts';

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

const chartEl = ref<HTMLElement | null>(null);

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
            realMin: Number.POSITIVE_INFINITY,
            realMax: Number.NEGATIVE_INFINITY
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
    let min = Number.POSITIVE_INFINITY;
    for (const b of grouped.values()) {
        if (b.realMin < min) min = b.realMin;
    }
    return min === Number.POSITIVE_INFINITY ? 0 : min;
});

const statsMax = computed(() => {
    if (!props.data.length) return 0;
    const grouped = groupByBucket();
    let max = Number.NEGATIVE_INFINITY;
    for (const b of grouped.values()) {
        if (b.realMax > max) max = b.realMax;
    }
    return max === Number.NEGATIVE_INFINITY ? 0 : max;
});

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

const option = computed(() => {
    const grouped = groupByBucket();
    const labels = Array.from(grouped.keys());
    const isEnergy = props.unit === 'kWh';
    const hasMinMax =
        props.chartType === 'line' &&
        props.data.some((d) => d.min != null || d.max != null);

    const avgValues = labels.map((l) => {
        const b = grouped.get(l)!;
        return isEnergy ? b.sumVal : b.sumVal / b.countVal;
    });

    const beginAtZero = props.unit === 'kWh' || props.unit === 'A';
    const colorMain = props.color;
    const colorBand = hexToRgba(props.color, 0.12);

    const series: any[] = [];

    if (hasMinMax) {
        const minValues = labels.map((l) => grouped.get(l)!.realMin);
        const maxValues = labels.map((l) => grouped.get(l)!.realMax);

        // Avg line with a markArea band between min and max at each point
        series.push({
            name: `Avg (${props.unit})`,
            type: 'line',
            data: avgValues,
            lineStyle: {color: colorMain, width: 2},
            itemStyle: {color: colorMain},
            symbolSize: 4,
            smooth: true,
            markArea: {
                silent: true,
                itemStyle: {color: colorBand},
                data: labels.map((label, i) => [
                    {xAxis: label, yAxis: minValues[i]},
                    {xAxis: label, yAxis: maxValues[i]}
                ])
            }
        });

        // Invisible min/max lines so tooltip shows them
        series.push({
            name: `Min (${props.unit})`,
            type: 'line',
            data: minValues,
            lineStyle: {
                color: hexToRgba(props.color, 0.4),
                width: 1,
                type: 'dashed'
            },
            itemStyle: {color: hexToRgba(props.color, 0.4)},
            symbolSize: 0,
            smooth: true
        });
        series.push({
            name: `Max (${props.unit})`,
            type: 'line',
            data: maxValues,
            lineStyle: {
                color: hexToRgba(props.color, 0.4),
                width: 1,
                type: 'dashed'
            },
            itemStyle: {color: hexToRgba(props.color, 0.4)},
            symbolSize: 0,
            smooth: true
        });
    } else if (props.chartType === 'bar') {
        series.push({
            name: `${props.title} (${props.unit})`,
            type: 'bar',
            data: avgValues,
            itemStyle: {color: hexToRgba(props.color, 0.8)}
        });
    } else {
        series.push({
            name: `${props.title} (${props.unit})`,
            type: 'line',
            data: avgValues,
            lineStyle: {color: colorMain, width: 2},
            itemStyle: {color: colorMain},
            symbolSize: 4,
            smooth: true
        });
    }

    return {
        tooltip: {
            trigger: 'axis',
            formatter(params: any[]) {
                if (!params.length) return '';
                const lines = params.map((p: any) => {
                    const val = (p.value as number) ?? 0;
                    return `${p.marker}${escapeHtml(String(p.seriesName))}: ${val.toFixed(props.precision)} ${escapeHtml(props.unit)}`;
                });
                return `${params[0].axisValue}<br/>${lines.join('<br/>')}`;
            }
        },
        legend: {show: hasMinMax},
        grid: {left: 44, right: 12, top: hasMinMax ? 24 : 8, bottom: 24},
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: {fontSize: 10}
        },
        yAxis: {
            type: 'value',
            min: beginAtZero ? 0 : undefined,
            axisLabel: {fontSize: 10}
        },
        series
    };
});

useEChart(chartEl, option);
</script>

<style scoped>
.metric-chart {
    width: 100%;
    height: 100%;
    min-height: 140px;
}

.metric-stat {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
}
.metric-stat__value {
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    line-height: 1;
}
.metric-stat__unit {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
