<template>
    <div ref="container" class="heatmap-chart" />
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useEChart} from '@/composables/useEChart';

export interface HeatmapCell {
    /** 0 = Mon … 6 = Sun (display order) */
    readonly day: number;
    /** 0..23 */
    readonly hour: number;
    readonly value: number;
}

const props = defineProps<{
    cells: readonly HeatmapCell[];
    title?: string;
    unit?: string;
}>();

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_LABELS = Array.from({length: 24}, (_, h) =>
    h.toString().padStart(2, '0')
);

const container = ref<HTMLElement | null>(null);

const maxValue = computed(() => {
    let m = 0;
    for (const c of props.cells) {
        if (Number.isFinite(c.value) && c.value > m) m = c.value;
    }
    return m;
});

const option = computed(() => ({
    title: props.title ? {text: props.title, left: 'left'} : undefined,
    tooltip: {
        position: 'top' as const,
        formatter: (params: {data?: [number, number, number]}) => {
            if (!params.data) return '';
            const [hour, day, value] = params.data;
            return `${DAY_LABELS[day]} ${HOUR_LABELS[hour]}:00 — ${value.toFixed(2)}${props.unit ? ' ' + props.unit : ''}`;
        }
    },
    grid: {height: '70%', top: '10%'},
    xAxis: {type: 'category', data: HOUR_LABELS, name: 'Hour (UTC)'},
    yAxis: {type: 'category', data: DAY_LABELS, name: 'Day'},
    visualMap: {
        min: 0,
        max: maxValue.value || 1,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: '0%'
    },
    series: [
        {
            type: 'heatmap',
            data: props.cells.map((c) => [c.hour, c.day, c.value]),
            label: {show: false},
            emphasis: {itemStyle: {shadowBlur: 8}}
        }
    ]
}));

useEChart(container, option);
</script>

<style scoped>
.heatmap-chart {
    width: 100%;
    min-height: 320px;
}
</style>
