<template>
    <Modal :visible="visible" wide @close="close">
        <template #title>
            <nav v-if="breadcrumbs.length > 1" class="breadcrumb">
                <template v-for="(crumb, i) in breadcrumbs" :key="crumb.id">
                    <span v-if="i > 0" class="breadcrumb-sep">/</span>
                    <button v-if="i < breadcrumbs.length - 1" type="button" class="breadcrumb-item" @click="navigateTo(crumb.id)">
                        {{ crumb.name }}
                    </button>
                    <span v-else class="breadcrumb-item active">{{ crumb.name }}</span>
                </template>
            </nav>
        </template>

        <template #default>
            <div v-if="group" class="gp">
                <!-- Hero: big picture + name + kind -->
                <header class="gp__hero">
                    <GroupGlyph :group="group" class="gp__hero-glyph" />
                    <div class="gp__hero-body">
                        <h2 class="gp__hero-name">{{ group.name }}</h2>
                        <span class="gp__hero-kind">{{ kindLabel || 'Group' }}</span>
                    </div>
                </header>

                <!-- Stats — live telemetry first, counts after. Only when the group has members. -->
                <div v-if="!isEmpty" class="gp__stats">
                    <div v-if="livePower != null" class="gp__stat gp__stat--metric">
                        <span class="gp__stat-num">{{ formatPower(livePower) }}</span>
                        <span class="gp__stat-label">power</span>
                    </div>
                    <div v-if="liveTemp != null" class="gp__stat gp__stat--metric">
                        <span class="gp__stat-num">{{ liveTemp.toFixed(1) }}°C</span>
                        <span class="gp__stat-label">avg temp</span>
                    </div>
                    <div v-if="openClosed.total > 0" class="gp__stat gp__stat--metric">
                        <span class="gp__stat-num">{{ openClosed.open }}<span class="gp__stat-den"> / {{ openClosed.total }}</span></span>
                        <span class="gp__stat-label">open</span>
                    </div>
                    <div v-if="liveHumidity != null" class="gp__stat gp__stat--metric">
                        <span class="gp__stat-num">{{ liveHumidity.toFixed(0) }}%</span>
                        <span class="gp__stat-label">avg humidity</span>
                    </div>
                    <div v-if="motionDetected > 0" class="gp__stat gp__stat--metric">
                        <span class="gp__stat-num">{{ motionDetected }}</span>
                        <span class="gp__stat-label">motion</span>
                    </div>
                    <div v-if="batteryLow > 0" class="gp__stat gp__stat--warn">
                        <span class="gp__stat-num">{{ batteryLow }}</span>
                        <span class="gp__stat-label">low battery</span>
                    </div>
                    <div v-if="activeAlarms > 0" class="gp__stat gp__stat--alarm">
                        <span class="gp__stat-num">{{ activeAlarms }}</span>
                        <span class="gp__stat-label">alarm{{ activeAlarms === 1 ? '' : 's' }}</span>
                    </div>

                    <div
                        v-if="totalUnits > 0"
                        class="gp__stat"
                        :title="totalEntityCount > 0 ? 'BLE devices proxy through their gateway' : ''"
                    >
                        <span class="gp__stat-num">{{ onlineCount }}<span class="gp__stat-den"> / {{ totalUnits }}</span></span>
                        <span class="gp__stat-label">online</span>
                    </div>
                    <div v-if="totalEntityCount > 0" class="gp__stat">
                        <span class="gp__stat-num">{{ totalEntityCount }}</span>
                        <span class="gp__stat-label">BLE</span>
                    </div>
                    <div v-if="totalSubgroupCount > 0" class="gp__stat">
                        <span class="gp__stat-num">{{ totalSubgroupCount }}</span>
                        <span class="gp__stat-label">subgroup{{ totalSubgroupCount === 1 ? '' : 's' }}</span>
                    </div>
                </div>
                <div v-if="!isEmpty && liveMetricsError" class="gp__unresolved">
                    Live metrics unavailable — {{ liveMetricsError }}
                </div>

                <!-- Metadata — near name, describes identity -->
                <div v-if="metadataEntries.length > 0" class="gp__meta">
                    <div class="gp__meta-label"><i class="fas fa-tags" /> Metadata</div>
                    <div class="gp__meta-chips">
                        <div v-for="[key, value] in metadataEntries" :key="key" class="gp__meta-chip">
                            <span class="gp__meta-chip-key">{{ key }}</span>
                            <span class="gp__meta-chip-val">{{ value }}</span>
                        </div>
                    </div>
                </div>

                <!-- Subgroups -->
                <section v-if="childGroups.length > 0" class="gp__section">
                    <div class="dc-section">
                        <span class="dc-section-dot" style="background: var(--color-primary)" />
                        Subgroups
                        <span class="gp__sec-count">{{ childGroups.length }}</span>
                    </div>
                    <div class="dc-grid">
                        <button
                            v-for="child in childGroups"
                            :key="`sg-${child.id}`"
                            type="button"
                            class="gp__folder-card"
                            @click="navigateTo(child.id)"
                        >
                            <div class="gp__folder-icon"><i class="fas fa-folder" /></div>
                            <div class="gp__folder-name">{{ child.name }}</div>
                            <div class="gp__folder-count">{{ child.devices?.length ?? 0 }} devices</div>
                            <i class="fas fa-chevron-right gp__folder-arrow" />
                        </button>
                    </div>
                </section>

                <!-- Devices — online first, split like the devices tab -->
                <section v-if="resolvedDevices.length > 0" class="gp__section">
                    <template v-if="onlineDevices.length > 0">
                        <div class="dc-section">
                            <span class="dc-section-dot" style="background: var(--color-status-on)" />
                            Online
                            <span class="gp__sec-count">{{ onlineDevices.length }}</span>
                        </div>
                        <div class="dc-grid">
                            <DeviceFleetCard
                                v-for="dev in onlineDevices"
                                :key="dev.shellyID"
                                :device="dev"
                                @select="openDevice(dev.shellyID)"
                            />
                        </div>
                    </template>
                    <template v-if="offlineDevices.length > 0">
                        <div class="dc-section">
                            <span class="dc-section-dot" style="background: var(--color-status-off)" />
                            Offline
                            <span class="gp__sec-count">{{ offlineDevices.length }}</span>
                        </div>
                        <div class="dc-grid">
                            <DeviceFleetCard
                                v-for="dev in offlineDevices"
                                :key="dev.shellyID"
                                :device="dev"
                                @select="openDevice(dev.shellyID)"
                            />
                        </div>
                    </template>
                </section>

                <div v-if="unresolvedCount > 0" class="gp__unresolved">
                    {{ unresolvedCount }} device{{ unresolvedCount === 1 ? '' : 's' }} not available
                </div>

                <div v-if="isEmpty" class="gp__empty">
                    <i class="fas fa-box-open gp__empty-icon" />
                    <p class="gp__empty-text">This group has no devices yet.</p>
                    <Button v-if="canWrite" type="blue-hollow" size="sm" @click="openEdit">
                        Add devices
                    </Button>
                </div>
            </div>
        </template>

        <template #footer>
            <div class="gp__footer">
                <Button v-if="canWrite" type="red" size="sm" @click="confirmDelete">
                    Delete
                </Button>
                <div class="gp__footer-spacer" />
                <Button type="blue-hollow" size="sm" @click="openEdit">
                    Edit
                </Button>
            </div>
        </template>
    </Modal>

    <ConfirmationModal ref="deleteConfirmRef">
        <template #title><h3>Delete "{{ group?.name }}"?</h3></template>
        <template v-if="deletingChildCount > 0" #subText>
            <p class="gpm-delete-warn"><i class="fas fa-exclamation-triangle" /> This group has {{ deletingChildCount }} direct subgroup{{ deletingChildCount === 1 ? '' : 's' }}. Delete the child groups first.</p>
        </template>
    </ConfirmationModal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';
