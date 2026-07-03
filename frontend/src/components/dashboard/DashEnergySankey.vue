<template>
    <div ref="rootEl" class="des" :aria-label="ariaLabel" role="img" />
</template>

<script setup lang="ts">
import type {EChartsOption} from 'echarts';
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import echarts from '@/tools/echarts';

export interface SankeyNode {
    readonly id: string;
    readonly label: string;
    readonly color?: string;
}

export interface SankeyEdge {
    readonly from: string;
    readonly to: string;
    readonly value: number;
}

interface NormalisedLink {
    source: string;
    target: string;
    value: number;
}

const props = withDefaults(
    defineProps<{
        nodes: SankeyNode[];
        edges: SankeyEdge[];
        unit?: string;
        ariaLabel?: string;
    }>(),
    {unit: 'kWh', ariaLabel: 'Cumulative energy flow'}
);

const rootEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

// Track structural signature so we know when to fully replace vs merge.
const structuralKey = computed(() =>
    [
        ...props.nodes.map((n) => n.id),
        '|',
        ...props.edges.map((e) => `${e.from}>${e.to}`)
    ].join(',')
);

function normaliseEdge(edge: SankeyEdge): NormalisedLink | null {
    if (!Number.isFinite(edge.value) || edge.value === 0) return null;
    if (edge.value > 0) {
        return {source: edge.from, target: edge.to, value: edge.value};
    }
    // Negative = reverse flow (e.g. export to grid). Flip + abs.
    return {source: edge.to, target: edge.from, value: -edge.value};
}

function buildLinks(): NormalisedLink[] {
    const out: NormalisedLink[] = [];
    for (const e of props.edges) {
        const link = normaliseEdge(e);
        if (link) out.push(link);
    }
    return out;
}

function buildNodes() {
    return props.nodes.map((n) => ({
        name: n.id,
        itemStyle: n.color ? {color: n.color} : undefined,
        label: {formatter: n.label}
    }));
}

function buildOption(): EChartsOption {
    return {
        tooltip: {trigger: 'item', formatter: formatTooltip},
        series: [
            {
                type: 'sankey',
                emphasis: {focus: 'adjacency'},
                lineStyle: {color: 'gradient', curveness: 0.5},
                nodeGap: 16,
                nodeWidth: 18,
                data: buildNodes(),
                links: buildLinks()
            }
        ]
    };
}

function formatTooltip(p: unknown): string {
    const point = p as {
        dataType?: string;
        data?: {source?: string; target?: string; value?: number};
        name?: string;
    };
    if (point.dataType === 'edge') {
        const v = point.data?.value?.toFixed(2);
        return `${point.data?.source} → ${point.data?.target}: ${v} ${props.unit}`;
    }
    return point.name ?? '';
}

function renderFull() {
    chart?.setOption(buildOption(), {notMerge: true});
}

function renderValues() {
    chart?.setOption({series: [{links: buildLinks()}]});
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

// Structural change → full replace; pure value change → merge (no flicker).
watch(structuralKey, () => renderFull());
watch(() => props.edges, () => renderValues(), {deep: true});
</script>

<style scoped>
.des {
    width: 100%;
    height: 280px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
}
</style>
