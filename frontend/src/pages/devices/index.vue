<template>
  <InfiniteGridScrollPage
    :page="page"
    :total-pages="totalPages"
    :items="items"
    :loading="loading"
    customClass="widget-grid-devices"
    @load-items="loadItems"
  >
    <template #header>
      <BasicBlock bordered blurred class="relative z-[var(--z-raised)] mb-2">
        <div class="flex flex-col gap-3">
          <div class="flex flex-col md:flex-row gap-2 items-center justify-between">
            <div class="flex flex-1 flex-row flex-wrap gap-2 items-center">
              <div class="flex items-center gap-2 min-w-[200px] flex-1 max-w-md">
                <Input v-model="nameFilter" placeholder="Search" clear class="w-full" aria-label="Search devices" />
                <Button :type="hasFiltersFromModal ? 'red' : 'blue'" size="sm" narrow data-track="devices_filter" @click="filterVisible = true">
                  <i class="fas fa-filter" aria-hidden="true" /><span class="sr-only">Filter & sort</span>
                </Button>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <span v-if="sortMode !== 'online-az'" class="filter-pill sort-pill rounded-full px-2 py-1 text-xs flex items-center gap-1">
                  <i class="fas fa-arrow-down-a-z" /> {{ sortLabel }}
                </span>
                <span
                  v-for="([key, value]) in activeFilterPillsEntries"
                  :key="key"
                  class="filter-pill rounded-full px-2 py-1 text-xs flex items-center gap-1"
                >
                  {{ key === 'online' ? (value ? 'Online' : 'Offline') : value }}
                  <button @click="clearPill(key as 'type' | 'group' | 'online')" class="filter-pill-remove focus:outline-none min-w-[var(--touch-target-min)] min-h-[var(--touch-target-min)] inline-flex items-center justify-center rounded-full" aria-label="Remove filter">×</button>
                </span>
                <button v-if="activeFilterPillsEntries.length" @click="clearAllFilters" class="filter-pill filter-pill-clear rounded-full px-2 py-1 text-xs" aria-label="Clear all filters">Clear all</button>
              </div>
            </div>
            <div class="flex flex-row gap-2">
              <Button v-if="selectMode && selectedDevices.length" type="blue" data-track="devices_send_rpc" @click="rpcBuilderStore.showModal = true">
                Send RPC to {{ selectedDevices.length }} devices
              </Button>
              <Button narrow :type="selectMode ? 'red' : 'blue'" data-track="devices_create_action" @click="selectMode = !selectMode">
                {{ selectMode ? 'Discard Action' : 'Create Action' }}
              </Button>
              <Button v-if="!editMode" type="blue" size="sm" narrow data-track="devices_edit_mode" @click="toggleEditMode">
                <i class="fas fa-pencil" aria-hidden="true" /><span class="sr-only">Edit mode</span>
              </Button>
              <Button v-else type="red" size="sm" narrow data-track="devices_exit_edit" @click="toggleEditMode">
                Exit edit mode
              </Button>
            </div>
          </div>
          <div class="flex flex-row gap-2 items-baseline justify-center">
            <span class="w-full font-bold size-3">{{ devicesCalculation }}</span>
          </div>
        </div>
      </BasicBlock>

      <SendRpcModal @close="sendRpcClosed" />
      <ConfirmationModal ref="modalRefDelete">
        <template #title>
          <h1>You are about to delete a device! <br />Proceed?</h1>
        </template>
      </ConfirmationModal>
      <DeviceFilter
        v-model="filterVisible"
        :filters="activeFilterPills"
        :sort-mode="sortMode"
        :key="JSON.stringify(activeFilterPills)"
        @setFilters="setActiveFilters"
        @updateSort="val => sortMode = val"
        @devices="setDevices"
      />
    </template>

    <template #default="{ item, small }">
      <DeviceWidget
        v-if="item.kind === 'device' && item.data.shellyID"
        :key="item.data.shellyID"
        :device-id="item.data.shellyID"
        :vertical="small"
        :select-mode="selectMode"
        :edit-mode="editMode"
        :selected="(selectMode && item.data.selected) || activeDevice === item.data.shellyID"
        class="hover:cursor-pointer"
        @click.stop="clicked(item.data)"
        @delete="deleteDevice(item.data.shellyID, item.data.id)"
      />
      <BTHomeDeviceWidget
        v-else-if="item.kind === 'sensor'"
        :key="item.data.id"
        :device="(item.data as SensorDevice)"
        :vertical="small"
        :selected="activeSensor === item.data.id"
        class="hover:cursor-pointer"
        @click="sensorClicked(item.data as SensorDevice)"
      />
    </template>

    <template #empty>
      <EmptyBlock v-if="rawDevices.length === 0">
        <p class="text-xl font-semibold pb-2">No devices found</p>
        <p class="text-sm pb-2">Connect Shelly devices via their outbound websocket.</p>
      </EmptyBlock>
    </template>
  </InfiniteGridScrollPage>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import type {DefineComponent} from 'vue';
