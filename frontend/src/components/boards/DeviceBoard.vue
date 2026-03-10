<template>
    <EmDeviceOptionsModal
        :visible="showOptionsModal"
        :model-value="selectedEMDevices"
        :default-device="defaultEmDevice"
        @update:selected="handleOptionsSave"
        @close="showOptionsModal = false"
    />
    <DeviceWebGuiModal
        :visible="showWebGuiModal"
        :shelly-i-d="shellyID"
        @close="showWebGuiModal = false"
    />

    <BoardTabs
        v-if="device"
        :tabs="tabs"
        @back="() => rightSideStore.clearActiveComponent()"
    >
        <template #title>
            <span class="text-lg font-semibold line-clamp-2">{{
                getDeviceName(device.info, shellyID)
            }}</span>
        </template>
        <template #info>
        <!-- Device hero card: centered layout -->
        <div class="device-hero">
            <figure class="device-hero__avatar">
                <img
                    :src="getLogo(device)"
                    alt="Shelly"
                    class="device-hero__img"
                    loading="lazy"
                    decoding="async"
                    @error="handleImgError"
                />
                <span class="device-status-dot" :class="[
                    device.online && !device.loading && 'device-status-dot--online',
                    !device.online && !device.loading && 'device-status-dot--offline',
                    device.loading && 'device-status-dot--loading',
                ]" />
            </figure>

            <span class="device-status-badge" :class="[
                device.online && !device.loading && 'device-status-badge--online',
                !device.online && !device.loading && 'device-status-badge--offline',
                device.loading && 'device-status-badge--loading',
            ]">
                {{ device.loading ? 'Connecting' : device.online ? 'Online' : 'Offline' }}
            </span>

            <span v-if="device?.info?.app" class="device-hero__app">{{ device.info.app }}</span>

            <div class="device-meta">
                <div class="device-meta__item">
                    <span class="device-meta__label"><i class="fas fa-calendar-plus" /> Added</span>
                    <span class="device-meta__value">{{ dateOfInclusionShort }}</span>
                </div>
                <div class="device-meta__item">
                    <span class="device-meta__label"><i class="fas fa-clock" /> Last seen</span>
                    <span class="device-meta__value">{{ lastReportShort }}</span>
                </div>
                <div class="device-meta__item">
                    <span class="device-meta__label"><i class="fas fa-microchip" /> Firmware</span>
                    <span class="device-meta__value font-mono">v{{ device?.info?.ver }}</span>
                </div>
            </div>

            <button v-if="canExecute" class="device-action-btn" @click="showWebGuiModal = true">
                <i class="fa-solid fa-arrow-up-right-from-square" />
                Web GUI
            </button>
        </div>

        <div v-if="isDiscovered(device.shellyID)">
            <Notification>
                This device has been discovered in your local network.
            </Notification>
            <Notification type="warning">
                Discovered devices do not update their state proactively.
            </Notification>
            <BasicBlock title="Connect device to Fleet Manager">
                <div class="space-y-2">
                    <Input v-model="wsAddress" :disabled="!canExecute" />
                    <span class="text-xs">
                        You can edit the default address in
                        <RouterLink to="/settings" class="underline"
                            >settings</RouterLink
                        >
                    </span>
                    <Button :disabled="!canExecute" @click="connectToWs"
                        >Submit</Button
                    >
                </div>
            </BasicBlock>
        </div>

        <div v-if="device.loading" class="device-loading-state">
            <Spinner />
            <span>Connecting to device…</span>
        </div>

        <template v-if="!device.loading">
            <!-- Entities section -->
            <div v-if="sortedEntities.length" class="device-section">
                <span class="device-section__label">Entities ({{ sortedEntities.length }})</span>
                <div class="flex flex-col flex-nowrap gap-3">
                    <div
                        v-for="entity of sortedEntities"
                        :key="entity.id"
                    >
                        <EntityEM
                            v-if="entity.type === 'em'"
                            :entity="entity as em_entity"
                        />
                        <EntityWidget
                            v-else
                            vertical
                            class="w-full"
                            :entity="entity"
                            @click="entityClicked(entity)"
                        />
                    </div>
                </div>
            </div>

            <!-- Pill Device Configuration -->
            <PillConfig
                v-if="isPillDevice && device.online && canExecute"
                :shelly-i-d="shellyID"
                class="mt-4"
            />
        </template>
        </template>
        <template #debug>
            <div class="overflow-auto">
                <Collapse title="Device">
                    <Input
                        v-model="deviceNameField"
                        label="Device name"
                        :disabled="!canExecute"
                    />
                    <Button
                        type="blue"
                        class="mt-2"
                        :disabled="!canExecute"
                        @click="saveDeviceName"
                        >Submit</Button
                    >
                </Collapse>

                <Collapse title="Deny device">
                    <Notification type="warning">
                        Unchecking this will <b>disconnect</b> the device from
                        this instance and add it to the deny list.
                    </Notification>
                    <Checkbox v-model="accessControlChecked">
                        Allow this device to connect to Fleet Manager
                    </Checkbox>
                    <Button @click="accessControlSaveClicked">Save</Button>
                </Collapse>

                <Collapse title="Info">
                    <JSONViewer :data="device.info" />
                </Collapse>

                <Collapse title="Status">
                    <JSONViewer :data="device.status" />
                </Collapse>

                <Collapse title="Settings">
                    <JSONViewer :data="device.settings" />
                </Collapse>
            </div>
        </template>
        <template #charts>
            <DeviceCharts :shelly-id="device.shellyID" />
        </template>
    </BoardTabs>
    <div v-else class="pt-8 text-center">
        <span>Device {{ shellyID }} not found</span>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, toRef, watch} from 'vue';
