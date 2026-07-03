<template>
    <div class="dash-device-list">
        <div v-if="loading" class="ddl-skeleton">
            <div v-for="n in 5" :key="n" class="ddl-skeleton-row" />
        </div>
        <template v-else>
        <div v-if="searchable" class="ddl-header">
            <input
                v-model="search"
                class="ddl-search"
                placeholder="Search devices..."
                aria-label="Search devices"
            />
            <span class="ddl-count">{{ filteredDevices.length }} devices</span>
        </div>

        <div class="ddl-col-headers">
            <span class="ddl-col-hdr ddl-col-hdr--name">Device</span>
            <template v-for="col in valueColumns" :key="'hdr-' + col.key">
                <span
                    class="ddl-col-hdr"
                    :class="{'ddl-col-hdr--sortable': col.sortable, 'ddl-col-hdr--active': sortKey === col.key}"
                    :style="col.width ? {minWidth: col.width} : {}"
                    @click="col.sortable && toggleSort(col.key)"
                >
                    {{ col.label }}
                    <span v-if="sortKey === col.key" class="ddl-sort-arrow">{{ sortDir === 'asc' ? '\u2191' : '\u2193' }}</span>
                </span>
            </template>
            <span class="ddl-col-hdr" style="width:20px;" />
        </div>

        <div class="ddl-rows">
            <template v-for="(device, idx) in pagedDevices" :key="device.id">
                <div
                    class="ddl-row"
                    :class="{'ddl-row--offline': !device.online}"
                    @click="toggleExpand(device.id)"
                >
                    <span class="ddl-rank">{{ pageStart + idx + 1 }}</span>
                    <span class="ddl-dot" :class="device.online ? 'ddl-dot--on' : 'ddl-dot--off'" />
                    <span class="ddl-name">{{ device.name }}</span>
                    <template v-for="col in valueColumns" :key="col.key">
                        <span class="ddl-val" :style="col.width ? {minWidth: col.width} : {}">
                            {{ col.format ? col.format(device[col.key], device) : device[col.key] ?? '\u2014' }}
                        </span>
                    </template>
                    <span class="ddl-arrow">&rarr;</span>
                </div>

                <DashDeviceDrillDown
                    v-if="expandedId === device.id && drillDownMetric"
                    :shelly-id="device.shellyId"
                    :metric="drillDownMetric"
                    :range="drillDownRange"
                    @close="expandedId = null"
                />
            </template>

            <div v-if="!pagedDevices.length" class="ddl-empty">
                {{ search ? 'No devices match search' : 'No devices' }}
            </div>
        </div>

        <div v-if="totalPages > 1" class="ddl-pager">
            <span>Showing {{ pageStart + 1 }}&ndash;{{ pageEnd }} of {{ filteredDevices.length }}</span>
            <div class="ddl-pager-btns">
                <button class="ddl-pager-btn" :disabled="page === 0" @click="page--">&larr; Prev</button>
                <button class="ddl-pager-btn" :disabled="page >= totalPages - 1" @click="page++">Next &rarr;</button>
            </div>
        </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import type {DashColumnDef, DashDeviceRow} from '@/types/dashboard-components';
import DashDeviceDrillDown from './DashDeviceDrillDown.vue';

const props = withDefaults(
    defineProps<{
        devices: DashDeviceRow[];
        columns: DashColumnDef[];
        pageSize?: number;
        searchable?: boolean;
        drillDownMetric?: string;
        loading?: boolean;
    }>(),
    {
        pageSize: 20,
        searchable: true
    }
);

const search = ref('');
const sortKey = ref('');
const sortDir = ref<'asc' | 'desc'>('desc');
const page = ref(0);
const expandedId = ref<number | null>(null);

watch(search, () => {
    page.value = 0;
});

const drillDownRange = computed(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {from: from.toISOString(), to: to.toISOString()};
});

const valueColumns = computed(() =>
    props.columns.filter((c) => c.key !== 'name')
);

