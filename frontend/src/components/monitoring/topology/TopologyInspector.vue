<template>
    <aside class="topology-inspector" aria-label="Topology inspector">
        <header class="inspector-header">
            <div>
                <p class="eyebrow">Inspector</p>
                <h3 class="title">{{ title }}</h3>
            </div>
            <button
                v-if="selected"
                type="button"
                class="clear-btn"
                aria-label="Clear topology selection"
                @click="emit('clear')"
            >
                Clear
            </button>
        </header>

        <div v-if="node" class="section-stack">
            <section class="section">
                <div class="status-line">
                    <span class="status-dot" :class="`status-${node.status}`" />
                    <span>{{ node.status }}</span>
                </div>
                <p v-if="node.description" class="muted">{{ node.description }}</p>
            </section>

            <section class="section">
                <h4>Connections</h4>
                <div class="split">
                    <div>
                        <span class="mini-label">Upstream</span>
                        <strong>{{ upstream.length }}</strong>
                    </div>
                    <div>
                        <span class="mini-label">Downstream</span>
                        <strong>{{ downstream.length }}</strong>
                    </div>
                </div>
                <ul v-if="connectedLabels.length > 0" class="link-list">
                    <li v-for="label in connectedLabels" :key="label">{{ label }}</li>
                </ul>
            </section>

            <section class="section">
                <h4>Identity</h4>
                <dl class="stat-list">
                    <template v-for="row in nodeMetadataRows" :key="row.key">
                        <dt>{{ row.key }}</dt>
                        <dd>{{ row.value }}</dd>
                    </template>
                </dl>
            </section>

            <section class="section">
                <h4>Stats</h4>
                <dl v-if="statRows.length > 0" class="stat-list">
                    <template v-for="row in statRows" :key="row.key">
                        <dt>{{ row.key }}</dt>
                        <dd>{{ row.value }}</dd>
                    </template>
                </dl>
                <p v-else class="muted">No module stats available.</p>
            </section>

            <router-link
                v-if="node.route"
                class="open-link"
                :to="node.route"
            >
                Open module page
            </router-link>
            <button
                type="button"
                class="open-link"
                @click="emit('openNodeHistory')"
            >
                Open history and logs
            </button>
            <section class="section">
                <h4>Links</h4>
                <ul class="link-list">
                    <li v-for="link in nodeLinks" :key="link.to">
                        <router-link :to="link.to">{{ link.label }}</router-link>
                    </li>
                </ul>
            </section>
        </div>

        <div v-else-if="edge" class="section-stack">
            <section class="section">
                <div class="status-line">
                    <span class="status-dot" :class="`status-${edge.status}`" />
                    <span>{{ edge.status }}</span>
                </div>
                <p class="muted">{{ edge.from }} -> {{ edge.to }}</p>
            </section>

            <section class="section">
                <h4>Traffic</h4>
                <div class="split">
                    <div>
                        <span class="mini-label">Current</span>
                        <strong>{{ edge.throughput }}/min</strong>
                    </div>
                    <div>
                        <span class="mini-label">Counter</span>
                        <strong>{{ edge.counterName ?? 'none' }}</strong>
                    </div>
                </div>
                <dl v-if="edgeStats.length > 0" class="stat-list">
                    <template v-for="row in edgeStats" :key="row.key">
                        <dt>{{ row.key }}</dt>
                        <dd>{{ row.value }}</dd>
                    </template>
                </dl>
            </section>

            <section class="section">
                <h4>Contract</h4>
                <dl class="stat-list">
                    <template v-for="row in edgeMetadataRows" :key="row.key">
                        <dt>{{ row.key }}</dt>
                        <dd>{{ row.value }}</dd>
                    </template>
                </dl>
            </section>

            <section class="section">
                <h4>Links</h4>
                <ul class="link-list">
                    <li v-for="link in edgeLinks" :key="link.to">
                        <router-link :to="link.to">{{ link.label }}</router-link>
                    </li>
                </ul>
            </section>
        </div>

        <div v-else class="empty-state">
            <p>Select a module or connection to inspect health, traffic, and links.</p>
        </div>
    </aside>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {redactMonitoringField} from '@/helpers/monitoringRedaction';
import type {
    TopologyEdge,
    TopologyFlowId,
    TopologyNode
} from '@/types/topology';

const props = defineProps<{
    node: TopologyNode | null;
    edge: TopologyEdge | null;
    edges: readonly TopologyEdge[];
    edgeHistory?: readonly number[];
}>();
const emit = defineEmits<{
    clear: [];
    openNodeHistory: [];
}>();

const selected = computed(() => props.node !== null || props.edge !== null);
const title = computed(() => props.node?.label ?? props.edge?.id ?? 'Nothing selected');

const upstream = computed(() =>
    props.node ? props.edges.filter((edge) => edge.to === props.node?.id) : []
);
const downstream = computed(() =>
    props.node ? props.edges.filter((edge) => edge.from === props.node?.id) : []
);
const connectedLabels = computed(() =>
    [...upstream.value, ...downstream.value]
        .slice(0, 8)
        .map((edge) => `${edge.from} -> ${edge.to}`)
);

const statRows = computed(() =>
    Object.entries(props.node?.stats ?? {})
        .slice(0, 12)
        .map(([key, value]) => ({
            key,
            value: formatValue(redactMonitoringField(key, value))
        }))
);