import DeviceCharts from '@/components/charts/DeviceCharts.vue';
import DeviceWebGuiModal from '@/components/modals/DeviceWebGuiModal.vue';
import EmDeviceOptionsModal from '@/components/modals/EmDeviceOptionsModal.vue';
import {EntityBoard} from '@/helpers/components';
import {getDeviceName, getLogo, isDiscovered} from '@/helpers/device';
import {defaultWs} from '@/helpers/ui';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import {em_entity, type entity_t} from '@/types';
import BasicBlock from '../core/BasicBlock.vue';
import Button from '../core/Button.vue';
import Checkbox from '../core/Checkbox.vue';
import Collapse from '../core/Collapse.vue';
import Input from '../core/Input.vue';
import EntityEM from '../core/Meters/EntityEM.vue';
import Notification from '../core/Notification.vue';
import PillConfig from '../core/PillConfig.vue';
import Spinner from '../core/Spinner.vue';
import JSONViewer from '../JSONViewer.vue';
import EntityWidget from '../widgets/EntityWidget.vue';
import BoardTabs from './BoardTabs.vue';

type props_t = {shellyID: string};

const props = defineProps<props_t>();
const shellyID = toRef(props, 'shellyID');

const deviceStore = useDevicesStore();
const entityStore = useEntityStore();
const toastStore = useToastStore();
const rightSideStore = useRightSideMenuStore();
const authStore = useAuthStore();

// Check if user can execute commands on this device
const canExecute = computed(() => authStore.canExecuteDevice(shellyID.value));

const device = computed(() => deviceStore.devices[shellyID.value]);
const deviceNameField = ref(device.value?.info?.name || device.value?.info?.id);
const wsAddress = ref(defaultWs.value);

const accessControlChecked = ref(true);
const tabs = ref([{name: 'charts', icon: 'fas fa-chart-line'}]);

interface EmDevice {
    shellyID: string;
    name: string;
    pictureUrl: string;
}

const defaultEmDevice = computed<EmDevice>(() => ({
    shellyID: device.value.shellyID,
    name: getDeviceName(device.value.info),
    pictureUrl: getLogo(device.value)
}));

const showOptionsModal = ref(false);
const showWebGuiModal = ref(false);
const selectedEMDevices = ref<EmDevice[]>([]);

const entities = computed(() => {
    const entities: Record<string, entity_t> = {};
    for (const eid of device.value.entities)
        if (entityStore.entities[eid]) {
            entities[eid] = entityStore.entities[eid];
        }
    return entities;
});

const sortedEntities = computed(() =>
    Object.values(entities.value).sort((a, b) =>
        a.type === 'em' ? -1 : b.type === 'em' ? 1 : 0
    )
);

const dateOfInclusionShort = computed(() => {
    const ts = device.value.status?.ts;
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
});

const lastReportShort = computed(() => {
    const ts = device.value?.meta?.lastReportTs;
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
});

// Check if this is a Pill device (The Pill by Shelly)
const isPillDevice = computed(() => {
    const app = device.value?.info?.app;
    const model = device.value?.info?.model;
    // Check for Pill app name or model identifier
    return (
        app === 'Pill' ||
        app === 'ThePill' ||
        model?.includes('SPIL') ||
        model?.includes('Pill')
    );
});

// Check if this is a Cury device
const isCuryDevice = computed(() => {
    const app = device.value?.info?.app;
    return app === 'Cury';
});

function handleOptionsSave(selected: EmDevice[]) {
    selectedEMDevices.value = selected;
    toastStore.success(`Saved ${selected.length} EM device(s)`);
}

