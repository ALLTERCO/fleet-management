<template>
    <div class="lh-wrap">
        <div ref="hostRef" class="lh" />
        <div v-if="isEmpty" class="lh-empty">
            <i class="fas fa-circle-nodes" />
            <p>No location hierarchy to display.</p>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {Location as ApiLocation} from '@api/location';
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {chartColors} from '@/helpers/chartUtils';
import echarts from '@/tools/echarts';

// Sunburst of the full location tree. Click a slice → emit id.

interface SunburstNode {
    name: string;
    id?: number;
    value?: number;
    children?: SunburstNode[];
}

const props = defineProps<{
    locations: ApiLocation[];
}>();

const emit = defineEmits<{
    select: [id: number];
}>();

const hostRef = ref<HTMLElement | null>(null);
const chart = ref<echarts.ECharts | null>(null);
const resizeObserver = ref<ResizeObserver | null>(null);

const isEmpty = computed(() => props.locations.length === 0);

function buildTree(locs: ApiLocation[]): SunburstNode[] {
    const childrenByParent = new Map<number | null, ApiLocation[]>();
    for (const l of locs) {
        const key = l.parentLocationId ?? null;
        if (!childrenByParent.has(key)) childrenByParent.set(key, []);
        childrenByParent.get(key)?.push(l);
    }
    // Visited guard: data corruption (A→B→A) would otherwise overflow.
    const visited = new Set<number>();
    const toNode = (loc: ApiLocation): SunburstNode => {
        if (visited.has(loc.id)) return {name: loc.name, id: loc.id, value: 1};
        visited.add(loc.id);
        const kids = childrenByParent.get(loc.id) ?? [];
        const node: SunburstNode = {name: loc.name, id: loc.id};
        if (kids.length > 0) node.children = kids.map(toNode);
        else node.value = 1;
        return node;
    };
    return (childrenByParent.get(null) ?? []).map(toNode);
}

function render() {
    const c = chart.value;
    if (!c) return;
    if (isEmpty.value) {
        c.clear();
        return;
    }
    c.setOption(
        {
            tooltip: {trigger: 'item', formatter: (info: {name: string}) => info.name},
            series: [
                {
                    type: 'sunburst',
                    data: buildTree(props.locations),
                    radius: ['12%', '95%'],
                    sort: undefined,
                    emphasis: {focus: 'ancestor'},
                    label: {
                        color: chartColors.textPrimary,
                        fontSize: 11,
                        minAngle: 6,
                        rotate: 'tangential'
                    },
                    itemStyle: {
                        borderColor: chartColors.tooltipBg,
                        borderWidth: 1
                    },
                    levels: [
                        {},
                        {r0: '12%', r: '38%', itemStyle: {color: chartColors.primary}, label: {fontWeight: 'bold'}},
                        {r0: '38%', r: '62%', itemStyle: {color: chartColors.info}},
                        {r0: '62%', r: '82%', itemStyle: {color: chartColors.success}},
                        {
                            r0: '82%',
                            r: '95%',
                            itemStyle: {color: chartColors.warning},
                            label: {position: 'outside', rotate: 'tangential'}
                        }
                    ]
                }
            ]
        },
        {notMerge: true}
    );
}

onMounted(() => {
    if (!hostRef.value) return;
    chart.value = echarts.init(hostRef.value, 'fleet');
    chart.value.on('click', (params) => {
        const id = (params as {data?: {id?: number}}).data?.id;
        if (typeof id === 'number') emit('select', id);
    });
    resizeObserver.value = new ResizeObserver(() => chart.value?.resize());
    resizeObserver.value.observe(hostRef.value);
    render();
});

watch(() => props.locations, render, {deep: false});

onBeforeUnmount(() => {
    resizeObserver.value?.disconnect();
    resizeObserver.value = null;
    chart.value?.dispose();
    chart.value = null;
});
</script>

<style scoped>
.lh-wrap {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 320px;
}
.lh {
    width: 100%;
    height: 100%;
}
.lh-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    text-align: center;
    pointer-events: none;
}
.lh-empty i {
    font-size: var(--type-heading);
    color: var(--color-text-quaternary);
}
.lh-empty p {
    margin: 0;
    font-size: var(--type-body);
}
</style>
