<template>
    <CardShell
        type="ui_widget"
        name="Maintenance"
        icon="fas fa-triangle-exclamation"
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
        <div class="ml">
            <div v-if="!visibleItems.length" class="ml-empty">
                <i class="fas fa-circle-check" style="font-size:var(--type-caption);margin-bottom:var(--space-1);" />
                <span>No issues</span>
            </div>
            <div v-else class="ml-list">
                <div
                    v-for="item in visibleItems"
                    :key="item.key"
                    class="ml-item"
                    :class="`ml-item--${item.severity}`"
                >
                    <span class="ml-icon">
                        <i :class="severityIcon(item.severity)" />
                    </span>
                    <div class="ml-body">
                        <span class="ml-title">{{ item.title }}</span>
                        <span class="ml-sub">{{ item.sub }}</span>
                    </div>
                </div>
            </div>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useDashboardContext} from '@/composables/useDashboardContext';
import {useLocationDeviceScope} from '@/composables/useLocationDeviceScope';
import {shellyIdsFromGroups} from '@/helpers/groupDevices';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import CardShell from './CardShell.vue';

export interface MaintenanceListWidgetConfig {
    id: 'maintenance_list_widget';
    groupIds?: number[];
    severities?: Array<'critical' | 'warning' | 'info'>;
    maxItems?: number;
}

interface MlItem {
    key: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    sub: string;
}

const props = withDefaults(
    defineProps<{
        config: MaintenanceListWidgetConfig;
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

const groupsStore = useGroupsStore();
const devicesStore = useDevicesStore();
const entityStore = useEntityStore();
const context = useDashboardContext();
const {allDeviceIds: contextLocationDeviceIds} = useLocationDeviceScope(
    computed(() =>
        context.value.locationId !== null ? [context.value.locationId] : []
    )
);

const allowedSeverities = computed(
    () =>
        new Set(
            props.config.severities?.length
                ? props.config.severities
                : ['critical', 'warning', 'info']
        )
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

function inScope(shellyId: string): boolean {
    return (
        scopedShellyIds.value === null || scopedShellyIds.value.has(shellyId)
    );
}

// Index entities by source shellyId once — O(entities), avoids O(devices × entities) inner loop
const entitiesByShelly = computed<Map<string, any[]>>(() => {
    const m = new Map<string, any[]>();
    for (const e of Object.values(entityStore.entities) as any[]) {
        if (!e.source) continue;
        const arr = m.get(e.source);
        if (arr) arr.push(e);
        else m.set(e.source, [e]);
    }
    return m;
});

const allItems = computed<MlItem[]>(() => {
    const items: MlItem[] = [];

    for (const [shellyId, device] of Object.entries(devicesStore.devices)) {
        if (!inScope(shellyId)) continue;
        const name = device.info?.name || shellyId;

        // Critical: active flood/smoke alarms
        for (const entity of entitiesByShelly.value.get(shellyId) ?? []) {
            if (
                entity.type === 'flood' &&
                (entity.status?.alarm || entity.status?.flood)
            ) {
                items.push({
                    key: `flood-${entity.id}`,
                    severity: 'critical',
                    title: 'Flood alarm active',
                    sub: name
                });
            }
            if (entity.type === 'smoke' && entity.status?.alarm) {
                items.push({
                    key: `smoke-${entity.id}`,
                    severity: 'critical',
                    title: 'Smoke alarm active',
                    sub: name
                });
            }
        }

        // Warning: device offline
        if (!device.online) {
            items.push({
                key: `offline-${shellyId}`,
                severity: 'warning',
                title: 'Device offline',
                sub: name
            });
        }

        const s = device.status;
        if (s) {
            // Warning: low battery (< 20%)
            const bat =
                s['devicepower:0']?.battery?.percent ??
                s['devicepower:1']?.battery?.percent;
            if (bat != null && bat < 20) {
                items.push({
                    key: `bat-low-${shellyId}`,
                    severity: 'warning',
                    title: `Battery ${bat}%`,
                    sub: name
                });
            } else if (bat != null && bat < 30) {
                items.push({
                    key: `bat-med-${shellyId}`,
                    severity: 'info',
                    title: `Battery ${bat}%`,
                    sub: name
                });
            }

            // Warning: poor signal (< −80 dBm)
            const rssi = s.wifi?.rssi;
            if (rssi != null && rssi < -80) {
                items.push({
                    key: `rssi-${shellyId}`,
                    severity: 'warning',
                    title: `Signal ${rssi} dBm`,
                    sub: name
                });
            }

            // Info: firmware update available
            const updates = s.sys?.available_updates;
            if (
                updates &&
                typeof updates === 'object' &&
                Object.keys(updates).length > 0
            ) {
                items.push({
                    key: `fw-${shellyId}`,
                    severity: 'info',
                    title: 'Firmware update available',
                    sub: name
                });
            }
        }
    }

    // Sort: critical first, then warning, then info
    const ORDER = {critical: 0, warning: 1, info: 2};
    items.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    return items;
});

const visibleItems = computed(() => {
    const max = props.config.maxItems ?? 20;
    return allItems.value
        .filter((i) => allowedSeverities.value.has(i.severity))
        .slice(0, max);
});

function severityIcon(sev: MlItem['severity']): string {
    if (sev === 'critical') return 'fas fa-circle-exclamation';
    if (sev === 'warning') return 'fas fa-triangle-exclamation';
    return 'fas fa-circle-info';
}
</script>

<style scoped>
.ml {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
}

.ml-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--color-success-text);
    font-size: var(--type-body);
    gap: var(--space-0-5);
}

.ml-list {
    flex: 1;
    overflow: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}

.ml-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1-5);
    border-radius: var(--radius-sm);
    border-left: 2px solid transparent;
}

.ml-item--critical {
    border-left-color: var(--color-danger-text);
    background: rgba(var(--color-danger-rgb), 0.07);
}

.ml-item--warning {
    border-left-color: var(--color-warning-text);
    background: rgba(var(--color-warning-rgb), 0.07);
}

.ml-item--info {
    border-left-color: var(--color-link);
    background: rgba(96, 165, 250, 0.07);
}

.ml-icon {
    font-size: var(--type-body);
    width: 12px;
    flex-shrink: 0;
}

.ml-item--critical .ml-icon { color: var(--color-danger-text); }
.ml-item--warning  .ml-icon { color: var(--color-warning-text); }
.ml-item--info     .ml-icon { color: var(--color-link); }

.ml-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.ml-title {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ml-sub {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
