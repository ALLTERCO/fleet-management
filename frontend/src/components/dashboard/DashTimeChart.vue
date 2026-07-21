<template>
    <div class="dash-time-chart">
        <button
            v-if="brush"
            type="button"
            class="dash-chart-brush-toggle"
            :class="{'dash-chart-brush-toggle--active': brushActive}"
            :aria-pressed="brushActive"
            @click="toggleBrush"
        >
            <i class="fas fa-crosshairs" aria-hidden="true" />
            <span>{{ brushActive ? 'Done' : 'Compare' }}</span>
        </button>
        <div ref="chartEl" :style="{height: height + 'px'}" />
        <div v-if="loading" class="dash-chart-overlay">
            <div class="dash-chart-skeleton" :style="{height: height + 'px'}" />
        </div>
        <div v-else-if="!data.length" class="dash-chart-overlay">
            <div class="dash-chart-empty" :style="{height: height + 'px'}">
                No data for this period
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {BrushComponent, ToolboxComponent} from 'echarts/components';
import {computed, ref, watch} from 'vue';
import {useEChart} from '@/composables/useEChart';
import {chartColors, hexToRgba} from '@/helpers/chartUtils';
import {escapeHtml} from '@/helpers/texts';
import echarts from '@/tools/echarts';
import type {TimePoint} from '@/types/dashboard-components';

// Brush + Toolbox are this chart's only consumers; registering locally keeps
// them off every other chart's render path (where the brush controller
// crashes on grids whose coordinateSystem hasn't been built yet).
echarts.use([BrushComponent, ToolboxComponent]);

const props = withDefaults(
    defineProps<{
        data: TimePoint[];
        prevData?: TimePoint[];
        secondaryData?: TimePoint[];
        secondaryColor?: string;
        secondaryLabel?: string;
        type?: 'area' | 'bar' | 'line';
        color?: string;
        zoom?: boolean;
        height?: number;
        unit?: string;
        markArea?: {min: number; max: number};
        // Shaded vertical bands across the X axis — e.g. tariff peak/off-peak
        // windows on a consumption chart. Buckets must match the data's
        // bucket format (typically "HH:MM").
        bands?: ReadonlyArray<{
            fromBucket: string;
            toBucket: string;
            color: string;
            label?: string;
        }>;
        loading?: boolean;
        // Honeycomb-style brush-to-compare. Opt-in: enabling reveals a
        // "Compare" toggle; while active the user drags across the X axis
        // to select a window, and the chart emits `brush-end` with the
        // bucket range. Pair with Analytics.AttributeWindow for the
        // contributor breakdown (see Agent 3 brief 2026-05-28).
        brush?: boolean;
    }>(),
    {
        type: 'area',
        zoom: true,
        height: 160
    }
);

const emit =
    defineEmits<(e: 'brush-end', range: {from: string; to: string}) => void>();

const chartEl = ref<HTMLElement | null>(null);

function formatBucket(b: string): string {
    // Already formatted (HH:MM) — keep as is
    if (/^\d{2}:\d{2}$/.test(b)) return b;
    const d = new Date(b);
    if (Number.isNaN(d.getTime())) return b;
    const now = new Date();
    const diffDays = (now.getTime() - d.getTime()) / 86400000;
    if (diffDays < 2)
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (diffDays < 365)
        return `${d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}`;
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: '2-digit'
    });
}

