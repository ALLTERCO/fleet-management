<template>
    <div class="dash-energy-bal">
        <div v-if="loading" class="deb-skeleton">
            <div class="deb-skeleton-chart" />
            <div class="deb-skeleton-stats">
                <span v-for="i in 4" :key="i" class="deb-skeleton-stat" />
            </div>
        </div>
        <template v-else>
        <!-- Overlaid area chart: consumed + returned -->
        <div ref="chartEl" class="deb-chart" />

        <!-- Stats row below chart -->
        <div class="deb-stats">
            <div class="deb-stat">
                <span class="deb-stat-dot deb-dot--consumed" />
                <span class="deb-stat-label">Consumed</span>
                <span class="deb-stat-value">{{ formatNum(consumed) }} <span class="deb-stat-unit">kWh</span></span>
            </div>
            <div class="deb-stat">
                <span class="deb-stat-dot deb-dot--returned" />
                <span class="deb-stat-label">Returned</span>
                <span class="deb-stat-value">{{ formatNum(returned) }} <span class="deb-stat-unit">kWh</span></span>
            </div>
            <div class="deb-stat">
                <span class="deb-stat-label">Net</span>
                <span class="deb-stat-value">{{ formatNum(net) }} <span class="deb-stat-unit">kWh</span></span>
            </div>
            <div class="deb-stat">
                <span class="deb-stat-label">Avg / day</span>
                <span class="deb-stat-value">{{ formatNum(avgPerDay) }} <span class="deb-stat-unit">kWh</span></span>
            </div>
        </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import {chartColors, hexToRgba} from '@/helpers/chartUtils';
import echarts from '@/tools/echarts';

const props = defineProps<{
    consumed: number;
    returned: number;
    consumedHistory?: {bucket: string; value: number}[];
    returnedHistory?: {bucket: string; value: number}[];
    days: number;
    loading?: boolean;
}>();

const chartEl = ref<HTMLElement | null>(null);
let chart: ReturnType<typeof echarts.init> | null = null;
let ro: ResizeObserver | null = null;

const net = computed(() => props.consumed - props.returned);
const avgPerDay = computed(() => (props.days > 0 ? net.value / props.days : 0));

function fmtBucket(b: string): string {
    const d = new Date(b);
    if (Number.isNaN(d.getTime())) return b;
    return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
}

function buildOption() {
    const cHist = props.consumedHistory ?? [];
    const rHist = props.returnedHistory ?? [];

    // If no history data, show a simple 2-bar comparison
    if (!cHist.length) {
        return {
            grid: {top: 4, right: 80, bottom: 4, left: 4},
            xAxis: {
                type: 'value',
                show: false,
                max: Math.max(props.consumed, props.returned, 1)
            },
            yAxis: {
                type: 'category',
                data: ['Returned', 'Consumed'],
                axisLine: {show: false},
                axisTick: {show: false},
                axisLabel: {show: false},
                inverse: true
            },
            tooltip: {show: false},
            series: [
                {
                    type: 'bar',
                    data: [
                        {
                            value: props.returned,
                            itemStyle: {
                                color: hexToRgba(chartColors.success, 0.6),
                                borderRadius: [0, 4, 4, 0]
                            }
                        },
                        {
                            value: props.consumed,
                            itemStyle: {
                                color: hexToRgba(chartColors.primary, 0.6),
                                borderRadius: [0, 4, 4, 0]
                            }
                        }
                    ],
                    barWidth: 16,
                    label: {
                        show: true,
                        position: 'right',
                        color: chartColors.textTertiary,
                        fontSize: 11,
                        formatter: (p: any) => `${p.value?.toFixed(1)} kWh`
                    },
                    animationDuration: 1000,
                    animationEasing: 'cubicOut'
                }
            ]
        };
    }

    // Overlaid area chart — consumed + returned on same time axis
    const allBuckets = [
        ...new Set([
            ...cHist.map((d) => d.bucket),
            ...rHist.map((d) => d.bucket)
        ])
    ].sort();
    const cMap = new Map<string, number>();
    for (const d of cHist)
        cMap.set(d.bucket, (cMap.get(d.bucket) ?? 0) + d.value);
    const rMap = new Map<string, number>();
    for (const d of rHist)
        rMap.set(d.bucket, (rMap.get(d.bucket) ?? 0) + d.value);

    const labels = allBuckets.map(fmtBucket);
    const cData = allBuckets.map((b) => cMap.get(b) ?? 0);
    const rData = allBuckets.map((b) => rMap.get(b) ?? 0);

    return {
        grid: {top: 8, right: 4, bottom: 20, left: 36},
        xAxis: {
            type: 'category',
            data: labels,
            axisLabel: {fontSize: 10, interval: 'auto'}
        },
        yAxis: {type: 'value'},
        tooltip: {trigger: 'axis'},
        legend: {show: false},
        series: [
            {
                name: 'Consumed',
                type: 'line',
                data: cData,
                smooth: 0.4,
                symbol: 'none',
                lineStyle: {color: hexToRgba(chartColors.primary, 0.8), width: 1.5},
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        {offset: 0, color: hexToRgba(chartColors.primary, 0.2)},
                        {offset: 1, color: hexToRgba(chartColors.primary, 0)}
                    ])
                },
                z: 1
            },
            {
                name: 'Returned',
                type: 'line',
                data: rData,
                smooth: 0.4,
                symbol: 'none',
                lineStyle: {color: hexToRgba(chartColors.success, 0.8), width: 1.5},
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        {offset: 0, color: hexToRgba(chartColors.success, 0.2)},
                        {offset: 1, color: hexToRgba(chartColors.success, 0)}
                    ])
                },
                z: 2
            }
        ],
        animationDuration: 1000,
        animationEasing: 'cubicOut'
    };
}

