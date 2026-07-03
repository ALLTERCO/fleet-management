<template>
    <CardShell
        type="ui_widget"
        :name="metricLabel + ' Heatmap'"
        :icon="metricIcon"
        :size="size"
        :edit-mode="editMode"
        @delete="$emit('delete')"
        @resize="(s: any) => $emit('resize', s)"
        @move="(d: any) => $emit('move', d)"
        @drag-start="(e: DragEvent) => $emit('drag-start', e)"
        @drag-end="(e: DragEvent) => $emit('drag-end', e)"
        @drag-over="(e: DragEvent) => $emit('drag-over', e)"
        @drag-leave="(e: DragEvent) => $emit('drag-leave', e)"
        @drop="(e: DragEvent) => $emit('drop', e)"
    >
        <div class="hm">
            <Skeleton v-if="loading" variant="card" class="hm-skeleton" />
            <p v-else-if="error" class="hm-empty">Failed to load</p>
            <p v-else-if="!grid.length" class="hm-empty">No data</p>
            <div v-else class="hm-canvas-wrap" :style="{height: canvasHeight + 'px'}">
                <canvas ref="hmCanvas" style="width:100%;height:100%" />
            </div>
            <div class="hm-footer">
                <span class="hm-label">{{ metricLabel }}</span>
                <span class="hm-range">7d</span>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, nextTick, onUnmounted, ref, watch} from 'vue';
import Skeleton from '@/components/core/Skeleton.vue';
import {useChartData} from '@/composables/useChartData';
import {useDashboardContext} from '@/composables/useDashboardContext';
import {chartColors} from '@/helpers/chartUtils';
import CardShell from './CardShell.vue';

export interface ActivityHeatmapWidgetConfig {
    id: 'activity_heatmap_widget';
    shellyId: string;
    metric: 'temperature' | 'humidity' | 'power' | 'consumption';
    days?: number;
}

const props = withDefaults(
    defineProps<{
        config: ActivityHeatmapWidgetConfig;
        size?: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {size: '2x2', editMode: false}
);

defineEmits<{
    delete: [];
    resize: [size: '1x1' | '2x1' | '2x2'];
    move: [direction: number];
    'drag-start': [e: DragEvent];
    'drag-end': [e: DragEvent];
    'drag-over': [e: DragEvent];
    'drag-leave': [e: DragEvent];
    drop: [e: DragEvent];
}>();

const METRIC_META = {
    temperature: {
        label: 'Temperature',
        icon: 'fas fa-thermometer-half',
        low: '#3b82f6',
        high: '#ef4444'
    },
    humidity: {
        label: 'Humidity',
        icon: 'fas fa-tint',
        low: '#ede9fe',
        high: '#6d28d9'
    },
    power: {
        label: 'Power',
        icon: 'fas fa-bolt',
        low: '#1e293b',
        high: '#f59e0b'
    },
    consumption: {
        label: 'Energy',
        icon: 'fas fa-bolt',
        low: '#1e293b',
        high: '#10b981'
    }
};

const metricLabel = computed(
    () => METRIC_META[props.config.metric]?.label ?? props.config.metric
);
const metricIcon = computed(
    () => METRIC_META[props.config.metric]?.icon ?? 'fas fa-chart-simple'
);

// Fetch 7d hourly data — '7d' uses hour granularity so each bucket has a real getHours() value.
// '30d' would switch to day granularity (one bucket per day, all landing on hour 0) which
// would leave 23 of 24 hour columns empty in the heatmap grid.
const {data, loading, error, refresh} = useChartData(
    computed(() => props.config.shellyId),
    computed(() => props.config.metric),
    ref('7d')
);

const dashCtx = useDashboardContext();
watch(
    () => dashCtx.value.refreshSignal.value,
    () => refresh()
);

// Fetch is hardcoded to 7d; clamp days to match so the grid never shows blank rows beyond the data window.
const days = computed(() => Math.min(props.config.days ?? 7, 7));

// Build hour-of-day × calendar-day grid from hourly data
// grid[dayIndex][hour] = avg value or null
const grid = computed(() => {
    if (!data.value.length) return [];
    const now = new Date();
    const dayMap: Map<string, number[]> = new Map();

    for (const pt of data.value) {
        const d = new Date(pt.bucket);
        if (Number.isNaN(d.getTime())) continue;
        const dayKey = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
        const hour = d.getHours();
        if (!dayMap.has(dayKey)) dayMap.set(dayKey, new Array(24).fill(null));
        dayMap.get(dayKey)![hour] = pt.value;
    }

    // Collect last `days` calendar days
    const result: Array<{day: string; hours: (number | null)[]}> = [];
    for (let i = days.value - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toLocaleDateString('en-CA');
        result.push({
            day: key,
            hours: dayMap.get(key) ?? new Array(24).fill(null)
        });
    }
    return result;
});

const canvasHeight = computed(() => (props.size === '2x2' ? 120 : 60));

const hmCanvas = ref<HTMLCanvasElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

function lerpColor(t: number, stops: {low: string; high: string}): string {
    const parse = (hex: string) => {
        const n = Number.parseInt(hex.replace('#', ''), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const [lr, lg, lb] = parse(stops.low);
    const [hr, hg, hb] = parse(stops.high);
    const r = Math.round(lr + (hr - lr) * t);
    const g = Math.round(lg + (hg - lg) * t);
    const b = Math.round(lb + (hb - lb) * t);
    return `rgb(${r},${g},${b})`;
}

function buildHeatmap() {
    if (!hmCanvas.value || !grid.value.length) return;
    const canvas = hmCanvas.value;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const numDays = grid.value.length;
    const cellW = W / 24;
    const cellH = H / numDays;

    const meta = METRIC_META[props.config.metric] ?? METRIC_META.temperature;
    const allVals = grid.value
        .flatMap((r) => r.hours)
        .filter((v) => v != null) as number[];
    const minV = allVals.length ? Math.min(...allVals) : 0;
    const maxV = allVals.length ? Math.max(...allVals) : 1;

    for (let d = 0; d < numDays; d++) {
        for (let h = 0; h < 24; h++) {
            const val = grid.value[d].hours[h];
            if (val == null) {
                ctx.fillStyle = chartColors.overlayFaint;
            } else {
                const t =
                    maxV > minV
                        ? (val - minV) / (maxV - minV)
                        : minV === 0
                          ? 0
                          : 0.5;
                ctx.fillStyle = lerpColor(t, {low: meta.low, high: meta.high});
            }
            ctx.fillRect(
                h * cellW + 0.5,
                d * cellH + 0.5,
                cellW - 1,
                cellH - 1
            );
        }
    }
}

watch(
    () => grid.value,
    async () => {
        if (grid.value.length) {
            await nextTick();
            buildHeatmap();
        }
    },
    {immediate: true}
);

// Watch the canvas ref — it is null until the v-else branch mounts (data loaded).
// Attaching the ResizeObserver here guarantees the element is in the DOM.
watch(hmCanvas, (canvas) => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (canvas?.parentElement) {
        resizeObserver = new ResizeObserver(() => buildHeatmap());
        resizeObserver.observe(canvas.parentElement);
    }
});

onUnmounted(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (hmCanvas.value) {
        const ctx = hmCanvas.value.getContext('2d');
        ctx?.clearRect(0, 0, hmCanvas.value.width, hmCanvas.value.height);
    }
});
</script>

<style scoped>
.hm {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    height: 100%;
    min-height: 0;
}

.hm-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    margin: 0;
}

.hm-canvas-wrap {
    flex-shrink: 0;
}

.hm-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
}

.hm-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

.hm-range {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
