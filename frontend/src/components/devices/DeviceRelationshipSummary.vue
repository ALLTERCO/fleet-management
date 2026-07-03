<template>
    <section class="drs">
        <header class="drs__header">
            <div>
                <span class="drs__eyebrow">Relationship summary</span>
                <strong>{{ title }}</strong>
            </div>
            <button type="button" class="drs__refresh" :disabled="loading" title="Refresh" @click="loadGraph">
                <i class="fas fa-rotate-right" />
            </button>
        </header>

        <div v-if="loading" class="drs__state">
            <Spinner />
            <span>Loading relationships</span>
        </div>

        <Notification v-else-if="error" type="warning">
            {{ error }}
        </Notification>

        <template v-else-if="graph">
            <div v-if="summaryRows.length" class="drs__rows">
                <article
                    v-for="row in summaryRows"
                    :key="row.id"
                    class="drs__row"
                    :class="`drs__row--${row.tone}`"
                >
                    <i :class="row.icon" />
                    <div>
                        <span>{{ row.title }}</span>
                        <small>{{ row.detail }}</small>
                    </div>
                </article>
            </div>

            <div v-if="statusRows.length" class="drs__status">
                <div
                    v-for="summary in statusRows"
                    :key="summaryKey(summary)"
                    class="drs__status-row"
                    :class="`drs__status-row--${summary.severity}`"
                >
                    <i :class="summaryIcon(summary.severity)" />
                    <span>{{ summary.text }}</span>
                </div>
            </div>

            <p v-if="!summaryRows.length && !statusRows.length" class="drs__empty">
                No direct relationships found.
            </p>
        </template>
    </section>
</template>

<script setup lang="ts">
import {
    type DeviceRelationshipsGraph, 
    relationships
} from '@host/relationships';
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import Notification from '@/components/core/Notification.vue';
import Spinner from '@/components/core/Spinner.vue';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {onDeviceRelationshipChanged} from '@/tools/websocket';

type RelationshipEdge = DeviceRelationshipsGraph['edges'][number];
type RelationshipSummary = DeviceRelationshipsGraph['summaries'][number];

interface SummaryRow {
    id: string;
    icon: string;
    title: string;
    detail: string;
    tone: 'neutral' | 'warning' | 'critical';
}

const OPERATOR_EDGE_TYPES = new Set<RelationshipEdge['type']>([
    'binds_role_to_source',
    'source_feeds_virtual_role',
    'used_by_virtual_device',
    'extracts_from',
    'promoted_from_gateway_component',
    'transported_by_gateway',
    'heard_by_gateway',
    'uses_profile',
    'controls',
    'controlled_by'
]);

const props = defineProps<{shellyID: string}>();

const graph = ref<DeviceRelationshipsGraph | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let unsubscribeRelationshipChanged: (() => void) | null = null;

const title = computed(() => nodeLabel(graph.value?.center ?? props.shellyID));

const summaryRows = computed<SummaryRow[]>(() =>
    (graph.value?.edges ?? []).filter(isOperatorEdge).map(edgeToSummaryRow)
);

const statusRows = computed(() =>
    [...(graph.value?.summaries ?? [])].sort(summaryPriority).slice(0, 3)
);

onMounted(() => {
    unsubscribeRelationshipChanged = onDeviceRelationshipChanged((event) => {
        if (!shouldRefreshForEvent(event.params.externalId)) return;
        void loadGraph();
    });
    void loadGraph();
});

onBeforeUnmount(() => {
    unsubscribeRelationshipChanged?.();
    unsubscribeRelationshipChanged = null;
});

watch(() => props.shellyID, () => void loadGraph());

async function loadGraph(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        graph.value = await relationships.getDeviceGraph({
            shellyID: props.shellyID,
            depth: 1,
            include: [
                'components',
                'virtualBindings',
                'virtualDependents',
                'bluetooth',
                'provenance',
                'extraction',
                'health'
            ]
        });
    } catch (err) {
        graph.value = null;
        error.value = rpcErrorMessage(err);
    } finally {
        loading.value = false;
    }
}

function shouldRefreshForEvent(externalId: string | undefined): boolean {
    return externalId === undefined || externalId === props.shellyID;
}

function isOperatorEdge(edge: RelationshipEdge): boolean {
    return OPERATOR_EDGE_TYPES.has(edge.type);
}