import {computed, onMounted, onUnmounted, reactive, ref, watch} from 'vue';
import SensorBoard from '@/components/boards/SensorBoard.vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Input from '@/components/core/Input.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import SendRpcModal from '@/components/modals/SendRpcModal.vue';
import DeviceFilter from '@/components/pages/devices/DeviceFilter.vue';
import InfiniteGridScrollPage from '@/components/pages/InfiniteGridScrollPage.vue';
import BTHomeDeviceWidget from '@/components/widgets/BTHomeDeviceWidget.vue';
import DeviceWidget from '@/components/widgets/DeviceWidget.vue';
import {useDeviceFiltering} from '@/composables/useDeviceFiltering';
import useInfiniteScroll from '@/composables/useInfiniteScroll';
import {DeviceBoard} from '@/helpers/components';
import {useDevicesStore} from '@/stores/devices';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useRpcBuilderStore} from '@/stores/rpc-builder';
import {type SensorDevice, useSensorsStore} from '@/stores/sensors';
import {sendRPC} from '@/tools/websocket';
import type {shelly_device_t} from '@/types';

interface GridDevice {
    kind: 'device';
    data: shelly_device_t;
}
interface GridSensor {
    kind: 'sensor';
    data: SensorDevice;
}
type GridItem = GridDevice | GridSensor;

const deviceStore = useDevicesStore();
const rawDevices = computed(() => Object.values(deviceStore.devices));
const rpcBuilderStore = useRpcBuilderStore();
const rightSideStore = useRightSideMenuStore();
const modalRefDelete = ref<InstanceType<typeof ConfirmationModal>>();
const filterVisible = ref(false);
const selectMode = ref(false);
const editMode = ref(false);
const activeDevice = ref<string | null>(null);

// ── Sort options ─────────────────────────────────────────────
type SortMode = 'online-az' | 'az' | 'za' | 'offline-first';

// ── LocalStorage persistence ─────────────────────────────────
const STORAGE_KEY = 'fm-device-filters';

function loadSavedState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore corrupt data */ }
    return null;
}

const saved = loadSavedState();

const nameFilter = ref(saved?.nameFilter ?? '');
const sortMode = ref<SortMode>(saved?.sortMode ?? 'online-az');

const defaultFilters = {
    type: 'All devices',
    group: 'All groups',
    online: null as boolean | null
};
const activeFilterPills = reactive({
    type: saved?.type ?? defaultFilters.type,
    group: saved?.group ?? defaultFilters.group,
    online: saved?.online ?? defaultFilters.online
});

// Save filters to localStorage on any change
watch(
    [() => activeFilterPills.type, () => activeFilterPills.group, () => activeFilterPills.online, nameFilter, sortMode],
    () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            type: activeFilterPills.type,
            group: activeFilterPills.group,
            online: activeFilterPills.online,
            nameFilter: nameFilter.value,
            sortMode: sortMode.value
        }));
    },
    {deep: true}
);

// Use reactive filtering - pass rawDevices (computed) so it updates when devices change
const {filtered: pillFilteredComputed} = useDeviceFiltering(
    rawDevices,
    activeFilterPills
);
// Maintain backward compatibility with existing code
const pillFiltered = pillFilteredComputed;

const showDevices = computed(() => {
    const filtered = pillFiltered.value.filter((dev) => {
        if (!nameFilter.value) return true;
        const needle = nameFilter.value.toLowerCase();
        return [dev.info?.name, dev.info?.id].some(
            (txt) =>
                typeof txt === 'string' && txt.toLowerCase().includes(needle)
        );
    });

    return [...filtered].sort((a, b) => {
        const nameA = (a.info?.name || a.shellyID || '').toLowerCase();
        const nameB = (b.info?.name || b.shellyID || '').toLowerCase();
        switch (sortMode.value) {
            case 'online-az':
                if (a.online !== b.online) return a.online ? -1 : 1;
                return nameA.localeCompare(nameB);
            case 'az':
                return nameA.localeCompare(nameB);
            case 'za':
                return nameB.localeCompare(nameA);
            case 'offline-first':
                if (a.online !== b.online) return a.online ? 1 : -1;
                return nameA.localeCompare(nameB);
            default:
                return 0;
        }
    });
});

const hasFiltersFromModal = computed(
    () => rawDevices.value.length !== showDevices.value.length || sortMode.value !== 'online-az'
);
const sortLabel = computed(() => {
    const labels: Record<SortMode, string> = {
        'online-az': 'Online first',
        'az': 'Name A-Z',
        'za': 'Name Z-A',
        'offline-first': 'Offline first'
    };
    return labels[sortMode.value];
});
const devicesCalculation = computed(() => {
    const total = rawDevices.value.length;
    const online = deviceStore.onlineCount;
    const filtered = showDevices.value.length;
    return filtered !== total
        ? `Showing ${filtered}/${total} devices.`
        : `Total ${total} devices (${online} online)`;
});
const selectedDevices = computed(() =>
    Object.values(deviceStore.devices).filter((d) => d.selected)
);

