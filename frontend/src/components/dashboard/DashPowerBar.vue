<template>
    <div class="dash-power-bar">
        <div ref="chartEl" class="dpb-chart" />
        <div v-if="!devices.length" class="dpb-empty">No device data</div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {chartColors, hexToRgba} from '@/helpers/chartUtils';
import echarts from '@/tools/echarts';

const props = defineProps<{
    devices: {name: string; value: number}[];
    unit?: string;
    color?: string;
    maxItems?: number;
}>();

const chartEl = ref<HTMLElement | null>(null);
let chart: ReturnType<typeof echarts.init> | null = null;
let ro: ResizeObserver | null = null;

const option = computed(() => {
    const sorted = [...props.devices]
        .sort((a, b) => b.value - a.value)
        .slice(0, props.maxItems ?? 8);
    const names = sorted.map((d) => d.name);
    const values = sorted.map((d) => d.value);
    const c = props.color ?? chartColors.primary;

    return {
        grid: {top: 4, right: 60, bottom: 4, left: 4},
        xAxis: {type: 'value', show: false},
        yAxis: {
            type: 'category',
            data: names,
            inverse: true,
            axisLine: {show: false},
            axisTick: {show: false},
            axisLabel: {
                color: chartColors.textSecondary,
                fontSize: 11,
                width: 100,
                overflow: 'truncate'
            }
        },
        tooltip: {show: false},
        series: [
            {
                type: 'bar',
                data: values.map((v) => ({
                    value: v,
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                            {offset: 0, color: hexToRgba(c, 0.3)},
                            {offset: 1, color: hexToRgba(c, 0.8)}
                        ]),
                        borderRadius: [0, 4, 4, 0]
                    }
                })),
                barWidth: 14,
                label: {
                    show: true,
                    position: 'right',
                    color: chartColors.textTertiary,
                    fontSize: 11,
                    formatter: (p: any) =>
                        `${Math.round(p.value)} ${props.unit ?? 'W'}`
                },
                animationDuration: 800,
                animationEasing: 'cubicOut',
                animationDelay: (idx: number) => idx * 50
            }
        ]
    };
});

function initChart() {
    if (!chartEl.value || chart) return;
    chart = echarts.init(chartEl.value, 'fleet', {renderer: 'canvas'});
    chart.setOption(option.value);
    ro = new ResizeObserver(() => {
        if (chart && chartEl.value && chartEl.value.offsetWidth > 0)
            chart.resize();
    });
    ro.observe(chartEl.value);
}

onMounted(initChart);
watch(chartEl, (el) => {
    if (el && !chart) initChart();
});
watch(option, (o) => {
    chart?.setOption(o, {notMerge: true});
});
onUnmounted(() => {
    ro?.disconnect();
    chart?.dispose();
    chart = null;
});
</script>

<style scoped>
.dash-power-bar { position: relative; min-width: 0; overflow: hidden; }
.dpb-chart { width: 100%; height: 180px; }
.dpb-empty { display: flex; align-items: center; justify-content: center; height: 120px; color: var(--color-text-quaternary); font-size: var(--type-body); }
</style>
