<template>
    <div class="slow-ops-panel">
        <MonitoringSectionHeader :title="title">
            <template #actions>
                <label class="slow-ops-window">
                    Window:
                    <select
                        v-model.number="windowSec"
                        class="slow-ops-select"
                        aria-label="Time window"
                    >
                        <option v-for="opt in WINDOW_OPTIONS" :key="opt.sec" :value="opt.sec">
                            {{ opt.label }}
                        </option>
                    </select>
                </label>
            </template>
        </MonitoringSectionHeader>

        <div v-if="error" class="slow-ops-banner">{{ error }}</div>

        <table v-if="entries.length > 0" class="slow-ops-table">
            <thead>
                <tr>
                    <th v-for="col in columns" :key="col.label" :class="col.cellClass">
                        {{ col.label }}
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="(entry, idx) in entries"
                    :key="idx"
                    class="slow-ops-row"
                    :class="{clickable: !!rowAction}"
                    :role="rowAction ? 'button' : undefined"
                    :tabindex="rowAction ? 0 : undefined"
                    @click="rowAction?.(entry)"
                    @keydown.enter.prevent="rowAction?.(entry)"
                >
                    <td v-for="col in columns" :key="col.label" :class="cellClass(col, entry)">
                        {{ col.value(entry) }}
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-else class="slow-ops-empty">{{ emptyText }}</p>
    </div>
</template>

<script setup lang="ts">
import {onBeforeUnmount, onMounted, ref, watch} from 'vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import type {
    SlowOpsColumn,
    SlowOpsRow
} from '@/components/monitoring/slowOps';
import {sendRPC} from '@/tools/websocket';

const props = defineProps<{
    title: string;
    rpcMethod: string;
    emptyText: string;
    columns: SlowOpsColumn[];
    // Optional row click (e.g. open the audit log for that method).
    rowAction?: (entry: SlowOpsRow) => void;
}>();

const POLL_INTERVAL_MS = 5000;
const DEFAULT_LIMIT = 50;
const WINDOW_OPTIONS = [
    {sec: 300, label: '5 min'},
    {sec: 900, label: '15 min'},
    {sec: 3600, label: '1 hour'}
];

const windowSec = ref(300);
const entries = ref<SlowOpsRow[]>([]);
const error = ref<string | null>(null);
let pollHandle: ReturnType<typeof setInterval> | null = null;

function cellClass(col: SlowOpsColumn, entry: SlowOpsRow): string {
    return [col.cellClass, col.rowClass?.(entry)].filter(Boolean).join(' ');
}

async function fetchEntries(): Promise<void> {
    try {
        const data = await sendRPC<{entries: SlowOpsRow[]}>(
            'FLEET_MANAGER',
            props.rpcMethod,
            {windowSec: windowSec.value, limit: DEFAULT_LIMIT}
        );
        entries.value = data.entries;
        error.value = null;
    } catch (err) {
        error.value =
            err instanceof Error ? err.message : `Failed to fetch ${props.title}`;
    }
}

onMounted(() => {
    void fetchEntries();
    pollHandle = setInterval(fetchEntries, POLL_INTERVAL_MS);
});
onBeforeUnmount(() => {
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = null;
});
watch(windowSec, () => {
    void fetchEntries();
});
</script>

<style scoped>
.slow-ops-panel {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.slow-ops-window {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
}
.slow-ops-select {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    font: inherit;
}
.slow-ops-select:focus-visible {
    outline: none;
    border-color: var(--color-border-focus);
    box-shadow: var(--state-selected-ring);
}
.slow-ops-banner {
    padding: var(--space-2) var(--space-3);
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
}
.slow-ops-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--type-caption);
}
.slow-ops-table th {
    text-align: left;
    color: var(--color-text-tertiary);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    padding: var(--space-1-5) var(--space-2);
    border-bottom: 1px solid var(--color-border-default);
}
.slow-ops-table td {
    padding: var(--space-1-5) var(--space-2);
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
}
.col-num {
    font-family: var(--font-mono);
    text-align: right;
    color: var(--color-text-primary);
}
.col-mono {
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
}
.col-muted {
    color: var(--color-text-tertiary);
}
.col-danger {
    color: var(--color-danger-text);
}
.slow-ops-row.clickable {
    cursor: pointer;
}
.slow-ops-row.clickable:hover td {
    background: var(--color-surface-2);
}
.slow-ops-row.clickable:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: -2px;
}
.slow-ops-empty {
    padding: var(--space-2) 0;
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}
</style>
