<template>
    <div class="flex h-full min-h-0 flex-col gap-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex items-center gap-2">
                <span class="font-semibold">Selected</span>
                <span class="inline-flex min-w-8 justify-center rounded-full bg-[var(--color-primary)] px-2 py-1 text-xs font-semibold text-white">
                    {{ selected.length }}
                </span>
            </div>
            <Input v-model="filter" placeholder="Search devices" class="w-full lg:max-w-md" />
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap gap-2">
                <Button size="sm" @click="selectAll">Select all visible</Button>
                <Button size="sm" @click="selected.length = 0">Clear selection</Button>
            </div>
            <Button :type="hasFiltersFromModal ? 'red' : 'blue'" size="sm" narrow @click="filterVisible = true">
                <i class="fas fa-filter mr-2" />
                Filters
            </Button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto pr-1">
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                <button
                    v-for="device in filteredDevices"
                    :key="device.shellyID"
                    type="button"
                    class="device-option w-full rounded-xl border p-3 text-left transition-all"
                    :class="{ 'device-option--selected': selected.includes(device.shellyID) }"
                    :aria-pressed="selected.includes(device.shellyID)"
                    :aria-label="`Select ${device.name}`"
                    @click="deviceClicked(device.shellyID)"
                >
                    <div class="flex items-center gap-3">
                        <img :src="device.picture_url" class="w-10 h-10 bg-[var(--color-surface-2)] rounded-full shrink-0" loading="lazy" decoding="async" :alt="device.name || 'Device'" />
                        <div class="min-w-0 flex-1">
                            <div class="font-semibold text-sm line-clamp-2">{{ device.name }}</div>
                            <div class="text-xs text-[var(--color-text-tertiary)] truncate">{{ device.shellyID }}</div>
                        </div>
                        <div
                            class="device-option__indicator shrink-0 flex h-7 w-7 items-center justify-center rounded-full border"
                            :class="{ 'device-option__indicator--selected': selected.includes(device.shellyID) }"
                        >
                            <i v-if="selected.includes(device.shellyID)" class="fas fa-check text-xs" />
                        </div>
                    </div>
                </button>
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

<style scoped>
.device-option {
    background-color: var(--color-surface-1);
    border-color: var(--color-border-default);
    min-height: 5.25rem;
}

.device-option:hover {
    border-color: var(--color-primary);
    box-shadow: var(--shadow-md);
}

.device-option--selected {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-1));
    box-shadow: 0 0 0 1px var(--color-primary), var(--shadow-primary);
}

.device-option__indicator {
    border-color: var(--color-border-default);
    color: var(--color-text-tertiary);
}

.device-option__indicator--selected {
    border-color: var(--color-primary);
    background-color: var(--color-primary);
    color: white;
}
</style>
