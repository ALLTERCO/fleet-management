<template>
    <div class="dash-stacked-chart">
        <div ref="chartEl" :style="{height: height + 'px'}" />
        <div v-if="loading" class="dsc-overlay">
            <div class="dsc-skeleton" :style="{height: height + 'px'}" />
        </div>
        <div v-else-if="!data.length" class="dsc-overlay">
            <div class="dsc-empty" :style="{height: height + 'px'}">No data</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useEChart} from '@/composables/useEChart';
import {chartColors, hexToRgba} from '@/helpers/chartUtils';
import echarts from '@/tools/echarts';
import type {DeviceTimePoint} from '@/types/dashboard-components';

/* Categorical palette — derived live from --chart-color-* tokens at render. */
const palette = () => [
    chartColors.primary,
    chartColors.chart6,
    chartColors.chart5,
    chartColors.chart7,
    chartColors.statusOn,
    chartColors.danger
];

const props = withDefaults(
    defineProps<{
        data: DeviceTimePoint[];
        deviceNames: Record<number, string>;
        maxSeries?: number;
        type?: 'area' | 'bar';
        height?: number;
        loading?: boolean;
    }>(),
    {maxSeries: 5, type: 'area', height: 130}
);

const chartEl = ref<HTMLElement | null>(null);

const option = computed(() => {
    if (!props.data.length) return {};

    // 1. Sum total per device
    const deviceTotals = new Map<number, number>();
    for (const p of props.data) {
        deviceTotals.set(
            p.deviceId,
            (deviceTotals.get(p.deviceId) ?? 0) + p.value
        );
    }

    // 2. Rank and take top N
    const ranked = [...deviceTotals.entries()].sort((a, b) => b[1] - a[1]);
    const topIds = new Set(ranked.slice(0, props.maxSeries).map(([id]) => id));
    const otherCount = ranked.length - topIds.size;

    // 3. Get unique sorted buckets — keep raw for data lookup, format for display
    const bucketSet = new Set(props.data.map((p) => p.bucket));
    const rawBuckets = [...bucketSet].sort();
    function fmtBucket(b: string): string {
        const d = new Date(b);
        if (Number.isNaN(d.getTime())) return b;
        return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
    }
    const bucketLabels = rawBuckets.map(fmtBucket);

    // 4. Build per-device data maps (keyed by raw bucket)
    const deviceData = new Map<number, Map<string, number>>();
    const othersData = new Map<string, number>();
    for (const b of rawBuckets) othersData.set(b, 0);

    for (const p of props.data) {
        if (topIds.has(p.deviceId)) {
            if (!deviceData.has(p.deviceId)) {
                const m = new Map<string, number>();
                for (const b of rawBuckets) m.set(b, 0);
                deviceData.set(p.deviceId, m);
            }
            const m = deviceData.get(p.deviceId)!;
            m.set(p.bucket, (m.get(p.bucket) ?? 0) + p.value);
        } else {
            othersData.set(p.bucket, (othersData.get(p.bucket) ?? 0) + p.value);
        }
    }

    // 5. Build series
    const colors = palette();
    const series: any[] = [];
    let colorIdx = 0;
    for (const [deviceId] of ranked.slice(0, props.maxSeries)) {
        const values = deviceData.get(deviceId);
        if (!values) continue;
        const color = colors[colorIdx % colors.length];
        const s: any = {
            name: props.deviceNames[deviceId] ?? `Device ${deviceId}`,
            type: props.type === 'bar' ? 'bar' : 'line',
            stack: 'total',
            data: rawBuckets.map((b) => values.get(b) ?? 0),
            itemStyle: {color}
        };
        if (props.type === 'area') {
            s.smooth = 0.4;
            s.symbol = 'none';
            s.showSymbol = false;
            s.lineStyle = {width: 1.5, color: hexToRgba(color, 0.7)};
            s.areaStyle = {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: hexToRgba(color, 0.3)},
                    {offset: 0.6, color: hexToRgba(color, 0.08)},
                    {offset: 1, color: hexToRgba(color, 0)}
                ])
            };
        }
        if (props.type === 'bar') {
            s.barWidth = '55%';
            s.itemStyle = {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: hexToRgba(color, 0.85)},
                    {offset: 1, color: hexToRgba(color, 0.4)}
                ]),
                borderRadius: [3, 3, 0, 0]
            };
        }
        series.push(s);
        colorIdx++;
    }

    // Others bucket
    if (otherCount > 0) {
        const othersValues = rawBuckets.map((b) => othersData.get(b) ?? 0);
        const s: any = {
            name: `${otherCount} others`,
            type: props.type === 'bar' ? 'bar' : 'line',
            stack: 'total',
            data: othersValues,
            itemStyle: {color: chartColors.grid}
        };
        if (props.type === 'area') {
            s.smooth = 0.4;
            s.symbol = 'none';
            s.showSymbol = false;
            s.lineStyle = {width: 1, color: chartColors.grid};
            s.areaStyle = {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: chartColors.grid},
                    {offset: 1, color: 'rgba(255,255,255,0)'}
                ])
            };
        }
        series.push(s);
    }

    return {
        grid: {top: 8, right: 4, bottom: 32, left: 36},
        legend: {bottom: 0, itemWidth: 8, itemHeight: 8, itemGap: 12},
        xAxis: {
            type: 'category',
            data: bucketLabels,
            boundaryGap: props.type === 'bar',
            axisLabel: {interval: 'auto', fontSize: 10, rotate: 0}
        },
        yAxis: {type: 'value'},
        tooltip: {trigger: 'axis'},
        series,
        animationDuration: 1000,
        animationEasing: 'cubicOut'
    };
});

useEChart(chartEl, option);
</script>

<style scoped>
.dash-stacked-chart { position: relative; width: 100%; min-width: 0; overflow: hidden; }
.dsc-overlay { position: absolute; inset: 0; z-index: 1; }
.dsc-skeleton { background: var(--color-surface-3); border-radius: var(--radius-md); animation: dsc-pulse 1.5s ease infinite; }
@keyframes dsc-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
.dsc-empty { display: flex; align-items: center; justify-content: center; color: var(--color-text-disabled); font-size: var(--type-body); }
</style>
