<template>
    <div class="w-full tsc__host" :style="{height: height + 'px'}">
        <div ref="chartEl" class="tsc__fill" />
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useEChart} from '@/composables/useEChart';
import {hexToRgba} from '@/helpers/chartUtils';
import echarts from '@/tools/echarts';

export interface Threshold {
    value: number;
    color: string;
    label: string;
}

const props = withDefaults(
    defineProps<{
        data: number[];
        label: string;
        color: string;
        unit?: string;
        height?: number;
        thresholds?: Threshold[];
        showArea?: boolean;
    }>(),
    {
        unit: '',
        height: 180,
        thresholds: () => [],
        showArea: true
    }
);

const chartEl = ref<HTMLElement | null>(null);

function buildLabels(count: number): string[] {
    return Array.from({length: count}, (_, i) => {
        const secsAgo = (count - 1 - i) * 5;
        if (secsAgo === 0) return 'now';
        if (secsAgo < 60) return `-${secsAgo}s`;
        return `-${Math.floor(secsAgo / 60)}m`;
    });
}

const option = computed(() => {
    const labels = buildLabels(props.data.length);
    const values = [...props.data];
    const thresholdMax = props.thresholds.length
        ? Math.max(...props.thresholds.map((t) => t.value))
        : 0;
    const dataMax = values.length ? Math.max(...values) : 0;
    const suggestedMax = Math.max(dataMax, thresholdMax, 1) * 1.1;

    const mainSeries: any = {
        type: 'line',
        data: values,
        smooth: 0.3,
        symbol: 'none',
        lineStyle: {color: props.color, width: 2},
        emphasis: {lineStyle: {width: 2}}
    };

    if (props.showArea) {
        mainSeries.areaStyle = {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                {offset: 0, color: hexToRgba(props.color, 0.12)},
                {offset: 1, color: hexToRgba(props.color, 0)}
            ])
        };
    }

    if (props.thresholds.length) {
        mainSeries.markLine = {
            silent: true,
            symbol: 'none',
            data: props.thresholds.map((t) => ({
                yAxis: t.value,
                lineStyle: {color: t.color, type: 'dashed', width: 1},
                label: {
                    formatter: t.label,
                    position: 'end' as const,
                    fontSize: 10
                }
            }))
        };
    }

    return {
        grid: {top: 8, right: 8, bottom: 20, left: 40},
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: {interval: 'auto', fontSize: 9, fontFamily: 'monospace'}
        },
        yAxis: {
            type: 'value',
            min: Math.min(...values, 0),
            max: suggestedMax,
            axisLabel: {
                fontSize: 9,
                fontFamily: 'monospace',
                formatter: (v: number) => `${v}${props.unit}`
            }
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: {type: 'cross'},
            formatter: (params: any) => {
                const p = Array.isArray(params) ? params[0] : params;
                const val = typeof p.value === 'number' ? p.value : p.value;
                return `${p.name}<br/>${props.label}: ${val}${props.unit}`;
            }
        },
        series: [mainSeries]
    };
});

useEChart(chartEl, option);
</script>

<style scoped>
.tsc__fill {
    width: 100%;
    height: 100%;
}
</style>

