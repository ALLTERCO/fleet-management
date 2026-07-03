<template>
    <CardShell
        type="ui_widget"
        name="Device Health"
        icon="fas fa-table-list"
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
        <div class="dt">
            <div v-if="!rows.length" class="dt-empty">No devices</div>
            <div v-else class="dt-scroll">
                <table class="dt-table">
                    <thead>
                        <tr>
                            <th class="dt-th" @click="setSort('name')">
                                Name <i v-if="sortBy === 'name'" :class="sortIcon" />
                            </th>
                            <th class="dt-th dt-th--center" @click="setSort('online')">
                                Status <i v-if="sortBy === 'online'" :class="sortIcon" />
                            </th>
                            <th class="dt-th dt-th--right" @click="setSort('signal')">
                                Signal <i v-if="sortBy === 'signal'" :class="sortIcon" />
                            </th>
                            <th class="dt-th dt-th--right" @click="setSort('battery')">
                                Batt. <i v-if="sortBy === 'battery'" :class="sortIcon" />
                            </th>
                            <th class="dt-th dt-th--right" @click="setSort('firmware')">
                                FW <i v-if="sortBy === 'firmware'" :class="sortIcon" />
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in sortedRows" :key="row.shellyId" class="dt-row">
                            <td class="dt-td dt-name" :title="row.shellyId">{{ row.name }}</td>
                            <td class="dt-td dt-td--center">
                                <span class="dt-dot" :class="row.online ? 'dt-dot--on' : 'dt-dot--off'" />
                            </td>
                            <td class="dt-td dt-td--right" :class="rssiClass(row.rssi)">
                                {{ row.rssi != null ? row.rssi + ' dBm' : '—' }}
                            </td>
                            <td class="dt-td dt-td--right" :class="batClass(row.battery)">
                                {{ row.battery != null ? row.battery + '%' : '—' }}
                            </td>
                            <td class="dt-td dt-td--right">
                                <span v-if="row.hasFwUpdate" class="dt-fw-badge">UPD</span>
                                <span v-else class="dt-ok">✓</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {useDashboardContext} from '@/composables/useDashboardContext';
import {useLocationDeviceScope} from '@/composables/useLocationDeviceScope';
import {shellyIdsFromGroups} from '@/helpers/groupDevices';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import CardShell from './CardShell.vue';

export interface DataTableWidgetConfig {
    id: 'data_table_widget';
    source: 'device_health';
    groupIds?: number[];
    sortBy?: 'name' | 'online' | 'signal' | 'battery' | 'firmware';
    maxRows?: number;
}

type SortKey = 'name' | 'online' | 'signal' | 'battery' | 'firmware';

interface HealthRow {
    shellyId: string;
    name: string;
    online: boolean;
    rssi: number | null;
    battery: number | null;
    hasFwUpdate: boolean;
}

