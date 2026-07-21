<template>
    <div class="ds">
        <!-- Search bar + filter + select/deselect -->
        <div class="ds-bar">
            <div class="ds-search">
                <Input v-model="filter" placeholder="Search devices..." class="ds-search-input" />
                <button type="button" class="ds-filter-btn" :class="{'ds-filter-btn--active': hasFiltersFromModal}" @click="filterVisible = true" title="Filters">
                    <i class="fas fa-filter" />
                </button>
            </div>
            <div class="ds-actions">
                <Button type="blue-hollow" size="sm" @click="selectAll">Select all</Button>
                <Button type="blue-hollow" size="sm" @click="selected.length = 0">Deselect</Button>
                <span class="ds-count">{{ selected.length }} selected</span>
            </div>
        </div>
        <!-- Device grid — online first, then offline, with a divider -->
        <div class="ds-grid-wrap">
            <template v-if="onlineDevices.length > 0">
                <div class="ds-group">
                    <span class="ds-status-dot ds-status-dot--online" />
                    Online · {{ onlineDevices.length }}
                </div>
                <div class="dc-grid">
                    <DeviceFleetCard
                        v-for="device in onlineDevices"
                        :key="device.shellyID"
                        :device="getStoreDevice(device.shellyID)"
                        :selected="selected.includes(device.shellyID)"
                        @select="deviceClicked(device.shellyID)"
                    />
                </div>
            </template>

            <hr
                v-if="onlineDevices.length > 0 && offlineDevices.length > 0"
                class="ds-separator"
            />

            <template v-if="offlineDevices.length > 0">
                <div class="ds-group">
                    <span class="ds-status-dot ds-status-dot--offline" />
                    Offline · {{ offlineDevices.length }}
                </div>
                <div class="dc-grid">
                    <DeviceFleetCard
                        v-for="device in offlineDevices"
                        :key="device.shellyID"
                        :device="getStoreDevice(device.shellyID)"
                        :selected="selected.includes(device.shellyID)"
                        @select="deviceClicked(device.shellyID)"
                    />
                </div>
            </template>
        </div>
    </div>
    <DeviceFilter
        v-model="filterVisible"
        :filters="activeFilterPills"
        :key="`${activeFilterPills.type}|${activeFilterPills.group}`"
        @setFilters="setActiveFilters"
        @devices="setDevices"
    />
</template>

<script setup lang="ts">
import {computed, reactive, ref} from 'vue';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';
import DeviceFilter from '@/components/pages/devices/DeviceFilterActions.vue';
import {deviceMatchesQuery, getDeviceName} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import type {shelly_device_t} from '@/types';
import Button from './Button.vue';
import Input from './Input.vue';

const filterVisible = ref(false);

const defaultFilters = {type: 'All devices', group: 'All groups'};
const activeFilterPills = reactive({...defaultFilters});
const hasFiltersFromModal = computed(
    () =>
        activeFilterPills.type !== defaultFilters.type ||
        activeFilterPills.group !== defaultFilters.group
);

const selected = defineModel<string[]>({required: true});
const devicesStore = useDevicesStore();

// null = no modal filter applied; otherwise the allowed shellyIDs.
const allowedIds = ref<Set<string> | null>(null);

// Live store view: late-connecting devices regroup while open.
const devices = computed(() => {
    void devicesStore.devicesVersion;
    return Object.values(devicesStore.devices).map((dev) => ({
        shellyID: dev.shellyID,
        name: getDeviceName(dev.info, dev.shellyID),
        online: dev.online
    }));
});

const filter = ref('');
const filteredDevices = computed(() =>
    devices.value.filter(
        (dev) =>
            (allowedIds.value === null || allowedIds.value.has(dev.shellyID)) &&
            deviceMatchesQuery({name: dev.name, id: dev.shellyID}, filter.value)
    )
);
// Online devices always come first, offline below the divider.
const onlineDevices = computed(() =>
    filteredDevices.value.filter((dev) => dev.online)
);
const offlineDevices = computed(() =>
    filteredDevices.value.filter((dev) => !dev.online)
);

function getStoreDevice(shellyID: string) {
    return (
        devicesStore.devices[shellyID] ?? {
            shellyID,
            online: false,
            info: {},
            status: {}
        }
    );
}

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

function setActiveFilters(filters: typeof activeFilterPills) {
    Object.assign(activeFilterPills, filters);
}

// A filter change drops selections outside the new scope.
function setDevices(filteredShellyDevices: shelly_device_t[]) {
    const allowed = new Set(filteredShellyDevices.map((dev) => dev.shellyID));
    allowedIds.value = allowed;
    selected.value = selected.value.filter((id) => allowed.has(id));
}
</script>

<style scoped>
.ds {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    height: 100%;
    min-height: 0;
}
.ds-bar {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    flex-wrap: wrap;
}
.ds-search {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 200px;
    position: relative;
}
.ds-search-input {
    flex: 1;
}
.ds-filter-btn {
    position: absolute;
    right: var(--gap-xs);
    top: 50%;
    transform: translateY(-50%);
    width: var(--gap-lg);
    height: var(--gap-lg);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color var(--duration-fast), color var(--duration-fast);
}
.ds-filter-btn:hover {
    border-color: var(--color-border-medium);
    color: var(--color-text-secondary);
}
.ds-filter-btn--active {
    border-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}
.ds-actions {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    flex-shrink: 0;
}
.ds-count {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-primary);
    white-space: nowrap;
}
.ds-grid-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}
.ds-group {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0 var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}
.ds-status-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex: none;
}
.ds-status-dot--online {
    background: var(--color-status-on);
}
.ds-status-dot--offline {
    background: var(--color-text-disabled);
}
.ds-separator {
    border: none;
    border-top: 1px solid var(--color-border-medium);
    margin: var(--space-4) 0;
}
</style>
