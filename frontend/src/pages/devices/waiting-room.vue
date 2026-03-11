<template>
    <div class="space-y-2 h-full flex flex-col">
        <BasicBlock bordered blurred padding="sm" class="relative z-[var(--z-raised)]">
            <div class="flex flex-row gap-2 items-center justify-between">
                <div class="flex flex-row gap-2 items-baseline">
                    <span class="font-bold">Waiting Room</span>
                    <Dropdown :options="MODES" @selected="modeChanged" />
                </div>
                <div class="space-x-2">
                    <Button v-if="!selectMode" type="blue" size="sm" narrow @click="selectMode = true">Select</Button>
                    <template v-else>
                        <Button type="blue" size="sm" narrow :disabled="selectAllDisabled" @click="selectAll">
                            Select all
                        </Button>
                        <Button type="green" size="sm" narrow :disabled="selected.length == 0" @click="acceptAll"
                            >Accept all</Button
                        >
                        <Button type="red" size="sm" narrow :disabled="selected.length == 0" @click="rejectAll"
                            >Reject all</Button
                        >
                        <Button type="blue" size="sm" narrow @click="selectMode = false">Exit Select</Button>
                    </template>
                    <Button type="blue" size="sm" narrow @click="refresh"><i class="fas fa-refresh" aria-hidden="true" /><span class="sr-only">Refresh</span></Button>
                </div>
            </div>
        </BasicBlock>

        <template v-if="mode === 'pending'">
            <Notification v-if="error" type="error"> Something went wrong </Notification>

            <div v-else-if="loading" class="flex-1 overflow-auto">
                <div :class="[small ? 'flex flex-col gap-2' : 'widget-grid-devices']">
                    <Skeleton v-for="i in 6" :key="'skel-p-' + i" variant="card" />
                </div>
            </div>

            <template v-else-if="devices">
                <EmptyBlock v-if="pendingEntries.length === 0">
                    <p class="text-xl font-semibold pb-2">No pending devices</p>
                    <p class="text-sm pb-2">Pending shelly devices will appear here.</p>
                    <Button type="blue" @click="refresh">Refresh</Button>
                </EmptyBlock>
                <div v-else class="flex-1 overflow-auto">
                    <div :class="[small ? 'flex flex-col gap-2' : 'widget-grid-devices']">
                        <DeviceCard
                            v-for="[internalId, device] in paginatedPending"
                            :key="internalId"
                            :selected="selectedSet.has(internalId) && selectMode"
                            accent-color="#F59E0B"
                            class="device-card--pending"
                            @select="deviceClicked(internalId)"
                        >
                            <template #upper-corner>Pending</template>
                            <template #image>
                                <img :src="getLogoFromShellyID(device.shellyID)" alt="Device" @error="(e: any) => e.target.src = '/shelly_logo.png'" />
                            </template>
                            <template #name>{{ device.shellyID }}</template>
                            <template #footer>
                                <Button type="red" size="xs" narrow @click.stop="rejectDevice(internalId)">
                                    <i class="fas fa-xmark" />
                                </Button>
                                <Button type="green" size="xs" narrow @click.stop="acceptDevice(internalId)">
                                    <i class="fas fa-check" />
                                </Button>
                            </template>
                        </DeviceCard>
                    </div>
                    <div v-if="pendingPage < pendingTotalPages" class="my-4 flex justify-center h-8 pb-2">
                        <Spinner />
                    </div>
                    <div ref="pendingSentinel" class="h-1" />
                </div>
            </template>
        </template>

        <template v-if="mode === 'denied'">
            <Notification v-if="deniedError" type="error"> Something went wrong </Notification>

            <div v-else-if="deniedLoading" class="flex-1 overflow-auto">
                <div :class="[small ? 'flex flex-col gap-2' : 'widget-grid-devices']">
                    <Skeleton v-for="i in 6" :key="'skel-d-' + i" variant="card" />
                </div>
            </div>

            <template v-else-if="deniedDevices">
                <EmptyBlock v-if="deniedEntries.length === 0">
                    <p class="text-xl font-semibold pb-2">No denied devices</p>
                    <p class="text-sm pb-2">Denied shelly devices will appear here.</p>
                    <Button type="blue" @click="deniedRefresh">Refresh</Button>
                </EmptyBlock>
                <div v-else class="flex-1 overflow-auto">
                    <div :class="[small ? 'flex flex-col gap-2' : 'widget-grid-devices']">
                        <DeviceCard
                            v-for="[internalId, device] in paginatedDenied"
                            :key="internalId"
                            :selected="selectedSet.has(internalId) && selectMode"
                            accent-color="#F04E5E"
                            class="device-card--denied"
                            @select="deviceClicked(internalId)"
                        >
                            <template #upper-corner>Denied</template>
                            <template #image>
                                <img :src="getLogoFromShellyID(device.shellyID)" alt="Device" @error="(e: any) => e.target.src = '/shelly_logo.png'" />
                            </template>
                            <template #name>{{ device.shellyID }}</template>
                            <template #footer>
                                <Button type="green" size="xs" narrow @click.stop="acceptDevice(internalId)">
                                    <i class="fas fa-check" />
                                </Button>
                            </template>
                        </DeviceCard>
                    </div>
                    <div v-if="deniedPage < deniedTotalPages" class="my-4 flex justify-center h-8 pb-2">
                        <Spinner />
                    </div>
                    <div ref="deniedSentinel" class="h-1" />
                </div>
            </template>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Notification from '@/components/core/Notification.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import Spinner from '@/components/core/Spinner.vue';