const option = computed(() => {
    const buckets = props.data.map((d) => formatBucket(d.bucket));
    const values = props.data.map((d) => d.value);
    const seriesColor = props.color ?? chartColors.primary;

    const series: any[] = [];

    if (props.prevData?.length) {
        series.push({
            type: 'line',
            data: props.prevData.map((d) => d.value),
            smooth: 0.4,
            symbol: 'none',
            lineStyle: {
                color: chartColors.grid,
                width: 1,
                type: 'dashed'
            },
            z: 1,
            animationDuration: 1200,
            animationEasing: 'cubicOut'
        });
    }

    const mainSeries: any = {
        type: props.type === 'bar' ? 'bar' : 'line',
        data: values,
        smooth: 0.4,
        symbol: 'none',
        showSymbol: false,
        z: 2,
        animationDuration: 1200,
        animationEasing: 'cubicOut',
        animationDelay: 200
    };

    if (props.type === 'bar') {
        mainSeries.data = values.map((v, _i) => ({
            value: v,
            itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: hexToRgba(seriesColor, 0.85)},
                    {offset: 1, color: hexToRgba(seriesColor, 0.25)}
                ]),
                borderRadius: [3, 3, 0, 0]
            }
        }));
        mainSeries.barWidth = '60%';
        mainSeries.emphasis = {
            itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: hexToRgba(seriesColor, 1)},
                    {offset: 1, color: hexToRgba(seriesColor, 0.5)}
                ])
            }
        };
        mainSeries.animationDelay = (idx: number) => idx * 30;
    } else {
        mainSeries.lineStyle = {
            color: seriesColor,
            width: 2,
            shadowColor: hexToRgba(seriesColor, 0.3),
            shadowBlur: 8,
            shadowOffsetY: 4
        };
        mainSeries.emphasis = {
            lineStyle: {width: 2.5}
        };
        if (props.type === 'area') {
            mainSeries.areaStyle = {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: hexToRgba(seriesColor, 0.3)},
                    {offset: 0.5, color: hexToRgba(seriesColor, 0.08)},
                    {offset: 1, color: hexToRgba(seriesColor, 0)}
                ])
            };
        }
    }

    if (props.markArea) {
        mainSeries.markArea = {
            silent: true,
            data: [[{yAxis: props.markArea.min}, {yAxis: props.markArea.max}]],
            // Resolve to a concrete color; canvas fillStyle can't parse var().
            itemStyle: {color: hexToRgba(chartColors.success, 0.06)},
            animationDuration: 600
        };
    }

    if (props.bands?.length) {
        // Each band is one [xAxis-start, xAxis-end] pair with its own colour.
        const bandSeries = {
            name: '__bands',
            type: 'line',
            data: [],
            silent: true,
            showSymbol: false,
            tooltip: {show: false},
            markArea: {
                silent: true,
                data: props.bands.map((b) => [
                    {
                        xAxis: b.fromBucket,
                        itemStyle: {color: b.color},
                        name: b.label ?? ''
                    },
                    {xAxis: b.toBucket}
                ]),
                emphasis: {disabled: true}
            }
        };
        series.push(bandSeries as never);
    }

    series.push(mainSeries);

    // Secondary overlay series (e.g. returned energy on consumption chart).
    // Pre-index by both formatted-bucket and raw-bucket so the per-row
    // lookup is O(1); the prior .find()-in-.map() was O(n×m) and burned
    // ~500k cmp/render for 30-day hourly.
    if (props.secondaryData?.length) {
        const secColor = props.secondaryColor ?? chartColors.success;
        const secByFormatted = new Map<string, number>();
        const secByRaw = new Map<unknown, number>();
        for (const d of props.secondaryData) {
            secByFormatted.set(formatBucket(d.bucket), d.value);
            secByRaw.set(d.bucket, d.value);
        }
        const secValues = buckets.map((b, i) => {
            const raw = props.data[i]?.bucket;
            return secByFormatted.get(b) ?? secByRaw.get(raw) ?? 0;
        });
        series.push({
            name: props.secondaryLabel ?? 'Secondary',
            type: 'line',
            data: secValues,
            smooth: 0.4,
            symbol: 'none',
            showSymbol: false,
            z: 3,
            lineStyle: {color: secColor, width: 1.5},
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    {offset: 0, color: hexToRgba(secColor, 0.2)},
                    {offset: 0.5, color: hexToRgba(secColor, 0.05)},
                    {offset: 1, color: hexToRgba(secColor, 0)}
                ])
            },
            animationDuration: 1200,
            animationEasing: 'cubicOut'
        });
    }

    const opt: any = {
        grid: {top: 8, right: 4, bottom: 20, left: 36},
        xAxis: {
            type: 'category',
            data: buckets,
            axisLabel: {interval: 'auto', fontSize: 10, rotate: 0}
        },
        yAxis: {type: 'value'},
        tooltip: {
            formatter: (params: any) => {
                const items = Array.isArray(params) ? params : [params];
                const label = items[0]?.name ?? '';
                let html = `<div class="dash-tooltip"><div class="dash-tooltip__label">${label}</div>`;
                for (const p of items) {
                    if (p.value == null) continue;
                    const val =
                        typeof p.value === 'number'
                            ? p.value.toFixed(1)
                            : p.value;
                    const color = p.color ?? seriesColor;
                    const name =
                        p.seriesName && p.seriesName !== 'Series 1'
                            ? `<span class="dash-tooltip__series">${escapeHtml(String(p.seriesName))}</span>`
                            : '';
                    html += `<div class="dash-tooltip__row"><span class="dash-tooltip__dot" style="background:${color}"></span><span class="dash-tooltip__value">${val}${props.unit ? ` ${props.unit}` : ''}</span>${name}</div>`;
                }
                return `${html}</div>`;
            }
        },
        series,
        animationDuration: 1200,
        animationEasing: 'cubicOut',
        animationDurationUpdate: 400,
        animationEasingUpdate: 'cubicOut'
    };

    // No grid coord-system → dataZoom/brush crash on grid().master.
    // Length alone isn't enough: an array of all-null points still
    // produces an empty grid. Require at least one finite value.
    const hasPlottableValue = props.data.some(
        (d) => typeof d.value === 'number' && Number.isFinite(d.value)
    );
    const hasData = props.data.length > 0 && hasPlottableValue;

    if (props.zoom && hasData) {
        opt.dataZoom = [{
            type: 'inside',
            start: 0,
            end: 100,
            zoomOnMouseWheel: !props.brush,
            moveOnMouseWheel: false
        }];
    }

    if (props.brush && hasData) {
        // Toolbox stays hidden — the "Compare" button above the chart
        // drives brush mode via takeGlobalCursor.
        opt.toolbox = {show: false, feature: {brush: {type: ['lineX']}}};
        opt.brush = {
            xAxisIndex: 0,
            brushType: 'lineX',
            brushMode: 'single',
            throttleType: 'debounce',
            throttleDelay: 150,
            brushStyle: {
                borderColor: chartColors.primary,
                borderWidth: 1,
                color: hexToRgba(chartColors.primary, 0.18)
            }
        };
    }

    return opt;
});

