<template>
  <Modal :visible="visible" compact @close="visible = false">
    <template #title>Filters</template>
    <div class="space-y-4">
      <div>
        <h3 class="heading-card">Online state</h3>
        <Dropdown
          :options="['All', 'Online', 'Offline']"
          :icons="['', 'fa-wifi', 'fa-wifi-slash']"
          :default="defaultOnlineLabel"
          :toDefault="visible"
          @selected="onlineFilterSelected"
        />
      </div>

      <hr class="my-4" />

      <div>
        <h3 class="heading-card">Type</h3>
        <Dropdown
          :options="entityTypes"
          :icons="entityTypeIcons"
          :default="typeFilter"
          :toDefault="visible"
          @selected="(val) => typeFilter = val"
        />
      </div>

      <hr class="my-4" />

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
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Modal from '@/components/modals/Modal.vue';
import {useEntityFiltering} from '@/composables/useEntityFiltering';
import {useEntityStore} from '@/stores/entities';
import type {entity_t} from '@/types';

const props = withDefaults(
    defineProps<{
        filters?: {online: boolean | null; type: string};
    }>(),
    {
        filters: () => ({online: null, type: 'All entities'})
    }
);

const emit = defineEmits<{
    (e: 'entities', entities: entity_t[]): void;
    (e: 'setFilters', filters: {online: boolean | null; type: string}): void;
}>();

const visible = defineModel<boolean>({required: true});

const onlineFilter = ref<boolean | null>(props.filters.online);
const typeFilter = ref<string>(props.filters.type);

const entityTypes = [
    'All entities',
    'Switch',
    'Light',
    'Input',
    'Temperature',
    'Energy Meter',
    'BLU Sensor',
    'Virtual Component'
];

const entityTypeIcons = [
    '',
    'fa-microchip',
    'fa-power-off',
    'fa-power-off',
    'fa-arrow-right',
    'fa-thermometer-half',
    'fa-bolt',
    'fa-vr-cardboard'
];

const defaultOnlineLabel = computed<string>(() =>
    onlineFilter.value === true
        ? 'Online'
        : onlineFilter.value === false
          ? 'Offline'
          : 'All'
);

watch(
    () => props.filters,
    (f) => {
        onlineFilter.value = f.online;
        typeFilter.value = f.type;
    },
    {deep: true}
);

function onlineFilterSelected(val: string) {
    if (val === 'Online') onlineFilter.value = true;
    else if (val === 'Offline') onlineFilter.value = false;
    else onlineFilter.value = null;
}

function applyClicked() {
    const entityStore = useEntityStore();
    const {filtered} = useEntityFiltering(Object.values(entityStore.entities), {
        online: onlineFilter.value,
        type: typeFilter.value
    });
    emit('entities', filtered.value);
    emit('setFilters', {
        online: onlineFilter.value,
        type: typeFilter.value
    });
    visible.value = false;
}

function clearFilters() {
    onlineFilter.value = null;
    typeFilter.value = 'All entities';
    const entityStore = useEntityStore();
    emit('entities', Object.values(entityStore.entities));
    emit('setFilters', {
        online: onlineFilter.value,
        type: typeFilter.value
    });
    visible.value = false;
}
</script>

<style scoped>
:deep(.relative.inline-block) {
    width: 100%;
}
</style>