import DeviceCard from '@/components/widgets/WidgetsTemplates/DeviceWidget.vue';
import useInfiniteScroll from '@/composables/useInfiniteScroll';
import useFleetManagerRpc from '@/composables/useWsRpc';
import {getLogoFromShellyID} from '@/helpers/device';
import {small} from '@/helpers/ui';
import * as ws from '@/tools/websocket';
import type {ShellyDeviceExternal} from '@/types';

type PendingDevice = Pick<ShellyDeviceExternal, 'shellyID' | 'status'>;
type DeviceEntry = [string, PendingDevice];

const {
    data: devices,
    loading,
    error,
    refresh
} = useFleetManagerRpc<Record<string, PendingDevice>>('Device.GetPending');
const {
    data: deniedDevices,
    loading: deniedLoading,
    error: deniedError,
    refresh: deniedRefresh
} = useFleetManagerRpc<Record<string, PendingDevice>>(
    'Device.GetDenied',
    {},
    {lazy: true}
);
const selectMode = ref(false);
const selected = ref<string[]>([]);
const mode = ref<'pending' | 'denied'>('pending');
let deniedFetched = false;

// O(1) lookups instead of array.includes per widget
const selectedSet = computed(() => new Set(selected.value));

// Convert Records to arrays for pagination
const pendingEntries = computed<DeviceEntry[]>(() =>
    devices.value ? Object.entries(devices.value) : []
);
const deniedEntries = computed<DeviceEntry[]>(() =>
    deniedDevices.value ? Object.entries(deniedDevices.value) : []
);

// Paginate both grids
const {
    items: paginatedPending,
    page: pendingPage,
    totalPages: pendingTotalPages,
    loadItems: loadPendingItems
} = useInfiniteScroll(pendingEntries);
const {
    items: paginatedDenied,
    page: deniedPage,
    totalPages: deniedTotalPages,
    loadItems: loadDeniedItems
} = useInfiniteScroll(deniedEntries);

// IntersectionObserver for infinite scroll (viewport-based)
const pendingSentinel = ref<HTMLElement | null>(null);
const deniedSentinel = ref<HTMLElement | null>(null);
let pendingObserver: IntersectionObserver | null = null;
let deniedObserver: IntersectionObserver | null = null;

function setupObserver(
    sentinel: HTMLElement | null,
    page: {value: number},
    totalPages: {value: number},
    loadItems: () => void
): IntersectionObserver | null {
    if (!sentinel) return null;
    const obs = new IntersectionObserver(
        (entries) => {
            if (entries[0]?.isIntersecting && page.value < totalPages.value) {
                loadItems();
            }
        },
        {rootMargin: '0px 0px 400px 0px'}
    );
    obs.observe(sentinel);
    return obs;
}

// Watch for sentinel availability (they appear/disappear with v-if)
watch(pendingSentinel, (el) => {
    pendingObserver?.disconnect();
    pendingObserver = setupObserver(
        el,
        pendingPage,
        pendingTotalPages,
        loadPendingItems
    );
});
watch(deniedSentinel, (el) => {
    deniedObserver?.disconnect();
    deniedObserver = setupObserver(
        el,
        deniedPage,
        deniedTotalPages,
        loadDeniedItems
    );
});

onUnmounted(() => {
    pendingObserver?.disconnect();
    deniedObserver?.disconnect();
});

const MODES = ['Pending', 'Denied'];

function modeChanged(currentMode: string) {
    selected.value.length = 0;
    mode.value = MODES.indexOf(currentMode) == 0 ? 'pending' : 'denied';
    if (mode.value === 'denied' && !deniedFetched) {
        deniedFetched = true;
        deniedRefresh();
    }
}

function deviceClicked(shellyID: string) {
    if (!selectMode.value) return;
    if (selected.value.includes(shellyID)) {
        selected.value.splice(selected.value.indexOf(shellyID), 1);
    } else {
        selected.value.push(shellyID);
    }
}

function refreshCorrect() {
    if (mode.value === 'pending') {
        refresh();
    } else {
        deniedRefresh();
    }
}

const selectAllDisabled = computed(() =>
    mode.value === 'pending'
        ? pendingEntries.value.length === 0
        : deniedEntries.value.length === 0
);

function selectAll() {
    if (mode.value === 'pending') {
        selected.value = Object.keys(devices.value || {});
    } else {
        selected.value = Object.keys(deniedDevices.value || {});
    }
}

async function acceptDevice(id: string) {
    try {
        await ws.sendRPC('FLEET_MANAGER', 'WaitingRoom.AcceptPendingById', {
            ids: [Number(id)]
        });
        refreshCorrect();
    } catch (error) {
        console.error('Cannot accept');
    }
}

async function rejectDevice(shellyID: string) {
    try {
        await ws.sendRPC('FLEET_MANAGER', 'WaitingRoom.RejectPending', {
            shellyIDs: [shellyID]
        });
        refreshCorrect();
    } catch (error) {
        console.error('Cannot reject');
    }
}

async function acceptAll() {
    loading.value = true;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'WaitingRoom.AcceptPendingById', {
            ids: selected.value.map((id) => Number(id))
        });
        selected.value.length = 0;
        selectMode.value = false;
        refreshCorrect();
    } catch (error) {
        console.error('Cannot accept');
    } finally {
        loading.value = false;
    }
}

async function rejectAll() {
    loading.value = true;
    try {
        await ws.sendRPC('FLEET_MANAGER', 'WaitingRoom.RejectPending', {
            shellyIDs: selected.value
        });
        selected.value.length = 0;
        selectMode.value = false;
        refreshCorrect();
    } catch (error) {
        console.error('Cannot reject');
    } finally {
        loading.value = false;
    }
}
</script>
