<template>
    <CardShell
        type="ui_widget"
        name="Top Consumers"
        icon="fas fa-ranking-star"
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
        <div class="tc">
            <div class="tc-header">
                <ChartRangeTabs v-model="range" accent-color="#f59e0b" />
            </div>
            <div v-if="loading" class="tc-list">
                <Skeleton v-for="n in 4" :key="n" variant="row" />
            </div>
            <div v-else-if="!ranked.length" class="tc-empty">No data</div>
            <div v-else class="tc-list">
                <div v-for="(item, i) in ranked" :key="item.entityId" class="tc-row">
                    <span class="tc-rank">{{ i + 1 }}</span>
                    <span class="tc-name" :title="item.name">{{ item.name }}</span>
                    <div class="tc-bar-wrap">
                        <div
                            class="tc-bar"
                            :style="{width: item.pct + '%'}"
                        />
                    </div>
                    <span class="tc-value">{{ item.displayValue }}</span>
                </div>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, onScopeDispose, ref, watch} from 'vue';
import Skeleton from '@/components/core/Skeleton.vue';
import type {ChartRange} from '@/composables/useChartData';
import {rangeToParams} from '@/composables/useChartData';
import {useDashboardContext} from '@/composables/useDashboardContext';
import {useEntityStore} from '@/stores/entities';
import * as ws from '@/tools/websocket';
import CardShell from './CardShell.vue';
import ChartRangeTabs from './ChartRangeTabs.vue';

export interface TopConsumersWidgetConfig {
    id: 'top_consumers_widget';
    entityIds: string[];
    range?: ChartRange;
    limit?: number;
}

const props = withDefaults(
    defineProps<{
        config: TopConsumersWidgetConfig;
        size?: '1x1' | '2x1' | '2x2';
        editMode?: boolean;
    }>(),
    {size: '2x1', editMode: false}
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
const range = ref<ChartRange>(props.config.range ?? '24h');
const limit = props.config.limit ?? 10;

const loading = ref(false);
const totalsByShelly = ref<Map<string, number>>(new Map());
let abortId = 0;
let disposed = false;
onScopeDispose(() => {
    disposed = true;
});

// One grouped energy.query for every entity's device source — replaces the
// per-entity fan-out. perDevice=true tags each row with its shellyID.
async function fetchTotals() {
    const sources = [
        ...new Set(
            (props.config.entityIds ?? [])
                .slice(0, limit)
                .map((eid) => (entityStore.entities[eid] as any)?.source)
                .filter((s): s is string => typeof s === 'string')
        )
    ];
    if (!sources.length) {
        // Bump so any in-flight fetch is invalidated and cannot repopulate.
        abortId++;
        totalsByShelly.value = new Map();
        loading.value = false;
        return;
    }
    const id = ++abortId;
    loading.value = true;
    const {from, to, bucket} = rangeToParams(range.value);
    try {
        const res = await ws.sendRPC<{
            items?: Array<{shellyID?: string | null; value: number}>;
        }>('FLEET_MANAGER', 'energy.query', {
            from,
            to,
            tags: ['total_act_energy'],
            bucket,
            devices: sources,
            perDevice: true
        });
        if (disposed || id !== abortId) return;
        const totals = new Map<string, number>();
        for (const row of res.items ?? []) {
            if (typeof row.shellyID !== 'string') continue;
            totals.set(
                row.shellyID,
                (totals.get(row.shellyID) ?? 0) + (Number(row.value) || 0)
            );
        }
        totalsByShelly.value = totals;
    } catch {
        if (disposed || id !== abortId) return;
        totalsByShelly.value = new Map();
    } finally {
        if (!disposed && id === abortId) loading.value = false;
    }
}

watch(range, fetchTotals, {immediate: true});

// Entity sources populate after the card mounts on a cold dashboard load;
// re-fetch when they land so the card doesn't sit on "No data".
watch(
    () =>
        (props.config.entityIds ?? [])
            .slice(0, limit)
            .map((eid) => (entityStore.entities[eid] as any)?.source)
            .join(','),
    fetchTotals
);

const dashCtx = useDashboardContext();
watch(
    () => dashCtx.value.refreshSignal.value,
    () => fetchTotals()
);

const ranked = computed(() => {
    const items = (props.config.entityIds ?? [])
        .slice(0, limit)
        .map((eid) => {
            const entity = entityStore.entities[eid] as any;
            const name = entity?.name || entity?.properties?.name || eid;
            const total = totalsByShelly.value.get(entity?.source) ?? 0;
            return {entityId: eid, name, total};
        });

    const sorted = items
        .filter((it) => it.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);

    const maxTotal = sorted[0]?.total || 1;
    return sorted.map((it) => ({
        ...it,
        pct: Math.round((it.total / maxTotal) * 100),
        displayValue:
            it.total >= 1000
                ? `${(it.total / 1000).toFixed(2)} kWh`
                : `${it.total.toFixed(1)} Wh`
    }));
});
</script>

<style scoped>
.tc {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    height: 100%;
    min-height: 0;
}

.tc-header {
    flex-shrink: 0;
}

.tc-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.tc-list {
    flex: 1;
    overflow: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.tc-row {
    display: grid;
    grid-template-columns: 16px 1fr 60px 52px;
    align-items: center;
    gap: var(--space-1);
}

.tc-rank {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-tertiary);
    text-align: right;
}

.tc-name {
    font-size: var(--type-body);
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.tc-bar-wrap {
    height: 4px;
    background: var(--state-hover-bg-strong);
    border-radius: var(--radius-xs);
    overflow: hidden;
}

.tc-bar {
    height: 100%;
    background: var(--color-warning-text);
    border-radius: var(--radius-xs);
    transition: width 0.3s ease;
}

.tc-value {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-align: right;
    white-space: nowrap;
}
</style>
