<template>
  <Modal :visible="visible" compact @close="visible = false">
    <template #title>Filters</template>
    <div class="space-y-4">
      <hr class="my-4"/>
      <div>
        <h3 class="heading-card">Type</h3>
        <Dropdown
          :options="allDeviceTypes"
          :default="typeFilter"
          :toDefault="visible"
          @selected="val => typeFilter = val"
        />
      </div>
      <hr class="my-4"/>
      <div>
        <h3 class="heading-card">Group</h3>
        <Dropdown
          :options="allGroups"
          :default="groupFilter"
          :toDefault="visible"
          @selected="val => groupFilter = val"
        />
      </div>
      <hr class="my-4"/>
      <Button narrow type="red" class="w-full" @click="clearFilters">
        Clear filters
      </Button>
    </div>
    <template #footer>
      <div class="flex flex-row-reverse gap-2">
        <Button @click="applyClicked">Apply</Button>
        <Button type="red" @click="visible = false">Cancel</Button>
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

const props = withDefaults(
    defineProps<{
        filters?: {type: string; group: string};
    }>(),
    {
        filters: () => ({type: 'All devices', group: 'All groups'})
    }
);

const emit = defineEmits<{
    (e: 'devices', devices: shelly_device_t[]): void;
    (e: 'setFilters', filters: {type: string; group: string}): void;
}>();

const visible = defineModel<boolean>({required: true});

const deviceStore = useDevicesStore();
const {devices} = storeToRefs(deviceStore);
const groupStore = useGroupsStore();
const {groups} = storeToRefs(groupStore);

const allDeviceTypes = shallowRef<string[]>([]);
const allGroups = shallowRef<string[]>([]);

const typeFilter = ref<string>(props.filters.type);
const groupFilter = ref<string>(props.filters.group);

watch(
    () => props.filters,
    (f) => {
        typeFilter.value = f.type;
        groupFilter.value = f.group;
    },
    {deep: true}
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
});

function applyClicked() {
    const {filtered} = useDeviceFiltering(Object.values(devices.value), {
        online: null,
        type: typeFilter.value,
        group: groupFilter.value
    });
    emit('devices', filtered.value);
    emit('setFilters', {
        type: typeFilter.value,
        group: groupFilter.value
    });
    visible.value = false;
}

function clearFilters() {
    typeFilter.value = 'All devices';
    groupFilter.value = 'All groups';
    emit('devices', Object.values(devices.value));
    emit('setFilters', {
        type: typeFilter.value,
        group: groupFilter.value
    });
    visible.value = false;
}
</script>

<style scoped>
:deep(.relative.inline-block) {
    width: 100%;
}
</style>