const nodeMetadataRows = computed(() => {
    if (!props.node) return [];
    return compactRows([
        {key: 'zone', value: props.node.zone},
        {key: 'kind', value: props.node.kind},
        {key: 'criticality', value: props.node.criticality},
        {key: 'owner', value: props.node.owner},
        {key: 'stale', value: props.node.stale},
        {key: 'noisy', value: props.node.noisy},
        {key: 'collapse default', value: props.node.collapseByDefault},
        {key: 'external system', value: props.node.externalSystem},
        {key: 'data classes', value: props.node.dataClasses?.join(', ')},
        {key: 'flows', value: props.node.participatesIn?.join(', ')}
    ]);
});

const edgeMetadataRows = computed(() => {
    if (!props.edge) return [];
    return compactRows([
        {key: 'kind', value: props.edge.kind},
        {key: 'criticality', value: props.edge.criticality},
        {key: 'declared', value: props.edge.declared},
        {key: 'observed', value: props.edge.observed},
        {key: 'stale', value: props.edge.stale},
        {key: 'flows', value: props.edge.participatesIn?.join(', ')},
        {key: 'latency metric', value: props.edge.latencyMetric},
        {key: 'error metric', value: props.edge.errorMetric},
        {key: 'throughput metric', value: props.edge.throughputMetric},
        {key: 'last seen', value: formatTimestamp(props.edge.lastSeenAt ?? null)},
        {key: 'description', value: props.edge.description}
    ]);
});

const nodeLinks = computed(() => {
    if (!props.node) return [];
    const links = [
        {label: 'Runtime', to: '/monitoring/runtime'},
        {label: 'Resources', to: '/monitoring/resources'},
        {label: 'Activity', to: '/monitoring/activity'},
        {label: 'Investigate', to: '/monitoring/investigate'},
        {label: 'Logs', to: '/monitoring/logs'},
        {label: 'Grafana', to: '/graphs'}
    ];
    if (props.node.route) links.unshift({label: 'Module page', to: props.node.route});
    if (props.node.zone === 'auth_security' || hasFlow(props.node, 'audit_write')) {
        links.push({label: 'Audit', to: '/monitoring/audit-log'});
    }
    return dedupeLinks(links);
});

const edgeLinks = computed(() => {
    if (!props.edge) return [];
    const links = [
        {label: 'Investigate', to: '/monitoring/investigate'},
        {label: 'Logs', to: '/monitoring/logs'},
        {label: 'Grafana', to: '/graphs'}
    ];
    if (props.edge.kind === 'storage') links.unshift({label: 'Resources', to: '/monitoring/resources'});
    if (props.edge.kind === 'auth') links.unshift({label: 'Audit', to: '/monitoring/audit-log'});
    if (props.edge.kind === 'deploy') links.unshift({label: 'Runtime', to: '/monitoring/runtime'});
    return dedupeLinks(links);
});

const edgeStats = computed(() => {
    const history = props.edgeHistory ?? [];
    if (history.length === 0) return [];
    const total = history.reduce((sum, value) => sum + value, 0);
    return [
        {key: 'samples', value: String(history.length)},
        {key: 'avg', value: (total / history.length).toFixed(1)},
        {key: 'max', value: String(Math.max(...history))}
    ];
});

function formatValue(value: unknown): string {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

function compactRows(
    rows: ReadonlyArray<{key: string; value: unknown}>
): Array<{key: string; value: string}> {
    return rows
        .filter((row) => row.value !== undefined && row.value !== null && row.value !== '')
        .map((row) => ({key: row.key, value: formatValue(row.value)}));
}

function formatTimestamp(value: number | null): string | null {
    if (value === null) return null;
    return new Date(value).toLocaleString();
}

function hasFlow(node: TopologyNode, flow: TopologyFlowId): boolean {
    return node.participatesIn?.includes(flow) ?? false;
}

function dedupeLinks(
    links: ReadonlyArray<{label: string; to: string}>
): Array<{label: string; to: string}> {
    const seen = new Set<string>();
    return links.filter((link) => {
        if (seen.has(link.to)) return false;
        seen.add(link.to);
        return true;
    });
}
</script>

<style scoped>
.topology-inspector {
    min-width: 260px;
    max-width: 320px;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-surface-1) 92%, transparent);
    box-shadow: var(--shadow-lg);
}
.inspector-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
}
.eyebrow,
.mini-label {
    margin: 0;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-tertiary);
}
.title {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-primary);
}
.clear-btn,
.open-link {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-primary);
}
.section-stack {
    display: grid;
    gap: var(--space-3);
}
.section {
    display: grid;
    gap: var(--space-2);
}
.section h4 {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.status-line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-transform: capitalize;
    color: var(--color-text-secondary);
}
.status-dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    background: var(--color-text-quaternary);
}
.status-healthy { background: var(--color-success); }
.status-warning { background: var(--color-warning); }
.status-critical { background: var(--color-danger); }
.status-unknown { background: var(--color-text-quaternary); }
.muted,
.empty-state {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    line-height: var(--leading-normal);
}
.split {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
}
.split > div {
    display: grid;
    gap: var(--space-0-5);
    min-width: 0;
}
.split strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--type-caption);
    color: var(--color-text-primary);
}
.link-list {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.link-list a {
    color: var(--color-primary);
    font-weight: var(--font-bold);
}
.stat-list {
    display: grid;
    grid-template-columns: minmax(72px, auto) minmax(0, 1fr);
    gap: var(--space-1) var(--space-2);
    margin: 0;
    font-size: var(--type-caption);
}
.stat-list dt {
    color: var(--color-text-tertiary);
}
.stat-list dd {
    margin: 0;
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    /* Wrap long values so they don't crush the key column. */
    overflow-wrap: anywhere;
    min-width: 0;
}
.open-link {
    justify-self: start;
}
@media (max-width: 960px) {
    .topology-inspector {
        max-width: none;
        width: 100%;
    }
}
</style>
