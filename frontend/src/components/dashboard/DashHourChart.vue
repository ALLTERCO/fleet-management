<template>
    <div class="dash-hour-chart">
        <div ref="chartEl" style="width:100%;height:65px;" />
        <div v-if="loading" class="dash-hour-overlay">
            <div class="dash-hour-skeleton" />
        </div>
        <div class="dash-hour-labels">
            <span>0h</span><span>6</span><span>12</span><span>18</span><span>23</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useEChart} from '@/composables/useEChart';
import {chartColors, hexToRgba} from '@/helpers/chartUtils';
import echarts from '@/tools/echarts';

const props = withDefaults(
    defineProps<{
        data: number[];
        color?: string;
        unit?: string;
        loading?: boolean;
    }>(),
    {unit: 'kWh'}
);

const chartEl = ref<HTMLElement | null>(null);

const option = computed(() => {
    const maxVal = Math.max(...props.data, 1);
    const sorted = [...props.data].sort((a, b) => b - a);
    const peakThreshold = sorted[2] ?? sorted[0] ?? 0;
    const baseColor = props.color ?? chartColors.primary;
    const hours = Array.from({length: 24}, (_, i) => `${i}h`);

    return {
        grid: {top: 0, right: 0, bottom: 0, left: 0},
        xAxis: {type: 'category' as const, data: hours, show: false},
        yAxis: {type: 'value' as const, show: false},
        tooltip: {
            trigger: 'axis' as const,
            formatter: (params: any) => {
                const p = Array.isArray(params) ? params[0] : params;
                const val =
                    p.value != null
                        ? typeof p.value === 'number'
                            ? p.value.toFixed(1)
                            : p.value
                        : '\u2014';
                return `<div class="dash-tooltip"><div class="dash-tooltip__label">${p.name}</div><div class="dash-tooltip__row"><span class="dash-tooltip__dot" style="background:${baseColor}"></span><span class="dash-tooltip__value">${val} ${props.unit}</span></div></div>`;
            }
        },
        series: [
            {
                type: 'bar' as const,
                data: props.data.map((v) => {
                    const isPeak = v >= peakThreshold;
                    const intensity = v / maxVal;
                    const topOpacity = isPeak ? 0.7 : 0.15 + intensity * 0.4;
                    const bottomOpacity = isPeak
                        ? 0.3
                        : 0.03 + intensity * 0.12;
                    return {
                        value: v,
                        itemStyle: {
                            color: new echarts.graphic.LinearGradient(
                                0,
                                0,
                                0,
                                1,
                                [
                                    {
                                        offset: 0,
                                        color: hexToRgba(baseColor, topOpacity)
                                    },
                                    {
                                        offset: 1,
                                        color: hexToRgba(
                                            baseColor,
                                            bottomOpacity
                                        )
                                    }
                                ]
                            ),
                            borderRadius: [3, 3, 0, 0]
                        }
                    };
                }),
                barWidth: '55%',
                emphasis: {
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            {offset: 0, color: hexToRgba(baseColor, 0.85)},
                            {offset: 1, color: hexToRgba(baseColor, 0.4)}
                        ])
                    }
                }
            }
        ],
        animationDuration: 600,
        animationEasing: 'cubicOut',
        animationDelay: (idx: number) => idx * 30
    };
});

useEChart(chartEl, option);
</script>

<style scoped>
.dash-hour-chart { position: relative; }
.dash-hour-overlay { position: absolute; inset: 0; z-index: 1; }
.dash-hour-skeleton { height: 65px; background: var(--color-surface-3); border-radius: var(--radius-md); animation: hour-pulse 1.5s ease infinite; }
@keyframes hour-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
.dash-hour-labels {
    display: flex;
    justify-content: space-between;
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    margin-top: var(--space-1);
    padding: 0 var(--space-0-5);
}
</style>
