<template>
    <div v-if="lastError" class="recent-error" role="alert">
        {{ lastError }}
    </div>
    <div v-else-if="hasChanges" class="recent-changes" aria-label="Recent topology changes">
        <span class="recent-label">Recent changes</span>
        <ul class="recent-list">
            <li
                v-for="change in nodeMembershipChanges"
                :key="`node-membership-${change.id}-${change.change}`"
                class="recent-item"
                :class="change.change === 'appeared' ? 'is-appeared' : 'is-disappeared'"
            >
                <span class="recent-id">{{ change.id }}</span>
                <span class="recent-detail">module {{ change.change }}</span>
            </li>
            <li
                v-for="change in edgeMembershipChanges"
                :key="`edge-membership-${change.id}-${change.change}`"
                class="recent-item"
                :class="change.change === 'appeared' ? 'is-appeared' : 'is-disappeared'"
            >
                <span class="recent-id">{{ change.id }}</span>
                <span class="recent-detail">edge {{ change.change }}</span>
            </li>
            <li
                v-for="change in runtimeContainerChanges"
                :key="`runtime-container-${change.kind}`"
                class="recent-item"
                :class="severityClassFor(change.severity)"
            >
                <span class="recent-id">{{ change.count }}</span>
                <span class="recent-detail">{{ change.label }}</span>
            </li>
            <li
                v-for="change in nodeChanges"
                :key="`node-${change.id}`"
                class="recent-item"
                :class="severityClassFor(change.statusAfter)"
            >
                <span class="recent-id">{{ change.id }}</span>
                <span class="recent-detail">
                    {{ change.statusBefore }} → {{ change.statusAfter }}
                </span>
            </li>
            <li
                v-for="change in edgeChanges"
                :key="`edge-${change.id}`"
                class="recent-item"
            >
                <span class="recent-id">{{ change.id }}</span>
                <span class="recent-detail">
                    {{ formatPct(change.pctChange) }}
                </span>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {buildRuntimeContractView} from '@/helpers/monitoringRuntime';
import {loadDeployManifestPayload} from '@/helpers/monitoringRuntimeClient';
import {sendRPC} from '@/tools/websocket';

interface ChangedEdge {
    id: string;
    previousThroughput: number;
    currentThroughput: number;
    pctChange: number;
}

interface ChangedNode {
    id: string;
    statusBefore: string;
    statusAfter: string;
}

interface NodeMembershipChange {
    id: string;
    change: 'appeared' | 'disappeared';
    status: string;
}

interface EdgeMembershipChange {
    id: string;
    change: 'appeared' | 'disappeared';
    from: string;
    to: string;
}

interface RuntimeContainerChange {
    kind: 'missing' | 'unexpected' | 'unknown-owner';
    count: number;
    label: string;
    severity: 'critical' | 'warning';
}

interface TopologyDiff {
    schemaVersion: number;
    windowMin: number;
    changedEdges: ChangedEdge[];
    changedNodes: ChangedNode[];
    nodeMembershipChanges?: NodeMembershipChange[];
    edgeMembershipChanges?: EdgeMembershipChange[];
}

const POLL_INTERVAL_MS = 10_000;
const ITEM_LIMIT = 5;

const edgeChanges = ref<ChangedEdge[]>([]);
const nodeChanges = ref<ChangedNode[]>([]);
const edgeMembershipChanges = ref<EdgeMembershipChange[]>([]);
const nodeMembershipChanges = ref<NodeMembershipChange[]>([]);
const runtimeContainerChanges = ref<RuntimeContainerChange[]>([]);
const lastError = ref<string | null>(null);

let pollHandle: ReturnType<typeof setInterval> | null = null;

const hasChanges = computed(
    () =>
        edgeChanges.value.length > 0 ||
        nodeChanges.value.length > 0 ||
        edgeMembershipChanges.value.length > 0 ||
        nodeMembershipChanges.value.length > 0 ||
        runtimeContainerChanges.value.length > 0
);

