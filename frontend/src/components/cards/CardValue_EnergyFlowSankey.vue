<template>
    <CardShell
        type="ui_widget"
        name="Energy Flow"
        icon="fas fa-circle-nodes"
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
        <div class="efs">
            <div v-if="!config.sources?.length && !config.loads?.length" class="efs-empty">
                No entities configured
            </div>
            <div v-else class="efs-diagram">
                <!-- Sources column -->
                <div class="efs-col efs-col--sources">
                    <div
                        v-for="src in sourcesWithPower"
                        :key="src.entityId"
                        class="efs-node"
                    >
                        <div class="efs-node-bar" :style="{background: src.color || '#10b981', height: nodeHeight(src.power, maxPower) + 'px'}" />
                        <span class="efs-node-label">{{ src.label }}</span>
                        <span v-if="config.showValues" class="efs-node-val">{{ fmtW(src.power) }}</span>
                    </div>
                </div>

                <!-- Flow SVG -->
                <svg class="efs-flow-svg" :viewBox="`0 0 40 ${svgH}`" preserveAspectRatio="none">
                    <defs>
                        <linearGradient
                            v-for="(flow, i) in flows"
                            :id="`efs-grad-${uid}-${i}`"
                            :key="i"
                            x1="0" y1="0" x2="1" y2="0"
                        >
                            <stop offset="0%" :stop-color="flow.srcColor" stop-opacity="0.7" />
                            <stop offset="100%" :stop-color="flow.dstColor" stop-opacity="0.7" />
                        </linearGradient>
                    </defs>
                    <path
                        v-for="(flow, i) in flows"
                        :key="i"
                        :d="flow.d"
                        :fill="`url(#efs-grad-${uid}-${i})`"
                        stroke="none"
                        opacity="0.7"
                    />
                </svg>

                <!-- Loads column -->
                <div class="efs-col efs-col--loads">
                    <div
                        v-for="ld in loadsWithPower"
                        :key="ld.entityId"
                        class="efs-node efs-node--load"
                    >
                        <div class="efs-node-bar" :style="{background: ld.color || '#f59e0b', height: nodeHeight(ld.power, maxPower) + 'px'}" />
                        <span class="efs-node-label">{{ ld.label }}</span>
                        <span v-if="config.showValues" class="efs-node-val">{{ fmtW(ld.power) }}</span>
                    </div>
                </div>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, getCurrentInstance} from 'vue';
import {useEntityStore} from '@/stores/entities';
import CardShell from './CardShell.vue';

export interface EnergyFlowEntry {
    entityId: string;
    label: string;
    color?: string;
}

export interface EnergyFlowSankeyWidgetConfig {
    id: 'energy_flow_sankey_widget';
    sources: EnergyFlowEntry[];
    loads: EnergyFlowEntry[];
    showValues: boolean;
}

const props = withDefaults(
    defineProps<{
        config: EnergyFlowSankeyWidgetConfig;
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

const entityStore = useEntityStore();
// Unique prefix per instance so SVG gradient IDs don't collide when multiple Sankey widgets coexist
const uid = getCurrentInstance()?.uid ?? Math.random().toString(36).slice(2);

function getLivePower(entityId: string): number {
    const entity = entityStore.entities[entityId] as any;
    if (!entity?.status) return 0;
    // Try common power fields; clamp to 0 — negative values (e.g. battery charging, grid export)
    // would produce negative SVG heights and broken arc geometry.
    const s = entity.status;
    return Math.max(
        0,
        +(s.apower ?? s.power ?? s.act_power ?? s.total_act_power ?? 0)
    );
}

const sourcesWithPower = computed(() =>
    (props.config.sources ?? []).map((s) => ({
        ...s,
        power: getLivePower(s.entityId)
    }))
);

const loadsWithPower = computed(() =>
    (props.config.loads ?? []).map((l) => ({
        ...l,
        power: getLivePower(l.entityId)
    }))
);

const maxPower = computed(() => {
    const all = [
        ...sourcesWithPower.value.map((s) => s.power),
        ...loadsWithPower.value.map((l) => l.power)
    ];
    return Math.max(...all, 1);
});

const NODE_MAX_H = 40;
const NODE_MIN_H = 4;

function nodeHeight(power: number, max: number): number {
    if (max <= 0) return NODE_MIN_H;
    return Math.max(NODE_MIN_H, Math.round((power / max) * NODE_MAX_H));
}

const svgH = 60;

// Build simple bezier flows between source midpoints and load midpoints
const flows = computed(() => {
    const srcs = sourcesWithPower.value;
    const lds = loadsWithPower.value;
    if (!srcs.length || !lds.length) return [];

    const totalSrcPower = srcs.reduce((s, e) => s + e.power, 0) || 1;
    const totalLdPower = lds.reduce((s, e) => s + e.power, 0) || 1;

    const result: {d: string; srcColor: string; dstColor: string}[] = [];

    // Pre-calculate each load's fixed Y position so all sources draw flows to
    // the same load bands. Without this, resetting ldY per source causes every
    // source's flows to overlap at the top of the load column.
    const loadPositions: {y: number; h: number}[] = [];
    let ldY = 2;
    for (const ld of lds) {
        const ldH = Math.max(2, (ld.power / totalLdPower) * (svgH - 4));
        loadPositions.push({y: ldY, h: ldH});
        ldY += ldH + 2;
    }

    let srcY = 2;

    for (const src of srcs) {
        const srcH = Math.max(2, (src.power / totalSrcPower) * (svgH - 4));
        const srcMid = srcY + srcH / 2;

        for (let li = 0; li < lds.length; li++) {
            const ld = lds[li];
            const {y: ldYPos, h: ldH} = loadPositions[li];
            const ldMid = ldYPos + ldH / 2;
            const flowH = Math.max(1, Math.min(srcH, ldH) * 0.6);

            const y1 = srcMid - flowH / 2;
            const y2 = ldMid - flowH / 2;

            result.push({
                d: `M 0 ${y1} C 20 ${y1}, 20 ${y2}, 40 ${y2} L 40 ${y2 + flowH} C 20 ${y2 + flowH}, 20 ${y1 + flowH}, 0 ${y1 + flowH} Z`,
                srcColor: src.color || '#10b981',
                dstColor: ld.color || '#f59e0b'
            });
        }
        srcY += srcH + 2;
    }

    return result;
});

function fmtW(w: number): string {
    if (w >= 1000) return `${(w / 1000).toFixed(1)} kW`;
    return `${Math.round(w)} W`;
}
</script>

<style scoped>
.efs {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
}

.efs-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.efs-diagram {
    display: grid;
    grid-template-columns: 1fr 40px 1fr;
    gap: 0;
    width: 100%;
    height: 100%;
    align-items: center;
}

.efs-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-1) 0;
}

.efs-col--loads {
    align-items: flex-start;
}

.efs-node {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.efs-node--load {
    flex-direction: row-reverse;
    justify-content: flex-end;
}

.efs-node-bar {
    width: 6px;
    min-height: 4px;
    border-radius: var(--radius-xs);
    flex-shrink: 0;
}

.efs-node-label {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 60px;
}

.efs-node-val {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
}

.efs-flow-svg {
    width: 40px;
    height: 100%;
}
</style>