const filteredDevices = computed(() => {
    let list = props.devices;
    if (search.value) {
        const q = search.value.toLowerCase();
        list = list.filter(
            (d) =>
                d.name.toLowerCase().includes(q) ||
                d.shellyId.toLowerCase().includes(q)
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
    Math.ceil(filteredDevices.value.length / props.pageSize)
);

watch(totalPages, (tp) => {
    if (tp === 0) {
        page.value = 0;
        return;
    }
    if (page.value >= tp) page.value = tp - 1;
});

const pageStart = computed(() => page.value * props.pageSize);
const pageEnd = computed(() =>
    Math.min(pageStart.value + props.pageSize, filteredDevices.value.length)
);
const pagedDevices = computed(() =>
    filteredDevices.value.slice(pageStart.value, pageEnd.value)
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

function toggleExpand(id: number) {
    expandedId.value = expandedId.value === id ? null : id;
}
</script>

<style scoped>
.ddl-skeleton { display: flex; flex-direction: column; gap: var(--space-1); }
.ddl-skeleton-row { height: 32px; background: var(--color-surface-3); border-radius: var(--radius-md); animation: ddl-pulse 1.5s ease infinite; }
.ddl-skeleton-row:nth-child(2) { opacity: 0.8; }
.ddl-skeleton-row:nth-child(3) { opacity: 0.6; }
.ddl-skeleton-row:nth-child(4) { opacity: 0.4; }
.ddl-skeleton-row:nth-child(5) { opacity: 0.2; }
@keyframes ddl-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

.ddl-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
}
.ddl-search {
    background: var(--color-surface-0);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    width: var(--space-20);
    outline: none;
    transition: border-color var(--duration-fast) var(--ease-default);
}
.ddl-search:focus { border-color: var(--color-primary); }
.ddl-search::placeholder { color: var(--color-text-disabled); }
.ddl-count { font-size: var(--type-body); color: var(--color-text-disabled); }

.ddl-col-headers {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 0 var(--space-1-5);
    border-bottom: 1px solid var(--color-border-subtle);
    margin-bottom: var(--space-0-5);
}
.ddl-col-hdr {
    font-size: var(--type-body);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-disabled);
    text-align: right;
    min-width: var(--space-10);
}
.ddl-col-hdr--name { flex: 1; text-align: left; padding-left: calc(var(--space-6) + var(--space-1)); }
.ddl-col-hdr--sortable { cursor: pointer; user-select: none; transition: color 0.2s; }
.ddl-col-hdr--sortable:hover { color: var(--color-text-tertiary); }
.ddl-col-hdr--active { color: var(--color-text-tertiary); }
.ddl-sort-arrow { margin-left: var(--space-0-5); }

.ddl-rows { display: flex; flex-direction: column; }
.ddl-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border-subtle);
    cursor: pointer;
    transition: background 0.2s ease;
    border-radius: var(--radius-sm);
}
.ddl-row:last-child { border-bottom: none; }
.ddl-row:hover { background: var(--state-hover-bg); }
.ddl-row--offline .ddl-name { color: var(--color-text-tertiary); }
.ddl-row--offline .ddl-val { color: var(--color-text-disabled); }

.ddl-rank { font-size: var(--type-body); color: var(--color-text-disabled); width: 14px; text-align: center; font-weight: 500; }
.ddl-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.ddl-dot--on { background: var(--color-success-text); }
.ddl-dot--off { background: var(--color-danger-text); }
.ddl-name {
    flex: 1;
    font-size: var(--type-body);
    color: var(--color-text-primary);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ddl-val {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    text-align: right;
    min-width: var(--space-10);
}
.ddl-arrow {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    transition: color 0.2s;
}
.ddl-row:hover .ddl-arrow { color: var(--color-text-tertiary); }

.ddl-empty {
    padding: var(--space-5) 0;
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}

.ddl-pager {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-2) 0 0;
    font-size: var(--type-body);
    color: var(--color-text-disabled);
}
.ddl-pager-btns { display: flex; gap: var(--space-1); }
.ddl-pager-btn {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: all 0.2s;
}
.ddl-pager-btn:hover:not(:disabled) { background: var(--color-surface-3); color: var(--color-text-secondary); }
.ddl-pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