function initChart() {
    if (!chartEl.value || chart) return;
    chart = echarts.init(chartEl.value, 'fleet', {renderer: 'canvas'});
    chart.setOption(buildOption() as any);
    ro = new ResizeObserver(() => {
        if (chart && chartEl.value && chartEl.value.offsetWidth > 0)
            chart.resize();
    });
    ro.observe(chartEl.value);
}

onMounted(initChart);

watch(
    () => [
        props.consumed,
        props.returned,
        props.consumedHistory,
        props.returnedHistory
    ],
    () => {
        if (chart) chart.setOption(buildOption() as any, {notMerge: true});
        else initChart();
    }
);

watch(chartEl, (el) => {
    if (el && !chart) initChart();
});

onUnmounted(() => {
    ro?.disconnect();
    chart?.dispose();
    chart = null;
});

function formatNum(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 1});
}
</script>

<style scoped>
.dash-energy-bal {
    animation: deb-appear 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
    min-width: 0;
    overflow: hidden;
}
@keyframes deb-appear {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
}
.deb-chart {
    width: 100%;
    height: 120px;
}
.deb-stats {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
    flex-wrap: wrap;
}
.deb-stat {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
}
.deb-stat-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    align-self: center;
}
.deb-dot--consumed { background: var(--color-primary); }
.deb-dot--returned { background: var(--color-status-on); }
.deb-stat-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    margin-right: var(--space-0-5);
}
.deb-stat-value {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}
.deb-stat-unit {
    font-size: var(--type-body);
    font-weight: 400;
    color: var(--color-text-quaternary);
}
.deb-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.deb-skeleton-chart {
    height: 120px;
    border-radius: var(--radius-md);
    background: linear-gradient(
        90deg,
        var(--color-surface-3) 0%,
        var(--color-surface-2) 50%,
        var(--color-surface-3) 100%
    );
    background-size: 200% 100%;
    animation: deb-shimmer 1.6s ease-in-out infinite;
}
.deb-skeleton-stats {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
}
.deb-skeleton-stat {
    flex: 1;
    min-width: var(--space-12);
    height: var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    animation: deb-shimmer 1.6s ease-in-out infinite;
}
@keyframes deb-shimmer {
    0%, 100% { opacity: 1; background-position: 0% 0%; }
    50% { opacity: 0.5; background-position: 200% 0%; }
}
@media (prefers-reduced-motion: reduce) {
    .deb-skeleton-chart, .deb-skeleton-stat { animation: none; }
}
</style>
