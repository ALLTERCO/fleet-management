<template>
  <Modal :visible="visible" compact @close="visible = false">
    <template #title>Filters & Sorting</template>
    <div class="space-y-4">
      <!-- Sort By -->
      <div class="filter-section">
        <div class="filter-section__header">
          <i class="fas fa-arrow-down-a-z filter-section__icon" />
          <span class="heading-label">Sort by</span>
        </div>
        <Dropdown
          :options="sortLabels"
          :icons="sortIcons"
          :default="currentSortLabel"
          :toDefault="visible"
          @selected="onSortSelected"
        />
      </div>

      <hr />

      <!-- Status -->
      <div class="filter-section">
        <div class="filter-section__header">
          <i class="fas fa-wifi filter-section__icon" />
          <span class="heading-label">Status</span>
        </div>
        <Dropdown
          :options="statusLabels"
          :icons="statusIcons"
          :default="currentStatusLabel"
          :toDefault="visible"
          @selected="onStatusSelected"
        />
      </div>

      <hr />

      <!-- Device Type -->
      <div class="filter-section">
        <div class="filter-section__header">
          <i class="fas fa-microchip filter-section__icon" />
          <span class="heading-label">Device Type</span>
        </div>
        <Dropdown
          :options="allDeviceTypes"
          :default="typeFilter"
          :toDefault="visible"
          searchable
          @selected="val => typeFilter = val"
        />
      </div>

      <hr />

      <!-- Group -->
      <div class="filter-section">
        <div class="filter-section__header">
          <i class="fas fa-layer-group filter-section__icon" />
          <span class="heading-label">Group</span>
        </div>
        <Dropdown
          :options="allGroups"
          :default="groupFilter"
          :toDefault="visible"
          searchable
          @selected="val => groupFilter = val"
        />
      </div>
    </div>
    <template #footer>
      <div class="flex items-center gap-3">
        <Button type="red" class="flex-1" @click="clearFilters">
          <i class="fas fa-xmark" /> Clear all
        </Button>
        <Button class="flex-1" @click="applyClicked">
          <i class="fas fa-check" /> Apply
        </Button>
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, ref, shallowRef, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Modal from '@/components/modals/Modal.vue';
import {useDeviceFiltering} from '@/composables/useDeviceFiltering';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import type {shelly_device_t} from '@/types';

type SortMode = 'online-az' | 'az' | 'za' | 'offline-first';

const sortMap: {value: SortMode; label: string; icon: string}[] = [
    {value: 'online-az', label: 'Online first (A-Z)', icon: 'fa-arrow-up-wide-short'},
    {value: 'az', label: 'Name (A-Z)', icon: 'fa-arrow-down-a-z'},
    {value: 'za', label: 'Name (Z-A)', icon: 'fa-arrow-up-z-a'},
    {value: 'offline-first', label: 'Offline first (A-Z)', icon: 'fa-arrow-down-wide-short'}
];
const sortLabels = sortMap.map(s => s.label);
const sortIcons = sortMap.map(s => s.icon);

const statusMap: {label: string; value: boolean | null; icon: string}[] = [
    {label: 'All', value: null, icon: 'fa-circle-dot'},
    {label: 'Online', value: true, icon: 'fa-wifi'},
    {label: 'Offline', value: false, icon: 'fa-wifi-slash'}
];
const statusLabels = statusMap.map(s => s.label);
const statusIcons = statusMap.map(s => s.icon);

const props = withDefaults(
    defineProps<{
        filters?: {online: boolean | null; type: string; group: string};
        sortMode?: SortMode;
    }>(),
    {
        filters: () => ({
            online: null,
            type: 'All devices',
            group: 'All groups'
        }),
        sortMode: 'online-az'
    }
);

const emit = defineEmits<{
    (e: 'devices', devices: shelly_device_t[]): void;
    (e: 'setFilters', filters: {online: boolean | null; type: string; group: string}): void;
    (e: 'updateSort', mode: SortMode): void;
}>();

const visible = defineModel<boolean>({required: true});

const deviceStore = useDevicesStore();
const {devices} = storeToRefs(deviceStore);
const groupStore = useGroupsStore();
const {groups} = storeToRefs(groupStore);

const allDeviceTypes = shallowRef<string[]>([]);
const allGroups = shallowRef<string[]>([]);

const onlineFilter = ref<boolean | null>(props.filters.online);
const typeFilter = ref<string>(props.filters.type);
const groupFilter = ref<string>(props.filters.group);
const localSort = ref<SortMode>(props.sortMode);

const currentSortLabel = computed(() =>
    sortMap.find(s => s.value === localSort.value)?.label ?? sortLabels[0]
);

const currentStatusLabel = computed(() =>
    statusMap.find(s => s.value === onlineFilter.value)?.label ?? 'All'
);

function onSortSelected(label: string) {
    const entry = sortMap.find(s => s.label === label);
    if (entry) localSort.value = entry.value;
}

function onStatusSelected(label: string) {
    const entry = statusMap.find(s => s.label === label);
    if (entry) onlineFilter.value = entry.value;
}

watch(
    () => props.filters,
    (f) => {
        onlineFilter.value = f.online;
        typeFilter.value = f.type;
        groupFilter.value = f.group;
    },
    {deep: true}
);

watch(
    () => props.sortMode,
    (s) => { localSort.value = s; }
);

function gatherAllDeviceTypes() {
    const set = new Set<string>(['All devices']);
    Object.values(devices.value).forEach((d) => {
        if (d.info?.app) set.add(d.info.app);
    });
    return Array.from(set);
}

watch(visible, (v) => {
    if (!v) return;
    allDeviceTypes.value = gatherAllDeviceTypes();
    allGroups.value = [
        'All groups',
        ...Object.values(groups.value).map((g) => g.name)
    ];
    onlineFilter.value = props.filters.online;
    typeFilter.value = props.filters.type;
    groupFilter.value = props.filters.group;
    localSort.value = props.sortMode;
});

function applyClicked() {
    const {filtered} = useDeviceFiltering(Object.values(devices.value), {
        online: onlineFilter.value,
        type: typeFilter.value,
        group: groupFilter.value
    });
    emit('devices', filtered.value);
    emit('setFilters', {
        online: onlineFilter.value,
        type: typeFilter.value,
        group: groupFilter.value
    });
    emit('updateSort', localSort.value);
    visible.value = false;
}

function clearFilters() {
    onlineFilter.value = null;
    typeFilter.value = 'All devices';
    groupFilter.value = 'All groups';
    localSort.value = 'online-az';
    emit('devices', Object.values(devices.value));
    emit('setFilters', {
        online: onlineFilter.value,
        type: typeFilter.value,
        group: groupFilter.value
    });
    emit('updateSort', localSort.value);
    visible.value = false;
}
</script>

<style scoped>
.filter-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.filter-section__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.filter-section__icon {
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
}
:deep(.relative.inline-block) {
    width: 100%;
}
</style>
