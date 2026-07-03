<template>
    <BoardTabs
        v-if="group"
        :tabs="tabs"
        @back="rightSideStore.clearInspector()"
    >
        <template #title>
            <div class="gb-title">
                <span class="gb-title__name">{{ group.name }}</span>
                <GroupKindBadge :kind-id="group.kind" />
                <button type="button" class="gb-edit-btn" @click="editModalVisible = true">
                    Edit
                </button>
            </div>
        </template>

        <template #info>
            <div class="gb-info">
                <div class="gb-section-label">
                    {{ group.devices.length }} device{{ group.devices.length !== 1 ? 's' : '' }}
                </div>

                <div v-if="metadata.length" class="gb-section">
                    <div
                        v-for="[key, value] in metadata"
                        :key="key"
                        class="gb-meta-row"
                    >
                        <span class="gb-meta-row__key">{{ key }}</span>
                        <span class="gb-meta-row__value">{{ value }}</span>
                    </div>
                </div>

                <div v-if="subgroups.length" class="gb-section">
                    <div class="gb-section-label">Subgroups</div>
                    <button
                        v-for="sub in subgroups"
                        :key="sub.id"
                        type="button"
                        class="gb-list-item"
                        @click="openSubgroup(sub.id)"
                    >
                        <i class="fas fa-folder gb-list-item__icon" />
                        <span class="gb-list-item__name">{{ sub.name }}</span>
                        <span class="gb-list-item__count">{{ sub.devices.length }}</span>
                    </button>
                </div>

                <div class="gb-section">
                    <div class="gb-section-label">Devices</div>
                    <div v-if="!resolvedDevices.length" class="gb-empty">
                        No devices in this group
                    </div>
                    <button
                        v-for="dev in resolvedDevices"
                        :key="dev.shellyID"
                        type="button"
                        class="gb-list-item"
                        @click="openDevice(dev.shellyID)"
                    >
                        <img :src="getLogo(dev)" :alt="dev.shellyID" class="gb-device-img" loading="lazy" />
                        <span class="gb-list-item__name">{{ getDeviceName(dev.info, dev.shellyID) }}</span>
                        <span class="gb-dot" :class="dev.online ? 'gb-dot--on' : 'gb-dot--off'" />
                    </button>
                </div>
            </div>
        </template>

        <template #debug>
            <JSONViewer :data="group" />
        </template>
    </BoardTabs>

    <EditGroupModal
        v-model="editModalVisible"
        mode="edit"
        :group-id="groupId"
        @saved="onGroupSaved"
    />
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import GroupKindBadge from '@/components/core/GroupKindBadge.vue';
import JSONViewer from '@/components/core/JSONViewer.vue';
import {DeviceBoard, GroupBoard as GroupBoardAsync} from '@/helpers/components';
import {getDeviceName, getLogo} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useRightSideMenuStore} from '@/stores/right-side';
import EditGroupModal from '../modals/EditGroupModal.vue';
import BoardTabs from './BoardTabs.vue';

const props = defineProps<{
    groupId: number;
}>();

const groupStore = useGroupsStore();
const deviceStore = useDevicesStore();
const rightSideStore = useRightSideMenuStore();

const tabs = [{name: 'info', icon: 'fas fa-layer-group'}];
const editModalVisible = ref(false);

const group = computed(() => groupStore.groups[props.groupId]);

const metadata = computed(() => {
    if (!group.value?.metadata) return [];
    return Object.entries(group.value.metadata).filter(
        ([, v]) => v !== null && v !== undefined && v !== ''
    );
});

const subgroups = computed(() => {
    return Object.values(groupStore.groups).filter(
        (g) => g.parentGroupId === props.groupId
    );
});

const resolvedDevices = computed(() => {
    if (!group.value) return [];
    return group.value.devices
        .map((shellyID) => deviceStore.devices[shellyID])
        .filter(Boolean);
});

function openSubgroup(id: number) {
    rightSideStore.showInspector(GroupBoardAsync, {groupId: id});
}

async function onGroupSaved() {
    await groupStore.fetchGroup(props.groupId);
    await groupStore.fetchChildren(props.groupId);
}

function openDevice(shellyID: string) {
    rightSideStore.showInspector(DeviceBoard, {shellyID});
}

onMounted(() => {
    groupStore.fetchChildren(props.groupId);
});
</script>

<style scoped>
/* ── Title bar ── */
/* Name + kind badge cluster on the left; Edit pushed to the right via
   margin-left:auto. Replaces justify-content:space-between which
   distributed the badge between name and Edit. */
.gb-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
}

.gb-title__name {
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.gb-edit-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    color: var(--color-primary);
    background: none;
    border: none;
    cursor: pointer;
    transition: background var(--duration-fast);
}

.gb-edit-btn:hover {
    background: var(--color-surface-3);
}

/* Push Edit to the right end so name + kind badge cluster on the left. */
.gb-title .gb-edit-btn { margin-left: auto; }

/* ── Info panel ── */
.gb-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2);
}

.gb-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.gb-section-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    text-transform: none;
    letter-spacing: 0.05em;
    color: var(--color-text-disabled);
}

/* ── Metadata rows ── */
.gb-meta-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}

.gb-meta-row__key {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: capitalize;
}

.gb-meta-row__value {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}

/* ── List items (devices + subgroups) ── */
.gb-list-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    color: inherit;
    transition: background var(--duration-fast);
}

.gb-list-item:hover {
    background: var(--color-surface-3);
}

.gb-list-item__icon {
    color: var(--color-text-disabled);
    flex-shrink: 0;
}

.gb-list-item__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--type-body);
}

.gb-list-item__count {
    color: var(--color-text-disabled);
    font-size: var(--type-body);
    flex-shrink: 0;
}

.gb-device-img {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
}

/* ── Status dot ── */
.gb-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    transition: background var(--duration-normal);
}

.gb-dot--on {
    background: var(--color-status-on);
    box-shadow: 0 0 6px color-mix(in srgb, var(--color-status-on) 60%, transparent);
}

.gb-dot--off {
    background: var(--color-status-off);
    box-shadow: 0 0 6px color-mix(in srgb, var(--color-status-off) 50%, transparent);
}

/* ── Empty state ── */
.gb-empty {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    padding: var(--space-2) 0;
}
</style>
