<template>
    <CardShell
        type="ui_widget"
        :name="metricLabel"
        :icon="metricIcon"
        :size="size"
        :edit-mode="editMode"
        :configurable="true"
        @delete="$emit('delete')"
        @resize="(s: any) => $emit('resize', s)"
        @move="(d: any) => $emit('move', d)"
        @configure="$emit('configure')"
        @drag-start="(e: DragEvent) => $emit('drag-start', e)"
        @drag-end="(e: DragEvent) => $emit('drag-end', e)"
        @drag-over="(e: DragEvent) => $emit('drag-over', e)"
        @drag-leave="(e: DragEvent) => $emit('drag-leave', e)"
        @drop="(e: DragEvent) => $emit('drop', e)"
    >
        <div class="tsc" :class="{'tsc--hero': size === '2x2'}">
            <div class="tsc-header">
                <ChartRangeTabs v-model="range" :accent-color="accentColor" />
                <span v-if="latestValue !== null" class="tsc-current">
                    {{ latestValue.toFixed(precision) }}<span class="tsc-unit"> {{ metricUnit }}</span>
                </span>
            </div>
            <div v-if="loading" class="tsc-loading">
                <Skeleton variant="card" />
            </div>
            <p v-else-if="error" class="tsc-empty">
                <i class="fas fa-triangle-exclamation" /> Failed to load
            </p>
            <div v-else-if="!props.config.shellyId" class="tsc-empty tsc-empty--unconfigured">
                <i class="fas fa-chart-line tsc-empty-icon" />
                <span class="tsc-empty-title">Chart widget</span>
                <span class="tsc-empty-sub">Pick a device and metric to plot.</span>
            </div>
            <p v-else-if="!data.length" class="tsc-empty">
                <i class="fas fa-database" /> No data for this range
            </p>
            <div v-else class="tsc-canvas-wrap" :style="{height: canvasHeight + 'px'}">
                <div ref="chartEl" style="width:100%;height:100%" />
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Skeleton from '@/components/core/Skeleton.vue';
import type {ChartMetric, ChartRange} from '@/composables/useChartData';
import {useChartData} from '@/composables/useChartData';
import {useDashboardContext} from '@/composables/useDashboardContext';
import {useEChart} from '@/composables/useEChart';
import {hexToRgba} from '@/helpers/chartUtils';
import echarts from '@/tools/echarts';
import CardShell from './CardShell.vue';
import ChartRangeTabs from './ChartRangeTabs.vue';

const METRIC_META: Record<
    ChartMetric,
    {
        label: string;
        unit: string;
        icon: string;
        color: string;
        precision: number;
    }
> = {
    power: {
        label: 'Power',
        unit: 'W',
        icon: 'fas fa-bolt',
        color: '#f59e0b',
        precision: 1
    },
    consumption: {
        label: 'Energy',
        unit: 'Wh',
        icon: 'fas fa-bolt',
        color: '#f59e0b',
        precision: 2
    },
    returned_energy: {
        label: 'Return',
        unit: 'Wh',
        icon: 'fas fa-bolt',
        color: '#10b981',
        precision: 2
    },
    voltage: {
        label: 'Voltage',
        unit: 'V',
        icon: 'fas fa-bolt',
        color: '#6366f1',
        precision: 1
    },
    current: {
        label: 'Current',
        unit: 'A',
        icon: 'fas fa-bolt',
        color: '#ec4899',
        precision: 2
    },
    temperature: {
        label: 'Temperature',
        unit: '°C',
        icon: 'fas fa-thermometer-half',
        color: '#ef4444',
        precision: 1
    },
    humidity: {
        label: 'Humidity',
        unit: '%',
        icon: 'fas fa-tint',
        color: '#3b82f6',
        precision: 1
    },
    luminance: {
        label: 'Luminance',
        unit: 'lux',
        icon: 'fas fa-sun',
        color: '#eab308',
        precision: 0
    }
};

export interface ChartWidgetConfig {
    id: 'chart_widget';
    shellyId: string;
    metric: ChartMetric;
    chartType?: 'bar' | 'line';
}

const props = withDefaults(
    defineProps<{
        config: ChartWidgetConfig;
        size?: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {size: '2x1', editMode: false}
);

defineEmits<{
    delete: [];
    resize: [size: '1x1' | '2x1' | '2x2'];
    move: [direction: number];
    configure: [];
    'drag-start': [e: DragEvent];
    'drag-end': [e: DragEvent];
    'drag-over': [e: DragEvent];
    'drag-leave': [e: DragEvent];
    drop: [e: DragEvent];
}>();

const range = ref<ChartRange>('24h');

const meta = computed(
    () => METRIC_META[props.config.metric] ?? METRIC_META.power
);
const metricLabel = computed(() => meta.value.label);
const metricUnit = computed(() => meta.value.unit);
const metricIcon = computed(() => meta.value.icon);
const accentColor = computed(() => meta.value.color);
const precision = computed(() => meta.value.precision);

const {data, loading, error, granularity, refresh} = useChartData(
    computed(() => props.config.shellyId),
    computed(() => props.config.metric),
    range
);

const dashCtx = useDashboardContext();
watch(
    () => dashCtx.value.refreshSignal.value,
    () => refresh()
);

const latestValue = computed(() => {
    if (!data.value.length) return null;
    return data.value[data.value.length - 1].value;
});

const canvasHeight = computed(() => {
    if (props.size === '2x2') return 160;
    if (props.size === '2x1') return 72;
    return 52;
});

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

    const chartType = props.config.chartType ?? 'bar';
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
                name: metricLabel.value,
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
            name: metricLabel.value,
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
            name: metricLabel.value,
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
            axisLabel: {
                interval: 'auto',
                fontSize: 9,
                maxRotation: 0
            }
        },
        yAxis: {
            type: 'value',
            axisLabel: {fontSize: 9},
            splitLine: {lineStyle: {color: 'rgba(255,255,255,0.06)'}}
        },
        tooltip: {
            trigger: 'axis',
            formatter: (params: any) => {
                const p = Array.isArray(params)
                    ? (params.find(
                          (s: any) => s.seriesName === metricLabel.value
                      ) ?? params[0])
                    : params;
                const val =
                    typeof p.value === 'number'
                        ? p.value.toFixed(precision.value)
                        : p.value;
                return `${p.name}<br/>${val} ${metricUnit.value}`;
            }
        },
        series
    };
});

useEChart(chartEl, option);
</script>

<style scoped>
.tsc {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    height: 100%;
    min-height: 0;
}

.tsc--hero {
    padding: var(--space-1) 0;
}

.tsc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1-5);
    flex-shrink: 0;
}

.tsc-current {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
    white-space: nowrap;
}

.tsc-unit {
    font-size: var(--type-body);
    font-weight: 400;
    color: var(--color-text-tertiary);
}

.tsc-loading,
.tsc-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.tsc-empty--unconfigured {
    flex-direction: column;
    gap: var(--space-1);
}
.tsc-empty-icon {
    font-size: var(--type-subheading);
    color: var(--color-text-tertiary);
    opacity: 0.4;
    margin-bottom: var(--space-1);
}
.tsc-empty-title {
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.tsc-empty-sub {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.tsc-canvas-wrap {
    flex-shrink: 0;
}
</style>
