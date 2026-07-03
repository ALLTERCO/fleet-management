<template>
    <div class="dash-meter-table">
        <!-- Header: search + filters -->
        <div class="dmt-header">
            <input v-model="search" class="dmt-search" placeholder="Search devices..." aria-label="Search devices" />
            <select v-model="typeFilter" class="dmt-filter">
                <option value="">All types</option>
                <option value="3ph_em">3-phase EM</option>
                <option value="mono_em">Mono EM</option>
                <option value="switch">Switch</option>
                <option value="pm">Power meter</option>
            </select>
            <select v-model="statusFilter" class="dmt-filter">
                <option value="">All status</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
            </select>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="dmt-skeleton">
            <div v-for="n in 5" :key="n" class="dmt-skeleton-row" />
        </div>

        <template v-else>
            <!-- Table -->
            <div class="dmt-table-wrap">
                <table class="dmt-table">
                    <thead>
                        <tr>
                            <th
                                v-for="col in columns"
                                :key="col.key"
                                :class="{
                                    'dmt-th--sortable': col.sortable,
                                    'dmt-th--active': sortKey === col.key,
                                    'dmt-th--left': col.align === 'left',
                                }"
                                @click="col.sortable && toggleSort(col.key)"
                            >
                                {{ col.label }}
                                <span v-if="sortKey === col.key" class="dmt-sort-arrow">{{
                                    sortDir === 'asc' ? '\u2191' : '\u2193'
                                }}</span>
                            </th>
                            <th class="dmt-th--expand" />
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="row in pagedRows" :key="row.id">
                            <tr
                                class="dmt-row"
                                :class="{ 'dmt-row--offline': !row.online }"
                                @click="toggleExpand(row)"
                            >
                                <td
                                    v-for="col in columns"
                                    :key="col.key"
                                    :class="{ 'dmt-td--name': col.align === 'left' }"
                                >
                                    <template v-if="col.key === columns[0].key">
                                        <span
                                            class="dmt-dot"
                                            :class="row.online ? 'dmt-dot--on' : 'dmt-dot--off'"
                                        />
                                        {{
                                            col.format
                                                ? col.format(row[col.key], row)
                                                : row[col.key]
                                        }}
                                    </template>
                                    <template v-else>
                                        {{
                                            col.format
                                                ? col.format(row[col.key], row)
                                                : (row[col.key] ?? '\u2014')
                                        }}
                                    </template>
                                </td>
                                <td class="dmt-td--expand">
                                    <span
                                        v-if="row.hasEmChannels || row.hasEm1Channels"
                                        class="dmt-expand-btn"
                                    >
                                        {{ expandedId === row.id ? '\u25B4' : '\u25BE' }}
                                    </span>
                                </td>
                            </tr>
                            <!-- Expanded channel detail -->
                            <tr
                                v-if="expandedId === row.id && expandedChannels"
                                class="dmt-expand-row"
                            >
                                <td :colspan="columns.length + 1">
                                    <div class="dmt-channels">
                                        <div
                                            v-for="(ch, ci) in expandedChannels.emChannels"
                                            :key="'em-' + ci"
                                            class="dmt-channel"
                                            :class="'dmt-channel--' + ci"
                                        >
                                            <div class="dmt-ch-label">
                                                {{ phaseLabel(ch.channel, 'em') }}
                                            </div>
                                            <div class="dmt-ch-values">
                                                {{
                                                    ch.act_power != null
                                                        ? Math.round(ch.act_power) + ' W'
                                                        : '\u2014'
                                                }}
                                                &middot;
                                                {{
                                                    ch.voltage != null
                                                        ? ch.voltage.toFixed(1) + ' V'
                                                        : '\u2014'
                                                }}
                                                &middot;
                                                {{
                                                    ch.current != null
                                                        ? ch.current.toFixed(2) + ' A'
                                                        : '\u2014'
                                                }}
                                            </div>
                                        </div>
                                        <div
                                            v-for="(ch, ci) in expandedChannels.em1Channels"
                                            :key="'em1-' + ci"
                                            class="dmt-channel dmt-channel--mono"
                                        >
                                            <div class="dmt-ch-label">
                                                {{ phaseLabel(ch.channel, 'em1') }}
                                            </div>
                                            <div class="dmt-ch-values">
                                                {{
                                                    ch.act_power != null
                                                        ? Math.round(ch.act_power) + ' W'
                                                        : '\u2014'
                                                }}
                                                &middot;
                                                {{
                                                    ch.voltage != null
                                                        ? ch.voltage.toFixed(1) + ' V'
                                                        : '\u2014'
                                                }}
                                                &middot;
                                                {{
                                                    ch.current != null
                                                        ? ch.current.toFixed(2) + ' A'
                                                        : '\u2014'
                                                }}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>

            <!-- Empty state -->
            <div v-if="!pagedRows.length" class="dmt-empty">
                {{ search || typeFilter || statusFilter ? 'No devices match filters' : 'No devices' }}
            </div>

            <!-- Pagination -->
            <div v-if="totalPages > 1" class="dmt-pager">
                <span
                    >Showing {{ pageStart + 1 }}&ndash;{{ pageEnd }} of
                    {{ filteredRows.length }}</span
                >
                <div class="dmt-pager-btns">
                    <button class="dmt-pager-btn" :disabled="page === 0" @click="page--">
                        &larr; Prev
                    </button>
                    <span class="dmt-pager-info">Page {{ page + 1 }} of {{ totalPages }}</span>
                    <button
                        class="dmt-pager-btn"
                        :disabled="page >= totalPages - 1"
                        @click="page++"
                    >
                        Next &rarr;
                    </button>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import type {EmChannel} from '@/helpers/liveMetrics';
