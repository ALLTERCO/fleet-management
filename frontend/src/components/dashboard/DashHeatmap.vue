<template>
    <div class="dash-polar">
        <div ref="chartEl" class="dp-chart" />
        <div v-if="!data.length" class="dp-empty">No usage pattern data</div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {chartColors, hexToRgba} from '@/helpers/chartUtils';
import {escapeHtml} from '@/helpers/texts';
import echarts from '@/tools/echarts';

const props = defineProps<{
    data: [number, number, number][]; // [hour, dayOfWeek, value]
    max: number;
    // Tooltip unit. Defaults to kWh for energy; pass e.g. "°C" for reuse.
    unit?: string;
    loading?: boolean;
}>();

const chartEl = ref<HTMLElement | null>(null);
let chart: ReturnType<typeof echarts.init> | null = null;
let ro: ResizeObserver | null = null;

const HOURS = Array.from(
    {length: 24},
    (_, i) => `${String(i).padStart(2, '0')}:00`
);

const option = computed(() => {
    // Aggregate by hour across all days
    const hourTotals = new Array(24).fill(0);
    for (const [hour, , value] of props.data) {
        hourTotals[hour] += value;
    }

    // Weekday vs weekend split
    const weekdayHours = new Array(24).fill(0);
    const weekendHours = new Array(24).fill(0);
    let weekdayCount = 0;
    let weekendCount = 0;
    const daysSeen = new Set<number>();
    for (const [hour, day, value] of props.data) {
        daysSeen.add(day);
        if (day === 0 || day === 6) {
            weekendHours[hour] += value;
        } else {
            weekdayHours[hour] += value;
        }
    }
    for (const d of daysSeen) {
        if (d === 0 || d === 6) weekendCount++;
        else weekdayCount++;
    }
    // Average per day count to normalize
    const wdNorm = weekdayCount || 1;
    const weNorm = weekendCount || 1;

    const primary = chartColors.primary;
    const secondary = chartColors.chart5;

    return {
        polar: {radius: ['20%', '75%']},
        angleAxis: {
            type: 'category',
            data: HOURS,
            axisLine: {show: false},
            axisTick: {show: false},
            axisLabel: {
                color: chartColors.textTertiary,
                fontSize: 9,
                interval: 2,
                formatter: (v: string) => v.slice(0, 2)
            },
            splitLine: {lineStyle: {color: chartColors.grid}}
        },
        radiusAxis: {
            axisLine: {show: false},
            axisTick: {show: false},
            axisLabel: {show: false},
            splitLine: {lineStyle: {color: chartColors.grid}}
        },
        tooltip: {
            trigger: 'axis',
            formatter: (params: any) => {
                const items = Array.isArray(params) ? params : [params];
                const hour = items[0]?.name ?? '';
                let html = `<div class="dash-tooltip"><div class="dash-tooltip__label">${hour}</div>`;
                for (const p of items) {
                    if (p.value == null) continue;
                    const color = p.color ?? primary;
                    html += `<div class="dash-tooltip__row"><span class="dash-tooltip__dot" style="background:${color}"></span><span class="dash-tooltip__value">${escapeHtml(String(p.seriesName))}: ${p.value.toFixed(1)} ${props.unit ?? 'kWh'}</span></div>`;
                }
                return `${html}</div>`;
            }
        },
        legend: {
            bottom: 0,
            textStyle: {color: chartColors.textTertiary, fontSize: 10},
            itemWidth: 8,
            itemHeight: 8
        },
        series: [
            {
                name: 'Weekday avg',
                type: 'bar',
                coordinateSystem: 'polar',
                data: weekdayHours.map((v) => +(v / wdNorm).toFixed(2)),
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        {offset: 0, color: hexToRgba(primary, 0.8)},
                        {offset: 1, color: hexToRgba(primary, 0.3)}
                    ]),
                    borderRadius: 2
                },
                emphasis: {itemStyle: {opacity: 1}},
                animationDuration: 1200,
                animationEasing: 'cubicOut',
                animationDelay: (idx: number) => idx * 30
            },
            {
                name: 'Weekend avg',
                type: 'bar',
                coordinateSystem: 'polar',
                data: weekendHours.map((v) => +(v / weNorm).toFixed(2)),
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        {offset: 0, color: hexToRgba(secondary, 0.8)},
                        {offset: 1, color: hexToRgba(secondary, 0.3)}
                    ]),
                    borderRadius: 2
                },
                emphasis: {itemStyle: {opacity: 1}},
                animationDuration: 1200,
                animationEasing: 'cubicOut',
                animationDelay: (idx: number) => idx * 30 + 15
            }
        ],
        animationDuration: 1200,
        animationEasing: 'cubicOut'
    };
});

function initChart() {
    if (!chartEl.value || chart) return;
    chart = echarts.init(chartEl.value, 'fleet', {renderer: 'canvas'});
    chart.setOption(option.value as any);
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
    chart?.setOption(o as any, {notMerge: true});
});
onUnmounted(() => {
    ro?.disconnect();
    chart?.dispose();
    chart = null;
});
</script>

<style scoped>
.dash-polar { position: relative; min-width: 0; overflow: hidden; }
.dp-chart { width: 100%; height: 220px; }
.dp-empty { display: flex; align-items: center; justify-content: center; height: 220px; color: var(--color-text-quaternary); font-size: var(--type-body); }
</style>
