<template>
    <div class="space-y-4">
        <div class="flex flex-row items-center justify-between">
            <span class="font-semibold"> Selected: {{ selected.length }}</span>
            <Input v-model="filter" placeholder="search" />
        </div>
        <div class="flex flex-row items-center justify-between">
            <Button size="sm" @click="selectAll">Select All</Button>
            <Button :type="hasFiltersFromModal ? 'red' : 'blue'" size="sm" narrow @click="filterVisible = true">
                <i class="fas fa-filter" />
            </Button>
            <Button size="sm" @click="selected.length = 0">Unselect All</Button>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div v-for="device in filteredDevices" :key="device.shellyID">
                <div
                    class="p-3 flex flex-row gap-2 items-center rounded-lg bg-[var(--color-surface-1)] border-[var(--color-primary)] shadow-[var(--color-primary)] hover:cursor-pointer"
                    :class="[selected.includes(device.shellyID) && 'border shadow-md']"
                    @click="deviceClicked(device.shellyID)"
                >
                    <input type="checkbox" class="" :checked="selected.includes(device.shellyID)" :aria-label="`Select ${device.name}`" />
                    <img :src="device.picture_url" class="w-8 h-8 bg-[var(--color-surface-2)] rounded-full" loading="lazy" decoding="async" :alt="device.name || 'Device'" />
                    <span class="text-sm line-clamp-2">
                        {{ device.name }}
                    </span>
                </div>
            </div>
        </div>
    </div>
    <DeviceFilter
        v-model="filterVisible"
        :filters="activeFilterPills"
        :key="JSON.stringify(activeFilterPills)"
        @setFilters="setActiveFilters"
        @devices="setDevices"
    />
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, shallowRef} from 'vue';
import DeviceFilter from '@/components/pages/devices/DeviceFilterActions.vue';
import {getDeviceName, getLogo} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import type {shelly_device_t} from '@/types';
import Button from './core/Button.vue';
import Input from './core/Input.vue';

const filterVisible = ref(false);
const hasFiltersFromModal = computed(
    () => devices.value.length !== filteredDevices.value.length
);

const defaultFilters = {type: 'All devices', group: 'All groups'};
const activeFilterPills = reactive({...defaultFilters});

const selected = defineModel<string[]>({required: true});
const devicesStore = useDevicesStore();

const devices = shallowRef<
    Array<{
        shellyID: string;
        name: string;
        picture_url: string;
    }>
>([]);

const filter = ref('');
const filteredDevices = computed(() => {
    return devices.value.filter((dev) => dev.name.includes(filter.value));
});

function deviceClicked(shellyID: string) {
    if (selected.value.includes(shellyID)) {
        selected.value.splice(selected.value.indexOf(shellyID), 1);
    } else {
        selected.value.push(shellyID);
    }
}

function selectAll() {
    for (const dev of filteredDevices.value) {
        if (!selected.value.includes(dev.shellyID)) {
            selected.value.push(dev.shellyID);
        }
    }
}

onMounted(() => {
    devices.value = Object.values(devicesStore.devices).map((dev) => {
        return {
            shellyID: dev.shellyID,
            name: getDeviceName(dev.info, dev.shellyID),
            info: dev.info,
            picture_url: getLogo(dev)
        };
    });
});

function setActiveFilters(filters: typeof activeFilterPills) {
    Object.assign(activeFilterPills, filters);
}

function setDevices(filteredShellyDevices: shelly_device_t[]) {
    devices.value = filteredShellyDevices.map((dev) => ({
        shellyID: dev.shellyID,
        name: getDeviceName(dev.info, dev.shellyID),
        picture_url: getLogo(dev)
    }));
}
</script>
