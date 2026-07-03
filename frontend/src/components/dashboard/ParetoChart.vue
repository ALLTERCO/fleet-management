<template>
    <div ref="container" class="pareto-chart" />
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useEChart} from '@/composables/useEChart';

export interface ParetoItem {
    readonly label: string;
    readonly value: number;
}

const props = defineProps<{
    items: readonly ParetoItem[];
    title?: string;
    unit?: string;
    /** Cap shown bars; rest collapse into "Other" — kept user-tunable. */
    topN?: number;
}>();

const container = ref<HTMLElement | null>(null);

const ranked = computed(() => sortByValueDesc(props.items));
const trimmed = computed(() => truncateWithOther(ranked.value, props.topN));
const totalValue = computed(() =>
    ranked.value.reduce((sum, item) => sum + item.value, 0)
);
const cumulativePct = computed(() => buildCumulativePct(trimmed.value, totalValue.value));

const option = computed(() => ({
    title: props.title ? {text: props.title, left: 'left'} : undefined,
    tooltip: {trigger: 'axis' as const},
    legend: {bottom: 0},
    grid: {top: '15%', left: '10%', right: '10%', bottom: '15%'},
    xAxis: {
        type: 'category',
        data: trimmed.value.map((i) => i.label),
        axisLabel: {rotate: 30}
    },
    yAxis: [
        {type: 'value', name: props.unit ?? ''},
        {type: 'value', name: 'Cumulative %', max: 100, axisLabel: {formatter: '{value}%'}}
    ],
    series: [
        {
            name: 'Value',
            type: 'bar',
            data: trimmed.value.map((i) => i.value)
        },
        {
            name: 'Cumulative %',
            type: 'line',
            yAxisIndex: 1,
            symbol: 'circle',
            data: cumulativePct.value
        }
    ]
}));

function sortByValueDesc(items: readonly ParetoItem[]): ParetoItem[] {
    return [...items].sort((a, b) => b.value - a.value);
}

function truncateWithOther(
    items: readonly ParetoItem[],
    topN: number | undefined
): ParetoItem[] {
    if (!topN || items.length <= topN) return [...items];
    const head = items.slice(0, topN);
    const rest = items.slice(topN);
    const other = rest.reduce((sum, i) => sum + i.value, 0);
    return [...head, {label: 'Other', value: other}];
}

function buildCumulativePct(
    items: readonly ParetoItem[],
    total: number
): number[] {
    if (total <= 0) return items.map(() => 0);
    let running = 0;
    return items.map((i) => {
        running += i.value;
        return Math.round((running / total) * 1000) / 10;
    });
}

useEChart(container, option);
</script>

<style scoped>
.pareto-chart {
    width: 100%;
    min-height: 320px;
}
</style>
