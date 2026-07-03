<template>
    <div ref="container" class="sankey-chart" />
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useEChart} from '@/composables/useEChart';

export interface SankeyNode {
    readonly name: string;
}

export interface SankeyLink {
    readonly source: string;
    readonly target: string;
    readonly value: number;
}

const props = defineProps<{
    nodes: readonly SankeyNode[];
    links: readonly SankeyLink[];
    title?: string;
    unit?: string;
}>();

const container = ref<HTMLElement | null>(null);

const option = computed(() => ({
    title: props.title ? {text: props.title, left: 'left'} : undefined,
    tooltip: {
        trigger: 'item' as const,
        formatter: (params: {
            data?: {value?: number};
            dataType?: string;
            name?: string;
        }) => {
            if (params.dataType === 'edge' && params.data?.value !== undefined) {
                return `${params.name}: ${formatValue(params.data.value)}`;
            }
            return params.name ?? '';
        }
    },
    series: [
        {
            type: 'sankey',
            nodeAlign: 'left',
            data: props.nodes.map((n) => ({name: n.name})),
            links: props.links.map((l) => ({
                source: l.source,
                target: l.target,
                value: l.value
            })),
            emphasis: {focus: 'adjacency'},
            lineStyle: {color: 'gradient', curveness: 0.5}
        }
    ]
}));

function formatValue(value: number): string {
    return `${value.toFixed(2)}${props.unit ? ' ' + props.unit : ''}`;
}

useEChart(container, option);
</script>

<style scoped>
.sankey-chart {
    width: 100%;
    min-height: 320px;
}
</style>