function describeError(err: unknown): string {
    return err instanceof Error ? err.message : 'Unknown error';
}

async function requestDiff(): Promise<TopologyDiff> {
    return await sendRPC<TopologyDiff>(
        'FLEET_MANAGER',
        'System.GetTopologyDiff',
        {windowMin: 5}
    );
}

async function fetchDiff(): Promise<void> {
    try {
        const [data, runtimeChanges] = await Promise.all([
            requestDiff(),
            requestRuntimeContainerChanges()
        ]);
        edgeChanges.value = data.changedEdges.slice(0, ITEM_LIMIT);
        nodeChanges.value = data.changedNodes.slice(0, ITEM_LIMIT);
        edgeMembershipChanges.value = (data.edgeMembershipChanges ?? []).slice(
            0,
            ITEM_LIMIT
        );
        nodeMembershipChanges.value = (data.nodeMembershipChanges ?? []).slice(
            0,
            ITEM_LIMIT
        );
        runtimeContainerChanges.value = runtimeChanges.slice(0, ITEM_LIMIT);
        lastError.value = null;
    } catch (err) {
        edgeChanges.value = [];
        nodeChanges.value = [];
        edgeMembershipChanges.value = [];
        nodeMembershipChanges.value = [];
        runtimeContainerChanges.value = [];
        lastError.value = describeError(err);
    }
}

async function requestRuntimeContainerChanges(): Promise<
    RuntimeContainerChange[]
> {
    const {manifestPayload, manifestError} = await loadDeployManifestPayload();
    const view = buildRuntimeContractView({
        versionInfo: {},
        manifestPayload,
        manifestError,
        deviceUsagePayload: null
    });
    const {missing, unexpected, unknownOwner} = view.containerSummary;
    const changes: RuntimeContainerChange[] = [];
    if (missing > 0) {
        changes.push({
            kind: 'missing',
            count: missing,
            label: 'declared container missing',
            severity: 'critical'
        });
    }
    if (unexpected > 0) {
        changes.push({
            kind: 'unexpected',
            count: unexpected,
            label: 'unexpected/new container detected',
            severity: 'warning'
        });
    }
    if (unknownOwner > 0) {
        changes.push({
            kind: 'unknown-owner',
            count: unknownOwner,
            label: 'unknown-owner container detected',
            severity: 'warning'
        });
    }
    return changes;
}

function formatPct(pct: number): string {
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct}% throughput`;
}

const SEVERITY_CLASS: Record<string, string> = {
    critical: 'is-critical',
    warning: 'is-warning',
    healthy: 'is-healthy'
};

function severityClassFor(status: string): string {
    return SEVERITY_CLASS[status] ?? '';
}

onMounted(() => {
    void fetchDiff();
    pollHandle = setInterval(fetchDiff, POLL_INTERVAL_MS);
});

onBeforeUnmount(() => {
    if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
    }
});
</script>

<style scoped>
.recent-changes {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
    font-size: var(--type-caption);
}
.recent-label {
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    font-size: var(--type-caption);
}
.recent-list {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin: 0;
    padding: 0;
    list-style: none;
}
.recent-item {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    color: var(--color-text-secondary);
}
.recent-id {
    font-family: var(--font-mono);
    color: var(--color-text-primary);
}
.recent-detail {
    color: var(--color-text-tertiary);
}
.recent-item.is-critical .recent-id {
    color: var(--color-danger-text);
}
.recent-item.is-warning .recent-id {
    color: var(--color-warning-text);
}
.recent-item.is-healthy .recent-id {
    color: var(--color-success-text);
}
.recent-item.is-appeared .recent-id {
    color: var(--color-info);
}
.recent-item.is-disappeared .recent-id {
    color: var(--color-warning-text);
}
.recent-error {
    padding: var(--space-2) var(--space-3);
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
}
</style>