import Button from '@/components/core/Button.vue';
import GroupGlyph from '@/components/core/GroupGlyph.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import {useGroupKinds} from '@/composables/useGroupKinds';
import {useGroupLiveMetrics} from '@/composables/useGroupLiveMetrics';
import {formatPower, useGroupStats} from '@/composables/useGroupStats';
import {useChildGroups, useGroupBreadcrumbs} from '@/composables/useGroupTree';
import {usePermissions} from '@/composables/usePermissions';
import {DeviceBoard} from '@/helpers/components';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';

const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    groupId: number;
}>();

const emit = defineEmits<{
    edit: [groupId: number];
    deleted: [];
}>();

const groupStore = useGroupsStore();
const devicesStore = useDevicesStore();
const rightSideStore = useRightSideMenuStore();
const toast = useToastStore();
const {canWrite} = usePermissions();

const currentGroupId = defineModel<number>('currentGroupId', {required: false});
const deleteConfirmRef = ref<InstanceType<typeof ConfirmationModal>>();

const activeId = computed(() => currentGroupId.value ?? props.groupId);
const group = computed(() => groupStore.groups[activeId.value]);

// Kind as plain text (no icon), consistent with the group card.
const {byId: groupKindsById, ensureLoaded: ensureGroupKinds} = useGroupKinds();
void ensureGroupKinds();
const kindLabel = computed(() => {
    const id = group.value?.kind;
    if (!id || id === 'manual') return '';
    return groupKindsById.value.get(id)?.displayName ?? id;
});

