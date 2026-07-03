<template>
    <div ref="container" class="ldc-chart" />
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useEChart} from '@/composables/useEChart';

export interface LoadDurationBand {
    readonly fromKW: number;
    readonly toKW: number | null;
    readonly hours: number;
}

const props = defineProps<{
    bands: readonly LoadDurationBand[];
    title?: string;
}>();

const container = ref<HTMLElement | null>(null);

const labels = computed(() =>
    props.bands.map((b) =>
        b.toKW === null
            ? `≥${b.fromKW.toFixed(1)}`
            : `${b.fromKW.toFixed(1)}–${b.toKW.toFixed(1)}`
    )
);

const option = computed(() => ({
    title: props.title ? {text: props.title, left: 'left'} : undefined,
    tooltip: {
        trigger: 'axis' as const,
        formatter: (params: Array<{value: number; name: string}>) => {
            const p = params[0];
            return `${p.name} kW — ${p.value}h`;
        }
    },
    grid: {top: '15%', left: '8%', right: '4%', bottom: '15%'},
    xAxis: {
        type: 'category',
        data: labels.value,
        name: 'Power band (kW)',
        nameLocation: 'middle',
        nameGap: 28
    },
    yAxis: {type: 'value', name: 'Hours'},
    series: [
        {
            type: 'bar',
            data: props.bands.map((b) => b.hours),
            itemStyle: {borderRadius: [4, 4, 0, 0]}
        }
    ]
}));

useEChart(container, option);
</script>

<style scoped>
.ldc-chart {
    width: 100%;
    min-height: 320px;
}
</style>