const brushActive = ref(false);
const {chart} = useEChart(chartEl, option);

function toggleBrush() {
    if (!chart.value) return;
    brushActive.value = !brushActive.value;
    chart.value.dispatchAction({
        type: 'takeGlobalCursor',
        key: brushActive.value ? 'brush' : undefined,
        brushOption: brushActive.value
            ? {brushType: 'lineX', brushMode: 'single'}
            : undefined
    });
}

// Translate ECharts' brush coordRange (category indices) back into the
// bucket strings that callers index data by — Analytics.AttributeWindow
// takes ISO timestamps, but DashTimeChart stays bucket-agnostic so
// callers can map HH:MM or daily buckets to ISO themselves.
watch(
    chart,
    (c) => {
        if (!c || !props.brush) return;
        c.on('brushEnd', (params: any) => {
            const area = params?.areas?.[0];
            if (!area) return;
            const range = area.coordRange;
            if (!Array.isArray(range) || range.length !== 2) return;
            const [start, end] = range;
            const buckets = props.data.map((d) => d.bucket);
            const fromIdx = Math.max(0, Math.floor(Math.min(start, end)));
            const toIdx = Math.min(
                buckets.length - 1,
                Math.ceil(Math.max(start, end))
            );
            const from = buckets[fromIdx];
            const to = buckets[toIdx];
            if (from && to) emit('brush-end', {from, to});
        });
    },
    {immediate: true}
);
</script>

<style scoped>
.dash-time-chart {
    position: relative;
    animation: chart-fade-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    animation-delay: 100ms;
    width: 100%;
    min-width: 0;
    overflow: hidden;
}
@keyframes chart-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
}
.dash-chart-overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
}
.dash-chart-skeleton {
    background: var(--color-surface-3);
    border-radius: var(--radius-sm);
    animation: skeleton-pulse 1.5s ease infinite;
}
@keyframes skeleton-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
.dash-chart-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-disabled);
    font-size: var(--type-body);
}
.dash-chart-brush-toggle {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}
.dash-chart-brush-toggle:hover {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.dash-chart-brush-toggle--active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-on-primary);
}
</style>