const childGroups = useChildGroups(activeId);

// ── Direct devices (this group only, for the device card grid) ──
const directDeviceIds = computed(() => group.value?.devices ?? []);

const resolvedDevices = computed(() =>
    directDeviceIds.value
        .map((shellyID: string) => devicesStore.devices[shellyID])
        .filter(Boolean)
);

const unresolvedCount = computed(
    () => directDeviceIds.value.length - resolvedDevices.value.length
);

// ── Recursive stats (shared composable) ──
const {
    allDeviceIds,
    totalDeviceCount,
    totalEntityCount,
    totalSubgroupCount,
    onlineCount,
    offlineCount,
    openClosed,
    activeAlarms,
    motionDetected,
    batteryLow
} = useGroupStats(activeId);

// Live power/temperature/humidity come from the backend aggregate (full status),
// not the slim device store — otherwise the sum misses most devices.
const {
    totalPower: livePower,
    avgTemperature: liveTemp,
    avgHumidity: liveHumidity,
    error: liveMetricsError
} = useGroupLiveMetrics(activeId);

const metadataEntries = computed(() => {
    const meta = group.value?.metadata;
    if (!meta || typeof meta !== 'object') return [];
    return Object.entries(meta).filter(([, v]) => v != null && v !== '');
});

// Empty = nothing to show; skip the "0 devices / 0 of 0 online" noise.
const isEmpty = computed(
    () =>
        childGroups.value.length === 0 &&
        resolvedDevices.value.length === 0 &&
        directDeviceIds.value.length === 0
);
const onlineDevices = computed(() =>
    resolvedDevices.value.filter((d) => d.online)
);
const offlineDevices = computed(() =>
    resolvedDevices.value.filter((d) => !d.online)
);
const totalUnits = computed(
    () => totalDeviceCount.value + totalEntityCount.value
);

// ── Breadcrumbs (shared composable) ──
const breadcrumbs = useGroupBreadcrumbs(activeId);

// ── Actions ──

function navigateTo(id: number) {
    currentGroupId.value = id;
    groupStore.fetchChildren(id);
}

function openEdit() {
    visible.value = false;
    emit('edit', activeId.value);
}

function openDevice(shellyID: string) {
    visible.value = false;
    rightSideStore.showInspector(DeviceBoard, {shellyID});
}

function close() {
    visible.value = false;
}

async function performDelete() {
    try {
        await groupStore.deleteGroup(activeId.value);
        toast.info(`Group '${group.value?.name}' deleted.`);
        visible.value = false;
        emit('deleted');
    } catch (err: any) {
        toast.error(err?.message ?? 'Failed to delete group');
    }
}

const deletingChildCount = computed(() => {
    const id = activeId.value;
    if (id == null) return 0;
    return Object.values(groupStore.groups).filter(
        (g) => g.parentGroupId === id
    ).length;
});

function confirmDelete() {
    deleteConfirmRef.value?.storeAction(performDelete);
}

// ── Fetch children on open/navigate ──
watch(
    () => activeId.value,
    (id) => {
        if (id != null) groupStore.fetchChildren(id);
    },
    {immediate: true}
);
</script>

<style scoped>
.gp {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

/* ── Breadcrumbs ── */
.breadcrumb { display: flex; align-items: center; gap: var(--space-2); font-size: var(--type-body); font-weight: 600; min-height: 34px; }
.breadcrumb-sep { color: var(--color-text-disabled); font-weight: 400; }
.breadcrumb-item {
    background: none; border: none; padding: 0; font: inherit;
    color: var(--color-text-tertiary); cursor: pointer; transition: color var(--duration-fast);
}
.breadcrumb-item:hover { color: var(--color-primary); }
.breadcrumb-item.active { color: var(--color-text-primary); font-weight: 800; cursor: default; font-size: var(--type-subheading); }

/* ── Hero: picture + name + kind ── */
.gp__hero {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}
.gp__hero-glyph {
    width: 72px;
    height: 72px;
    font-size: 2.6rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-primary);
}
.gp__hero-glyph :deep(.gg--image) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: var(--radius-lg);
}
.gp__hero-body { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.gp__hero-name {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: 800;
    color: var(--color-text-primary);
    letter-spacing: -0.4px;
}
.gp__hero-kind {
    align-self: flex-start;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 28%, transparent);
    color: var(--color-primary);
    font-size: var(--type-caption);
    font-weight: 700;
}

