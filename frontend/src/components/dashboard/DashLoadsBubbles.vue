<template>
    <div ref="rootEl" class="dlb" :aria-label="ariaLabel" role="img" />
</template>

<script setup lang="ts">
import type {EChartsOption} from 'echarts';
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import echarts from '@/tools/echarts';

export interface LoadBubble {
    readonly id: string;
    readonly label: string;
    readonly watts: number;
    readonly category?: string;
}

const props = withDefaults(
    defineProps<{
        loads: LoadBubble[];
        ariaLabel?: string;
    }>(),
    {ariaLabel: 'Current loads by power draw'}
);

const rootEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

const MIN_BUBBLE_RADIUS = 16;
const MAX_BUBBLE_RADIUS = 72;

// Structural signature — adding/removing a load triggers a full rebuild.
const structuralKey = computed(() => props.loads.map((l) => l.id).join(','));

function activeLoads(): LoadBubble[] {
    return props.loads.filter((l) => l.watts > 0);
}

function maxActiveWatts(loads: LoadBubble[]): number {
    return loads.reduce((m, l) => Math.max(m, l.watts), 0);
}

function bubbleRadius(watts: number, maxWatts: number): number {
    if (maxWatts <= 0) return MIN_BUBBLE_RADIUS;
    const ratio = Math.sqrt(Math.max(0, watts) / maxWatts);
    return MIN_BUBBLE_RADIUS + ratio * (MAX_BUBBLE_RADIUS - MIN_BUBBLE_RADIUS);
}

function buildData() {
    const active = activeLoads();
    const maxW = maxActiveWatts(active);
    return active.map((l) => ({
        id: l.id,
        name: l.label,
        symbolSize: bubbleRadius(l.watts, maxW) * 2,
        value: l.watts,
        category: l.category ?? 'load',
        label: {
            show: true,
            position: 'inside' as const,
            formatter: () => `${l.label}\n${l.watts.toFixed(0)} W`
        }
    }));
}

function buildOption(): EChartsOption {
    return {
        tooltip: {trigger: 'item', formatter: formatTooltip},
        series: [
            {
                type: 'graph',
                layout: 'force',
                roam: false,
                force: {repulsion: 220, gravity: 0.08, edgeLength: 80},
                data: buildData(),
                edges: [],
                emphasis: {focus: 'self', scale: 1.05}
            }
        ]
    };
}

function formatTooltip(p: unknown): string {
    const point = p as {name?: string; value?: number};
    return `${point.name}: ${point.value?.toFixed(0)} W`;
}

function renderFull() {
    chart?.setOption(buildOption(), {notMerge: true});
}

function renderValues() {
    chart?.setOption({series: [{data: buildData()}]});
}

function resize() {
    chart?.resize();
}

onMounted(() => {
    if (!rootEl.value) return;
    chart = echarts.init(rootEl.value, 'fleet');
    renderFull();
    window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', resize);
    chart?.dispose();
    chart = null;
});

watch(structuralKey, () => renderFull());
watch(() => props.loads, () => renderValues(), {deep: true});
</script>

<style scoped>
.dlb {
    width: 100%;
    height: 360px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
}
</style>