function edgeToSummaryRow(edge: RelationshipEdge): SummaryRow {
    return {
        id: edge.id,
        icon: edgeIcon(edge),
        title: edgeTitle(edge),
        detail: `${nodeLabel(edge.source)} -> ${nodeLabel(edge.target)}`,
        tone: edgeTone(edge.status)
    };
}

function edgeTitle(edge: RelationshipEdge): string {
    const titles: Partial<Record<RelationshipEdge['type'], string>> = {
        binds_role_to_source: 'Role source',
        source_feeds_virtual_role: 'Feeds virtual role',
        used_by_virtual_device: 'Used by virtual device',
        extracts_from: 'Extracted origin',
        promoted_from_gateway_component: 'Promoted from gateway component',
        transported_by_gateway: 'Gateway transport',
        heard_by_gateway: 'Latest gateway hearing',
        uses_profile: 'Device profile',
        controls: 'Controls target',
        controlled_by: 'Controlled by source'
    };
    return titles[edge.type] ?? edge.type.replaceAll('_', ' ');
}

function edgeIcon(edge: RelationshipEdge): string {
    if (edge.type.includes('gateway') || edge.type.includes('blu')) {
        return 'fab fa-bluetooth-b';
    }
    if (edge.type.includes('profile')) return 'fas fa-id-badge';
    if (edge.type.includes('extract')) return 'fas fa-arrow-up-from-bracket';
    if (edge.type.includes('control')) return 'fas fa-sliders';
    return 'fas fa-diagram-project';
}

function edgeTone(status: RelationshipEdge['status']): SummaryRow['tone'] {
    if (status === 'critical' || status === 'offline' || status === 'unavailable') {
        return 'critical';
    }
    if (status === 'warning' || status === 'stale' || status === 'unknown') {
        return 'warning';
    }
    return 'neutral';
}

function nodeLabel(id: string): string {
    return graph.value?.nodes.find((node) => node.id === id)?.label ?? id;
}

function summaryPriority(a: RelationshipSummary, b: RelationshipSummary): number {
    return summarySeverityWeight(b.severity) - summarySeverityWeight(a.severity);
}

function summarySeverityWeight(severity: RelationshipSummary['severity']): number {
    if (severity === 'critical') return 3;
    if (severity === 'warning') return 2;
    return 1;
}

function summaryIcon(severity: RelationshipSummary['severity']): string {
    if (severity === 'critical') return 'fas fa-circle-exclamation';
    if (severity === 'warning') return 'fas fa-triangle-exclamation';
    return 'fas fa-circle-info';
}

function summaryKey(summary: RelationshipSummary): string {
    return `${summary.reasonCode ?? 'summary'}:${summary.text}`;
}
</script>

<style scoped>
.drs {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    padding: var(--space-3);
}

.drs__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}

.drs__header div {
    display: flex;
    min-width: 0;
    flex-direction: column;
}

.drs__header strong {
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.drs__eyebrow,
.drs__row small {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.drs__refresh {
    display: inline-flex;
    width: var(--space-8);
    height: var(--space-8);
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
}

.drs__refresh:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}

.drs__state,
.drs__empty {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.drs__rows,
.drs__status {
    display: grid;
    gap: var(--space-2);
}

.drs__row,
.drs__status-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
    border: 1px solid var(--color-border-muted);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    padding: var(--space-2);
}

.drs__row i {
    display: inline-flex;
    width: var(--space-8);
    height: var(--space-8);
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
}

.drs__row div {
    display: flex;
    min-width: 0;
    flex-direction: column;
}

.drs__row span,
.drs__row small,
.drs__status-row span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.drs__row span {
    color: var(--color-text-primary);
    font-weight: 600;
}

.drs__row--warning,
.drs__status-row--warning {
    border-color: color-mix(in srgb, var(--color-warning) 28%, var(--color-border-muted));
}

.drs__row--warning i,
.drs__status-row--warning i {
    color: var(--color-warning-text);
}

.drs__row--critical,
.drs__status-row--critical {
    border-color: color-mix(in srgb, var(--color-danger) 28%, var(--color-border-muted));
}

.drs__row--critical i,
.drs__status-row--critical i {
    color: var(--color-danger-text);
}

.drs__status-row {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
</style>