import {phaseLabel} from '@/helpers/liveMetrics';
import type {DashColumnDef, DashDeviceRow} from '@/types/dashboard-components';

const props = withDefaults(
    defineProps<{
        rows: DashDeviceRow[];
        columns: DashColumnDef[];
        fetchChannels: (
            shellyId: string
        ) => Promise<{emChannels: EmChannel[]; em1Channels: EmChannel[]}>;
        pageSize?: number;
        loading?: boolean;
    }>(),
    {pageSize: 25}
);

const search = ref('');
const typeFilter = ref('');
const statusFilter = ref('');
const sortKey = ref('');
const sortDir = ref<'asc' | 'desc'>('desc');
const page = ref(0);
const expandedId = ref<number | null>(null);
const expandedChannels = ref<{
    emChannels: EmChannel[];
    em1Channels: EmChannel[];
} | null>(null);
const channelCache = new Map<
    string,
    {emChannels: EmChannel[]; em1Channels: EmChannel[]}
>();

// Reset page on filter change
watch([search, typeFilter, statusFilter], () => {
    page.value = 0;
});

const filteredRows = computed(() => {
    let list = props.rows;
    if (search.value) {
        const q = search.value.toLowerCase();
        list = list.filter(
            (r) =>
                r.name.toLowerCase().includes(q) ||
                r.shellyId.toLowerCase().includes(q)
        );
    }
    if (typeFilter.value) {
        list = list.filter((r) => r.type === typeFilter.value);
    }
    if (statusFilter.value) {
        list = list.filter((r) =>
            statusFilter.value === 'online' ? r.online : !r.online
        );
    }
    if (sortKey.value) {
        const key = sortKey.value;
        const dir = sortDir.value === 'asc' ? 1 : -1;
        list = [...list].sort((a, b) => {
            const va = a[key] ?? 0;
            const vb = b[key] ?? 0;
            return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
        });
    }
    return list;
});

const totalPages = computed(() =>
    Math.ceil(filteredRows.value.length / props.pageSize)
);
const pageStart = computed(() => page.value * props.pageSize);
const pageEnd = computed(() =>
    Math.min(pageStart.value + props.pageSize, filteredRows.value.length)
);
const pagedRows = computed(() =>
    filteredRows.value.slice(pageStart.value, pageEnd.value)
);

function toggleSort(key: string) {
    if (sortKey.value === key) {
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey.value = key;
        sortDir.value = 'desc';
    }
    page.value = 0;
}

async function toggleExpand(row: DashDeviceRow) {
    if (!row.hasEmChannels && !row.hasEm1Channels) return;
    if (expandedId.value === row.id) {
        expandedId.value = null;
        expandedChannels.value = null;
        return;
    }
    expandedId.value = row.id;
    // Check cache first
    const cached = channelCache.get(row.shellyId);
    if (cached) {
        expandedChannels.value = cached;
        return;
    }
    expandedChannels.value = null;
    try {
        const result = await props.fetchChannels(row.shellyId);
        channelCache.set(row.shellyId, result);
        expandedChannels.value = result;
    } catch {
        expandedChannels.value = {emChannels: [], em1Channels: []};
    }
}
</script>