const sensorsStore = useSensorsStore();
const {sensors} = storeToRefs(sensorsStore);

const combinedItems = computed<GridItem[]>(() => {
    const addedSensorIds = new Set<string>();
    return showDevices.value.flatMap((dev) => {
        const settings = dev.settings as Record<string, any>;
        const macs = Object.keys(settings)
            .filter((key) => key.startsWith('bthomedevice:'))
            .map((key) => settings[key].addr as string);
        const out: GridItem[] = [{kind: 'device', data: dev}];
        sensors.value
            .filter((s) => macs.includes(s.id) && !addedSensorIds.has(s.id))
            .forEach((s) => {
                addedSensorIds.add(s.id);
                out.push({kind: 'sensor', data: s});
            });
        return out;
    });
});

const {items, page, totalPages, loading, loadItems} =
    useInfiniteScroll<GridItem>(combinedItems);

const activeFilterPillsEntries = computed(() =>
    Object.entries(activeFilterPills).filter(([key, value]) =>
        key === 'type'
            ? value !== defaultFilters.type
            : key === 'group'
              ? value !== defaultFilters.group
              : key === 'online'
                ? value !== null
                : false
    )
);

function setActiveFilters(filters: typeof activeFilterPills) {
    Object.assign(activeFilterPills, filters);
}
function clearPill(key: 'type' | 'group' | 'online') {
    if (key === 'type') activeFilterPills.type = defaultFilters.type;
    if (key === 'group') activeFilterPills.group = defaultFilters.group;
    if (key === 'online') activeFilterPills.online = defaultFilters.online;
}
function clearAllFilters() {
    Object.assign(activeFilterPills, defaultFilters);
    nameFilter.value = '';
}

function toggleEditMode() {
    selectedDevices.value.forEach((d) => (d.selected = false));
    deviceStore.selectedDevices.length = 0;
    editMode.value = !editMode.value;
}

function deleteDevice(shellyID: string, id?: number) {
    modalRefDelete.value?.storeAction(async () => {
        await sendRPC(
            'FLEET_MANAGER',
            'device.Delete',
            id != null ? {shellyID, id} : {shellyID}
        );

        deviceStore.deviceDeleted(shellyID);

        if (activeDevice.value === shellyID) {
            rightSideStore.clearActiveComponent();
            activeDevice.value = null;
        }
        // Filtering now happens automatically via reactive computed
    });
}

function clicked(device: shelly_device_t) {
    if (!selectMode.value) {
        rightSideStore.setActiveComponent(DeviceBoard, {
            shellyID: device.shellyID
        });
        activeDevice.value = device.shellyID;
    } else {
        device.selected = !device.selected;
    }
}

function sendRpcClosed() {
    selectedDevices.value.forEach((d) => (d.selected = false));
    deviceStore.selectedDevices.length = 0;
    deviceStore.rpcResponses = {};
    activeDevice.value = '';
    selectMode.value = false;
}

function setDevices(devs: shelly_device_t[]) {
    // This function is called by DeviceFilter to set custom filters
    // Since pillFiltered is now a computed, we handle this by updating the filter criteria
    // The modal should update activeFilterPills instead of passing devices directly
    console.log(
        '[setDevices] Called with',
        devs.length,
        'devices - filters should be used instead'
    );
}

watch(selectMode, (v) => {
    if (v) rawDevices.value.forEach((d) => (d.selected = false));
    activeDevice.value = '';
});

onMounted(() => {
    // Devices are already loaded on WS connect (websocket.ts onConnect).
    // Only fetch if the store is still empty (e.g., direct URL navigation
    // before WS connect completed).
    if (!deviceStore.initialLoadComplete) {
        deviceStore.fetchDevices();
    }
});

onUnmounted(() => rightSideStore.clearActiveComponent());

watch(() => rightSideStore.component, (comp) => {
    if (!comp) activeDevice.value = null;
});

const activeSensor = ref<string | null>(null);
function sensorClicked(sensor: SensorDevice) {
    activeSensor.value = activeSensor.value === sensor.id ? null : sensor.id;
    rightSideStore.setActiveComponent(
        SensorBoard as unknown as DefineComponent,
        {sensorId: sensor.id, sensorName: sensor.name}
    );
}
</script>

<style scoped>
.filter-pill {
    background-color: var(--color-badge-bg);
    color: var(--color-badge-text);
}

.filter-pill-remove:hover {
    background-color: var(--color-surface-4);
}

.sort-pill {
    background-color: var(--color-primary-subtle);
    color: var(--color-primary-text);
    border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent);
}

.filter-pill-clear {
    background-color: var(--color-danger-subtle);
    color: var(--color-danger-text);
    cursor: pointer;
}
.filter-pill-clear:hover {
    background-color: var(--color-danger);
    color: var(--color-text-primary);
}

</style>