async function saveDeviceName() {
    if (!canExecute.value) {
        toastStore.error(
            'You do not have permission to execute commands on this device'
        );
        return;
    }
    try {
        await deviceStore.sendRPC(shellyID.value, 'Sys.SetConfig', {
            config: {device: {name: deviceNameField.value}}
        });
        toastStore.success(`Changed device name to '${deviceNameField.value}'`);
    } catch (error) {
        toastStore.error(
            `Failed to change device name to '${deviceNameField.value}'`
        );
    }
}

async function connectToWs() {
    if (!canExecute.value) {
        toastStore.error(
            'You do not have permission to execute commands on this device'
        );
        return;
    }
    try {
        const wsResp = await deviceStore.sendRPC(
            shellyID.value,
            'WS.SetConfig',
            {
                config: {
                    enable: true,
                    server: wsAddress.value
                }
            }
        );
        if (!wsResp.restart_required) {
            return;
        }
        await deviceStore.sendRPC(shellyID.value, 'shelly.reboot');
        toastStore.success('Saved websocket config');
    } catch (error) {
        toastStore.error(String(error));
    }
}

function entityClicked(entity: entity_t) {
    rightSideStore.setActiveComponent(EntityBoard, {entity});
}

function accessControlSaveClicked() {
    if (accessControlChecked.value) return;
    try {
        ws.sendRPC('FLEET_MANAGER', 'WaitingRoom.RejectPending', {
            shellyIDs: [shellyID.value]
        });
    } catch (error) {
        toastStore.error(String(error));
    }
}
function handleImgError(e: any) {
    e.target.src = getLogo();
}

watch(shellyID, async (newID, oldShellyID) => {
    await ws.clearTemporarySubscriptions();
    await ws.addTemporarySubscription([newID]);
    deviceNameField.value = getDeviceName({
        info: device.value?.info
    } as any);
    // Fetch full device data for the new device
    ws.sendRPC('FLEET_MANAGER', 'device.Get', {shellyID: newID})
        .then((fullDevice: any) => {
            if (fullDevice) deviceStore.handleNewDevice(fullDevice);
        })
        .catch(() => {});
});

onMounted(() => {
    ws.addTemporarySubscription([shellyID.value]);

    // Fetch full device data (including settings) — the initial list load
    // uses toListJSON() which strips settings for performance.
    ws.sendRPC('FLEET_MANAGER', 'device.Get', {shellyID: shellyID.value})
        .then((fullDevice: any) => {
            if (fullDevice) deviceStore.handleNewDevice(fullDevice);
        })
        .catch(() => {});
});

onUnmounted(() => {
    ws.clearTemporarySubscriptions();
});
</script>

<style scoped>
/* ── Device hero card: centered layout ── */
.device-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
}
.device-hero__avatar {
    position: relative;
    width: 120px;
    height: 120px;
    flex-shrink: 0;
}
.device-hero__img {
    width: 100%;
    height: 100%;
    border-radius: 9999px;
    border: 2px solid var(--color-border-strong);
    padding: 4px;
}
.device-status-dot {
    position: absolute;
    bottom: 4px;
    right: 4px;
    width: 18px;
    height: 18px;
    border-radius: 9999px;
    border: 3px solid var(--color-surface-1);
}
.device-status-dot--online { background-color: var(--color-success); }
.device-status-dot--offline { background-color: var(--color-danger); }
.device-status-dot--loading { background-color: var(--color-warning); }

.device-hero__app {
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
    font-family: monospace;
}

/* Status badge */
.device-status-badge {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    width: fit-content;
    padding: 1px var(--space-2);
    border-radius: var(--radius-full);
}
.device-status-badge--online {
    color: var(--color-success-text);
    background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
}
.device-status-badge--offline {
    color: var(--color-danger-text);
    background-color: color-mix(in srgb, var(--color-danger) 15%, transparent);
}
.device-status-badge--loading {
    color: var(--color-warning-text);
    background-color: color-mix(in srgb, var(--color-warning) 15%, transparent);
}

/* Action button */
.device-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.device-action-btn:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
}

/* ── Metadata cards ── */
.device-meta {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
}
.device-meta__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex: 1;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.device-meta__label {
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
    white-space: nowrap;
}
.device-meta__value {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    white-space: nowrap;
}

/* ── Loading state ── */
.device-loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6) 0;
    color: var(--color-text-disabled);
    font-size: var(--text-sm);
}

/* ── Section headers ── */
.device-section {
    padding: var(--space-3) var(--space-3) 0;
}
.device-section__label {
    display: block;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-disabled);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    margin-bottom: var(--space-2);
}
</style>
