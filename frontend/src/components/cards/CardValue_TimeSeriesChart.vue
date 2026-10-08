<template>
    <CardShell
        type="ui_widget"
        :name="meta.label"
        :icon="meta.icon"
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
        <MetricChart
            ref="chart"
            v-model:range="range"
            :shelly-id="config.shellyId"
            :metric="config.metric"
            :chart-type="config.chartType ?? 'bar'"
            :height="canvasHeight"
        />
    </CardShell>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import type {ChartMetric, ChartRange} from '@/composables/useChartData';
import {useDashboardContext} from '@/composables/useDashboardContext';
import {metricMeta} from '@/helpers/chartMetrics';
import CardShell from './CardShell.vue';
import MetricChart from './MetricChart.vue';

export interface ChartWidgetConfig {
    id: 'chart_widget';
    shellyId: string;
    metric: ChartMetric;
    chartType?: 'bar' | 'line';
    range?: ChartRange;
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

const meta = computed(() => metricMeta(props.config.metric));
const range = ref<ChartRange>(props.config.range ?? '24h');

// 2x2 fills the card; smaller sizes pin the canvas so the header still fits.
const canvasHeight = computed<number | null>(() => {
    if (props.size === '2x2') return null;
    return props.size === '2x1' ? 72 : 52;
});

// Refresh the shared chart when the dashboard's refresh signal fires.
const chart = ref<InstanceType<typeof MetricChart> | null>(null);
const dashCtx = useDashboardContext();
watch(
    () => dashCtx.value.refreshSignal.value,
    () => chart.value?.refresh()
);
</script>