/* ── Stat tiles ── */
.gp__stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
}
.gp__stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
    min-width: 5.5rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
}
.gp__stat-num {
    font-size: var(--type-subheading);
    font-weight: 800;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
}
.gp__stat-den { font-size: var(--type-body); font-weight: 600; color: var(--color-text-tertiary); }
.gp__stat-label {
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
/* Live telemetry (power, energy, open/closed, …) leads in the accent colour. */
.gp__stat--metric {
    border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border-default));
}
.gp__stat--metric .gp__stat-num { color: var(--color-primary); }
.gp__stat--warn {
    border-color: color-mix(in srgb, var(--color-warning-text) 35%, var(--color-border-default));
}
.gp__stat--warn .gp__stat-num { color: var(--color-warning-text); }
.gp__stat--alarm {
    border-color: color-mix(in srgb, var(--color-danger-text) 45%, var(--color-border-default));
    background: color-mix(in srgb, var(--color-danger-text) 8%, var(--color-surface-1));
}
.gp__stat--alarm .gp__stat-num { color: var(--color-danger-text); }

/* ── Section header (reuses .dc-section) ── */
.gp__section { display: flex; flex-direction: column; gap: var(--space-3); }
.gp__sec-count {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-quaternary);
    font-variant-numeric: tabular-nums;
}

/* ── Folder cards ── */
.gp__folder-card {
    height: var(--grid-cell, 200px);
    min-height: var(--grid-cell, 200px);
    border-radius: var(--radius-card);
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-primary) 15%, transparent);
    background: linear-gradient(135deg, var(--color-surface-3) 0%, var(--color-surface-1) 100%);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-5);
    text-align: center;
    font: inherit;
    color: inherit;
    position: relative;
    box-shadow:
        0 1px 3px rgba(0, 0, 0, 0.3),
        0 8px 21px rgba(var(--color-primary-rgb), 0.08),
        0 0 0 0 transparent;
    transition: all var(--duration-fast);
}
.gp__folder-card:hover {
    border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
    box-shadow:
        0 1px 3px rgba(0, 0, 0, 0.3),
        0 13px 34px rgba(var(--color-primary-rgb), 0.15),
        0 -2px 8px rgba(var(--color-primary-rgb), 0.05);
    transform: translateY(-2px);
}
.gp__folder-card:active { transform: scale(0.98); }
.gp__folder-icon {
    width: 55px;
    height: 55px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary);
    font-size: var(--type-subheading);
}
.gp__folder-name {
    font-size: var(--type-body); font-weight: 800; letter-spacing: -0.4px;
    color: var(--color-text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
}
.gp__folder-count { font-size: var(--type-body); font-weight: 600; color: var(--color-text-tertiary); }
.gp__folder-arrow {
    position: absolute; bottom: var(--space-3); right: var(--space-3);
    font-size: var(--type-body); color: var(--color-text-disabled); opacity: 0.4;
}

/* ── States ── */
.gp__unresolved { font-size: var(--type-body); color: var(--color-text-disabled); padding: var(--space-2) 13px; }
.gp__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8) 0;
    text-align: center;
}
.gp__empty-icon { font-size: var(--type-heading); color: var(--color-text-disabled); }
.gp__empty-text { margin: 0; font-size: var(--type-body); color: var(--color-text-tertiary); }

/* ── Metadata ── */
.gp__meta { display: flex; flex-direction: column; gap: var(--space-2); }
.gp__meta-label {
    font-size: var(--type-body); font-weight: 700; color: var(--color-text-tertiary);
    display: flex; align-items: center; gap: var(--space-2);
}
.gp__meta-label i { color: var(--color-primary); opacity: 0.7; }
.gp__meta-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.gp__meta-chip {
    display: inline-flex; align-items: center;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-medium);
    overflow: hidden; font-size: var(--type-body);
}
.gp__meta-chip-key {
    padding: var(--space-2) var(--space-3); background: var(--color-surface-3);
    font-weight: 700; color: var(--color-text-tertiary);
}
.gp__meta-chip-val { padding: var(--space-2) 13px; font-weight: 600; color: var(--color-text-primary); }

/* ── Footer — delete left, actions right ── */
.gp__footer { display: flex; align-items: center; gap: var(--space-2); }
.gp__footer-spacer { flex: 1; }
.gpm-delete-warn {
    font-size: var(--type-body); color: var(--color-warning-text); font-weight: 600;
    display: flex; align-items: center; gap: var(--gap-xs);
}
</style>