const props = withDefaults(
    defineProps<{
        config: DataTableWidgetConfig;
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

const groupsStore = useGroupsStore();
const devicesStore = useDevicesStore();
const context = useDashboardContext();
const {allDeviceIds: contextLocationDeviceIds} = useLocationDeviceScope(
    computed(() =>
        context.value.locationId !== null ? [context.value.locationId] : []
    )
);

const sortBy = ref<SortKey>(props.config.sortBy ?? 'name');
const sortAsc = ref(true);

function setSort(key: SortKey) {
    if (sortBy.value === key) sortAsc.value = !sortAsc.value;
    else {
        sortBy.value = key;
        sortAsc.value = true;
    }
}

const sortIcon = computed(() =>
    sortAsc.value ? 'fas fa-sort-up' : 'fas fa-sort-down'
);

const scopedShellyIds = computed<Set<string> | null>(() => {
    if (props.config.groupIds?.length) {
        return shellyIdsFromGroups(props.config.groupIds, groupsStore.groups);
    }
    if (context.value.locationId !== null) {
        return new Set(contextLocationDeviceIds.value);
    }
    return null;
});

const rows = computed<HealthRow[]>(() => {
    const result: HealthRow[] = [];
    for (const [shellyId, device] of Object.entries(devicesStore.devices)) {
        if (
            scopedShellyIds.value !== null &&
            !scopedShellyIds.value.has(shellyId)
        )
            continue;
        const d = device as any;
        const s = d.status ?? {};
        const rssi: number | null = s.wifi?.rssi ?? null;
        const battery: number | null =
            s['devicepower:0']?.battery?.percent ??
            s['devicepower:1']?.battery?.percent ??
            null;
        const hasFwUpdate = !!(
            s.sys?.available_updates &&
            Object.keys(s.sys.available_updates).length > 0
        );
        result.push({
            shellyId,
            name: d.info?.name || shellyId,
            online: !!d.online,
            rssi,
            battery,
            hasFwUpdate
        });
    }
    return result;
});

// Sort all rows, then slice — ensures correct top-N after sorting (e.g. worst signal first)
const sortedRows = computed(() => {
    const key = sortBy.value;
    const maxRows = props.config.maxRows ?? 100;
    return [...rows.value]
        .sort((a, b) => {
            let cmp = 0;
            if (key === 'name') cmp = a.name.localeCompare(b.name);
            else if (key === 'online')
                cmp = (b.online ? 1 : 0) - (a.online ? 1 : 0);
            else if (key === 'signal')
                cmp = (a.rssi ?? -200) - (b.rssi ?? -200);
            else if (key === 'battery')
                cmp = (a.battery ?? -1) - (b.battery ?? -1);
            else if (key === 'firmware')
                cmp = (a.hasFwUpdate ? 1 : 0) - (b.hasFwUpdate ? 1 : 0);
            return sortAsc.value ? cmp : -cmp;
        })
        .slice(0, maxRows);
});

function rssiClass(rssi: number | null): string {
    if (rssi == null) return '';
    if (rssi < -80) return 'dt-val--warn';
    if (rssi < -70) return 'dt-val--dim';
    return '';
}

function batClass(bat: number | null): string {
    if (bat == null) return '';
    if (bat < 20) return 'dt-val--crit';
    if (bat < 30) return 'dt-val--warn';
    return '';
}
</script>

<style scoped>
.dt {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.dt-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.dt-scroll {
    flex: 1;
    overflow: auto;
    min-height: 0;
}

.dt-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--type-body);
}

.dt-th {
    position: sticky;
    top: 0;
    background: var(--color-surface-2);
    padding: var(--space-1) var(--space-1-5);
    text-align: left;
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-tertiary);
    text-transform: none;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--color-border-default);
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
}

.dt-th--right { text-align: right; }
.dt-th--center { text-align: center; }
.dt-th:hover { color: var(--color-text-secondary); }

.dt-row:hover { background: var(--state-hover-bg); }

.dt-td {
    padding: var(--space-1) var(--space-1-5);
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--color-border-subtle);
    white-space: nowrap;
}

.dt-td--right  { text-align: right; }
.dt-td--center { text-align: center; }

.dt-name {
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-primary);
    font-weight: 500;
}

.dt-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
}

.dt-dot--on  { background: var(--color-status-on); }
.dt-dot--off { background: var(--color-text-disabled); }

.dt-val--crit { color: var(--color-danger-text); }
.dt-val--warn { color: var(--color-warning-text); }
.dt-val--dim  { color: var(--color-text-tertiary); }

.dt-fw-badge {
    background: rgba(var(--color-warning-rgb),0.2);
    color: var(--color-warning-text);
    border-radius: var(--radius-xs);
    padding: 0 var(--space-1);
    font-size: var(--type-body);
    font-weight: 700;
}

.dt-ok {
    color: var(--color-success-text);
    font-size: var(--type-body);
}
</style>