<style scoped>
.dmt-header {
    display: flex;
    gap: var(--space-1-5);
    align-items: center;
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
}
.dmt-search {
    background: var(--color-surface-0);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    width: 100%;
    max-width: 180px;
    min-width: 0;
    outline: none;
}
.dmt-search:focus {
    border-color: var(--color-primary);
}
.dmt-search::placeholder {
    color: var(--color-text-disabled);
}
.dmt-filter {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    cursor: pointer;
    outline: none;
}

.dmt-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.dmt-skeleton-row {
    height: 36px;
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
    animation: dmt-pulse 1.5s ease infinite;
}
.dmt-skeleton-row:nth-child(n + 3) {
    opacity: 0.5;
}
@keyframes dmt-pulse {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}

.dmt-table-wrap {
    overflow-x: auto;
}
.dmt-table {
    width: 100%;
    border-collapse: collapse;
}
.dmt-table th {
    font-size: var(--type-body);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-disabled);
    padding: 7px var(--space-2);
    text-align: right;
    user-select: none;
}
.dmt-th--left {
    text-align: left;
}
.dmt-th--sortable {
    cursor: pointer;
    transition: color 0.2s;
}
.dmt-th--sortable:hover {
    color: var(--color-text-tertiary);
}
.dmt-th--active {
    color: var(--color-text-tertiary);
}
.dmt-th--expand {
    width: 30px;
}
.dmt-sort-arrow {
    margin-left: var(--space-0-5);
}

.dmt-table td {
    padding: var(--space-2) var(--space-2);
    font-size: var(--type-body);
    font-variant-numeric: tabular-nums;
    border-top: 1px solid var(--color-border-subtle);
    text-align: right;
    color: var(--color-text-tertiary);
}
.dmt-td--name {
    color: var(--color-text-primary);
    font-weight: 500;
    text-align: left;
}
.dmt-td--expand {
    text-align: center;
}
.dmt-row {
    cursor: pointer;
    transition: background 0.15s;
}
.dmt-row:hover td {
    background: var(--state-hover-bg);
}
.dmt-row--offline .dmt-td--name {
    color: var(--color-text-tertiary);
}

.dmt-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    display: inline-block;
    vertical-align: middle;
    margin-right: var(--space-1-5);
}
.dmt-dot--on {
    background: var(--color-success-text);
}
.dmt-dot--off {
    background: var(--color-danger-text);
}

.dmt-expand-btn {
    font-size: var(--type-body);
    color: var(--color-primary);
    opacity: 0.5;
}
.dmt-row:hover .dmt-expand-btn {
    opacity: 0.8;
}

/* Expand row */
.dmt-expand-row td {
    padding: var(--space-1) var(--space-2) 10px 28px;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
}
.dmt-channels {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-1-5);
}
.dmt-channel {
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--type-body);
}
.dmt-channel--0 {
    background: rgba(var(--color-primary-rgb), 0.05);
    border: 1px solid rgba(var(--color-primary-rgb), 0.08);
}
.dmt-channel--1 {
    background: rgba(var(--color-warning-rgb), 0.05);
    border: 1px solid rgba(var(--color-warning-rgb), 0.08);
}
.dmt-channel--2 {
    background: rgba(var(--color-danger-rgb), 0.05);
    border: 1px solid rgba(var(--color-danger-rgb), 0.08);
}
.dmt-channel--3 {
    background: rgba(var(--color-accent-rgb), 0.05);
    border: 1px solid rgba(var(--color-accent-rgb), 0.08);
}
.dmt-channel--4 {
    background: rgba(var(--color-success-rgb), 0.05);
    border: 1px solid rgba(var(--color-success-rgb), 0.08);
}
.dmt-channel--mono {
    background: rgba(var(--color-info-rgb), 0.05);
    border: 1px solid rgba(var(--color-info-rgb), 0.08);
}
.dmt-ch-label {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    margin-bottom: var(--space-px);
}
.dmt-ch-values {
    color: var(--color-text-secondary);
}

.dmt-empty {
    text-align: center;
    padding: var(--space-5) 0;
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}

.dmt-pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) 0;
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}
.dmt-pager-btns {
    display: flex;
    gap: var(--space-1-5);
    align-items: center;
}
.dmt-pager-info {
    color: var(--color-text-disabled);
}
.dmt-pager-btn {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: 3px var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.dmt-pager-btn:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.dmt-pager-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
</style>
