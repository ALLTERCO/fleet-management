<template>
    <div class="mc">
        <div v-if="showHeader" class="mc-header">
            <ChartRangeTabs
                :model-value="range"
                :accent-color="meta.color"
                @update:model-value="$emit('update:range', $event)"
            />
            <span v-if="latestValue !== null" class="mc-current">
                {{ latestValue.toFixed(meta.precision) }}<span class="ec-u ec-u--sm">{{ meta.unit }}</span>
            </span>
        </div>
        <div v-if="loading" class="mc-state">
            <Skeleton variant="card" />
        </div>
        <p v-else-if="error" class="mc-state">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" /> Failed to load
        </p>
        <p v-else-if="!shellyId" class="mc-state">
            <i class="fas fa-chart-line" aria-hidden="true" /> No device selected
        </p>
        <p v-else-if="!data.length" class="mc-state">
            <i class="fas fa-database" aria-hidden="true" /> No data for this range
        </p>
        <div
            v-else
            class="mc-canvas-wrap"
            :class="{'min-h-0 flex-1': height === null}"
            :style="height === null ? undefined : {height: height + 'px'}"
        >
            <div ref="chartEl" style="width:100%;height:100%" />
        </div>
    </div>
</template>

<script setup lang="ts">
import type {SensorSource} from '@api/sensor';
import {computed, ref} from 'vue';
import Skeleton from '@/components/core/Skeleton.vue';
import type {ChartMetric, ChartRange} from '@/composables/useChartData';
import {useChartData} from '@/composables/useChartData';
import {useEChart} from '@/composables/useEChart';
import {metricMeta} from '@/helpers/chartMetrics';
import {hexToRgba} from '@/helpers/chartUtils';
import echarts from '@/tools/echarts';
import ChartRangeTabs from './ChartRangeTabs.vue';

const props = withDefaults(
    defineProps<{
        shellyId: string;
        metric: ChartMetric;
        range: ChartRange;
        // Sensor channel for environmental metrics — filters Sensor.Query to this
        // entity. Omit for energy metrics and device-wide widgets.
        channel?: number;
        // Entity's reading source. Omit for ambient; 'internal' charts the
        // device's own chip temperature, which ambient reads leave out.
        source?: SensorSource;
        chartType?: 'bar' | 'line';
        // null = fill the container; a number pins the canvas height.
        height?: number | null;
        showHeader?: boolean;
    }>(),
    {chartType: 'bar', height: null, showHeader: true}
);

defineEmits<{'update:range': [range: ChartRange]}>();

const meta = computed(() => metricMeta(props.metric));

const {data, loading, error, granularity, refresh} = useChartData(
    computed(() => props.shellyId),
    computed(() => props.metric),
    computed(() => props.range),
    computed(() => props.channel),
    computed(() => props.source)
);

defineExpose({refresh});

const latestValue = computed(() =>
    data.value.length ? data.value[data.value.length - 1].value : null
);

const chartEl = ref<HTMLElement | null>(null);

function formatBucket(bucket: string): string {
    const d = new Date(bucket);
    if (Number.isNaN(d.getTime())) return bucket;
    if (granularity.value === 'hour') {
        return d.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

const option = computed(() => {
    if (!data.value.length) return {};

    const chartType = props.chartType;
    const color = meta.value.color;
    const labels = data.value.map((p) => formatBucket(p.bucket));
    const values = data.value.map((p) => p.value);
    const hasMinMax =
        chartType === 'line' &&
        data.value.some((p) => p.min != null && p.max != null);

    const series: any[] = [];

    if (hasMinMax) {
        series.push(
            {
                type: 'line',
                name: 'Max',
                data: data.value.map((p) => p.max ?? p.value),
                smooth: 0.3,
                symbol: 'none',
                lineStyle: {width: 0},
                areaStyle: {color: hexToRgba(color, 0.12)},
                stack: 'band',
                z: 1
            },
            {
                type: 'line',
                name: meta.value.label,
                data: values,
                smooth: 0.3,
                symbol: 'circle',
                symbolSize: 4,
                lineStyle: {color, width: 2},
                itemStyle: {color},
                z: 3
            },
            {
                type: 'line',
                name: 'Min',
                data: data.value.map((p) => p.min ?? p.value),
                smooth: 0.3,
                symbol: 'none',
                lineStyle: {width: 0},
                areaStyle: {color: hexToRgba(color, 0.12)},
                stack: 'band',
                z: 1
            }
        );
    } else if (chartType === 'line') {
        series.push({
            type: 'line',
            name: meta.value.label,
            data: values,
            smooth: 0.3,
            symbol: 'circle',
            symbolSize: 4,
            lineStyle: {color, width: 2},
            itemStyle: {color},
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: hexToRgba(color, 0.18)},
                    {offset: 1, color: hexToRgba(color, 0)}
                ])
            }
        });
    } else {
        series.push({
            type: 'bar',
            name: meta.value.label,
            data: values,
            itemStyle: {
                color: hexToRgba(color, 0.8),
                borderRadius: [2, 2, 0, 0]
            },
            barMaxWidth: 20
        });
    }

    return {
        grid: {top: 4, right: 4, bottom: 16, left: 32},
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: {interval: 'auto', fontSize: 9, maxRotation: 0}
        },
        yAxis: {
            type: 'value',
            axisLabel: {fontSize: 9},
            splitLine: {lineStyle: {color: 'var(--chart-grid)'}}
        },
        tooltip: {
            trigger: 'axis',
            formatter: (params: any) => {
                const p = Array.isArray(params)
                    ? (params.find(
                          (s: any) => s.seriesName === meta.value.label
                      ) ?? params[0])
                    : params;
                const val =
                    typeof p.value === 'number'
                        ? p.value.toFixed(meta.value.precision)
                        : p.value;
                return `${p.name}<br/>${val} ${meta.value.unit}`;
            }
        },
        series
    };
});

useEChart(chartEl, option);
</script>

<style scoped>
.mc {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    height: 100%;
    min-height: 0;
}

.mc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1-5);
    flex-shrink: 0;
}

.mc-current {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}

.mc-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.mc-canvas-wrap {
    flex-shrink: 0;
}
</style>
