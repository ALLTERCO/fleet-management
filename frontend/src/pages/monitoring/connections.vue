<template>
    <PageTemplate title="Connections" :tabs="monitoringTabs" back="/monitoring/activity" active-path="/monitoring/activity" fill>
        <BasicBlock darker>
            <div class="conn-stack">
                <MonitoringSectionHeader title="Active WebSocket Connections">
                    <template #actions>
                        <span class="conn-count">{{ connections.length }} active</span>
                    </template>
                </MonitoringSectionHeader>
                <DataList
                    :rows="connections"
                    :columns="connectionColumns"
                    row-key="connectionId"
                    :error-message="listError"
                    empty-message="No active connections."
                    clickable
                    @row-click="onConnectionClick"
                />
            </div>
        </BasicBlock>

        <BasicBlock v-if="inspectorError" darker>
            <div class="conn-banner">{{ inspectorError }}</div>
        </BasicBlock>

        <BasicBlock v-if="inspector" darker>
            <div class="conn-stack">
                <MonitoringSectionHeader title="Connection Inspector" />
                <dl class="inspector-meta">
                    <dt>User</dt>
                    <dd>{{ inspector.user ?? '—' }}</dd>
                    <dt>Organization</dt>
                    <dd>{{ inspector.organizationId ?? '—' }}</dd>
                    <dt>Age</dt>
                    <dd>{{ formatDuration(inspector.ageSec) }}</dd>
                    <dt>Recent events</dt>
                    <dd>{{ inspector.recentEvents.length }}</dd>
                </dl>
                <DataList
                    :rows="inspector.recentEvents"
                    :columns="eventColumns"
                    :row-key="eventKey"
                    empty-message="No event activity recorded for this connection yet."
                />
            </div>
        </BasicBlock>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    type ComputedRef,
    inject,
    onBeforeUnmount,
    onMounted,
    ref
} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import {formatDuration, formatTimeOfDay} from '@/helpers/format';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

interface ConnectionSummary {
    connectionId: string;
    user: string | null;
    organizationId: string | null;
    connectedAt: number;
    ageSec: number;
}

interface InspectorEvent {
    kind: 'rpc' | 'event' | 'patch';
    method: string;
    ts: number;
    ms: number | null;
}

interface ConnectionInspector {
    connectionId: string;
    user: string | null;
    organizationId: string | null;
    connectedAt: number;
    ageSec: number;
    recentEvents: InspectorEvent[];
}

const POLL_INTERVAL_MS = 2000;

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const connections = ref<ConnectionSummary[]>([]);
const inspector = ref<ConnectionInspector | null>(null);
const selectedId = ref<string | null>(null);
const listError = ref<string | null>(null);
const inspectorError = ref<string | null>(null);

let pollHandle: ReturnType<typeof setInterval> | null = null;

const connectionColumns: DataColumn<ConnectionSummary>[] = [
    {key: 'user', label: 'User', role: 'primary', accessor: (c) => c.user ?? '—'},
    {
        key: 'organizationId',
        label: 'Organization',
        role: 'meta',
        accessor: (c) => c.organizationId ?? '—'
    },
    {
        key: 'ageSec',
        label: 'Age',
        role: 'meta',
        align: 'right',
        mono: true,
        accessor: (c) => formatDuration(c.ageSec)
    },
    {
        key: 'connectionId',
        label: 'Connection ID',
        role: 'meta',
        mono: true,
        accessor: (c) => shortenId(c.connectionId)
    }
];

const eventColumns: DataColumn<InspectorEvent>[] = [
    {key: 'ts', label: 'Time', role: 'meta', accessor: (e) => formatTimeOfDay(e.ts)},
    {key: 'kind', label: 'Kind', role: 'meta'},
    {key: 'method', label: 'Method', role: 'primary'},
    {
        key: 'ms',
        label: 'ms',
        role: 'meta',
        align: 'right',
        mono: true,
        accessor: (e) => e.ms ?? '—'
    }
];

function eventKey(event: InspectorEvent): string {
    return `${event.ts}-${event.kind}-${event.method}-${event.ms}`;
}

function describeError(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

async function fetchConnectionList(): Promise<ConnectionSummary[]> {
    const data = await sendRPC<{connections: ConnectionSummary[]}>(
        'FLEET_MANAGER',
        'System.ListConnections',
        {}
    );
    return data.connections;
}

async function fetchInspectorSnapshot(
    connectionId: string
): Promise<ConnectionInspector> {
    return await sendRPC<ConnectionInspector>(
        'FLEET_MANAGER',
        'System.GetConnectionInspector',
        {connectionId}
    );
}

async function loadConnections(): Promise<void> {
    try {
        connections.value = await fetchConnectionList();
        listError.value = null;
    } catch (err) {
        listError.value = describeError(err);
        return;
    }
    if (selectedId.value) await loadInspector(selectedId.value);
}

async function loadInspector(connectionId: string): Promise<void> {
    try {
        inspector.value = await fetchInspectorSnapshot(connectionId);
        inspectorError.value = null;
    } catch (err) {
        inspector.value = null;
        inspectorError.value = describeError(err);
    }
}

function onConnectionClick(conn: ConnectionSummary): void {
    selectedId.value = conn.connectionId;
    void loadInspector(conn.connectionId);
}

function shortenId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

onMounted(() => {
    void loadConnections();
    pollHandle = setInterval(loadConnections, POLL_INTERVAL_MS);
});

onBeforeUnmount(() => {
    if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
    }
});
</script>

<style scoped>
.conn-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.conn-count {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.conn-banner {
    padding: var(--space-2) var(--space-3);
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
}
.inspector-meta {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
    font-size: var(--type-caption);
}
.inspector-meta dt {
    color: var(--color-text-tertiary);
}
.inspector-meta dd {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
}
</style>
