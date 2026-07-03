

<template>
    <BoardTabs v-if="entity && device" :show-back="!!fromDevice" @back="goBackToDevice">
        <template #title>
            <div class="eb-name">
                <span class="text-lg font-semibold line-clamp-2">{{ entity.name }}</span>
                <button
                    v-if="isVirtualEntity"
                    type="button"
                    class="eb-name__edit"
                    title="Customise decoration"
                    aria-label="Customise decoration"
                    @click="showDetails = true"
                >
                    <i class="fas fa-pen" />
                </button>
            </div>
        </template>
        <template #info>
            <div class="flex flex-col gap-3 items-center pt-3">
                <figure class="w-20 h-20 rounded-full border-2 flex items-center justify-center" :class="[
                    device.online && !device.loading && 'border-[var(--color-border-strong)]',
                    !device.online && !device.loading && 'border-[var(--color-danger)]',
                    device.loading && 'border-[var(--color-warning)]',
                ]">
                    <i class="text-2xl" :class="getPredefinedImageForEntity(entity.type, entity.properties)"></i>
                </figure>
                <span class="text-[var(--color-text-tertiary)] text-xs">{{ entity.type }} - {{ device.info?.app }}</span>

                <div v-if="device.loading" class="flex flex-col items-center gap-1">
                    <Spinner />
                    <span class="text-sm font-semibold text-[var(--color-warning-text)] animate-pulse">Loading</span>
                </div>

                <span v-if="!device.online && !device.loading" class="text-sm font-semibold text-[var(--color-danger-text)]">Offline</span>

                <div v-if="entity.properties?.errors?.length && !entityTemplate" class="w-full rounded-md bg-[var(--color-surface-1)] p-3 text-sm text-[var(--color-warning-text)]">
                    <i class="fas fa-exclamation-triangle mr-1" />
                    <span v-for="(err, i) in entity.properties.errors" :key="i">
                        {{ err }}<template v-if="i < entity.properties.errors.length - 1">; </template>
                    </span>
                </div>

                <div class="w-full flex flex-col gap-2">
                    <!-- Internal temperature badge -->
                    <div v-if="isInternalTemp" class="eb-source eb-source--internal">
                        <i class="fas fa-microchip" />
                        <span>Internal</span>
                    </div>

                    <!-- Sensor source badge (BLU / Add-on) with gateway name -->
                    <div v-if="sensorSource" class="eb-source" :class="`eb-source--${sensorSource}`">
                        <i :class="sensorSource === 'blu' ? 'fab fa-bluetooth-b' : 'fas fa-puzzle-piece'" />
                        <span>{{ sensorSource === 'blu' ? 'BLU Sensor' : 'Add-on' }}</span>
                        <span v-if="gatewayName" class="eb-source__gateway">via {{ gatewayName }}</span>
                    </div>

                    <!-- Entity-type template — events dispatched via registry -->
                    <component
                        :is="entityTemplate"
                        v-if="entityTemplate && device.online"
                        :status="entityStatus"
                        :settings="entitySettings"
                        :can-execute="canExecute"
                        v-bind="templateExtraProps"
                        v-on="templateListeners"
                    />

                    <!-- Fallback: generic tags for types without a dedicated template -->
                    <EntityWidget v-if="!entityTemplate" vertical :entity="entity" />
                </div>
            </div>
        </template>
        <template #debug>
            <Collapse title="Info">
                <JSONViewer :data="entity" />
            </Collapse>

            <Collapse title="Status">
                <JSONViewer :data="device.status?.[statusKey]" />
            </Collapse>

            <Collapse title="Settings">
                <JSONViewer :data="device.settings?.[statusKey]" />
            </Collapse>
        </template>
    </BoardTabs>

    <div v-else class="p-4 text-center">
        <span>Entity not found</span>
    </div>

    <VirtualEditModal
        v-if="isVirtualEntity && entity && device"
        :visible="showDetails"
        :shelly-i-d="entity.source"
        :component-key="virtualComponentKey"
        @close="showDetails = false"
        @deleted="showDetails = false"
    />
</template>

<script setup lang="ts">
import '@/styles/card-system.css';
import {computed, onMounted, ref} from 'vue';
import Collapse from '@/components/core/Collapse.vue';
import JSONViewer from '@/components/core/JSONViewer.vue';
import VirtualEditModal from '@/components/modals/VirtualEditModal.vue';
import EntityWidget from '@/components/widgets/EntityWidget.vue';
import {
    getEntityActions,
    getEntityExtraProps,
    getEntityTemplate
} from '@/config/entity-registry';
import {DeviceBoard} from '@/helpers/components';
import {getPredefinedImageForEntity} from '@/helpers/device';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';
import {debugWarn} from '@/tools/debug';
import * as ws from '@/tools/websocket';
import type {entity_t} from '@/types';
import Spinner from '../core/Spinner.vue';
import BoardTabs from './BoardTabs.vue';

const VIRTUAL_ENTITY_TYPES = new Set([
    'boolean',
    'number',
    'enum',
    'text',
    'group',
    'button'
]);

type props_t = {entity: entity_t; fromDevice?: boolean};

const props = defineProps<props_t>();
// Use the passed entity's ID to fetch from store - this makes the entity reactive to store updates
const entityId = computed(() => props.entity.id);

const entityStore = useEntityStore();
const toastStore = useToastStore();
const deviceStore = useDevicesStore();
const rightSideStore = useRightSideMenuStore();

function goBackToDevice() {
    const shellyID = props.entity.source;
    if (shellyID) {
        rightSideStore.showInspector(DeviceBoard, {shellyID});
    } else {
        rightSideStore.clearInspector();
    }
}

// Fetch entity from store to get reactive updates when name changes
const entity = computed(
    () => entityStore.entities[entityId.value] ?? props.entity
);

const device = computed(() => deviceStore.devices[entity.value.source]);
const entityStatus = computed(() => {
    const st = device.value?.status;
    if (!st) return undefined;
    // Embedded temperature: data lives inside the parent component's status
    const e = entity.value;
    if (e.type === 'temperature' && e.properties.embeddedIn) {
        return st[e.properties.embeddedIn]?.temperature;
    }
    return deviceStore.statusOf(e.source, statusKey.value);
});

const authStore = useAuthStore();
const canExecute = computed(() =>
    authStore.canExecuteDevice(entity.value.source)
);

const deviceProfile = computed(() => entity.value.properties.deviceProfile);

const entityTemplate = computed(() =>
    getEntityTemplate(entity.value.type, deviceProfile.value)
);

const entitySettings = computed(
    () =>
        device.value?.settings?.[
            `${entity.value.type}:${entity.value.properties.id}`
        ]
);

const statusKey = computed(() => {
    if (entity.value.properties.id != null) {
        return `${entity.value.type}:${entity.value.properties.id}`;
    }

    return entity.value.type;
});

const isVirtualEntity = computed(() =>
    VIRTUAL_ENTITY_TYPES.has(entity.value.type)
);

const virtualComponentKey = computed(() => statusKey.value);

const showDetails = ref(false);

// Fetch full device data (including settings) — the initial list load
// uses toListJSON() which strips settings for performance.
onMounted(() => {
    const shellyID = entity.value.source;
    void loadEntityDeviceDetails(shellyID);
});

async function loadEntityDeviceDetails(shellyID: string): Promise<void> {
    try {
        const fullDevice = await ws.sendRPC('FLEET_MANAGER', 'device.Get', {
            shellyID
        });
        if (fullDevice) deviceStore.handleNewDevice(fullDevice as never);
    } catch (error) {
        debugWarn('Entity board full-device load failed', {
            shellyID,
            error
        });
    }
}

async function dispatchAction(call: {
    kind: 'entityAction';
    action: string;
    params?: Record<string, any>;
}) {
    try {
        await entityStore.invokeAction(
            entity.value.id,
            call.action,
            call.params
        );
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('timeout')) {
            toastStore.error(`${call.action} timed out — device may be busy`);
        } else {
            toastStore.error(`${call.action} failed: ${msg}`);
        }
        debugWarn('Entity action failed', {action: call.action, error});
    }
}

// ---------------------------------------------------------------------------
// Registry-driven template listeners & extra props
// ---------------------------------------------------------------------------

/** Extra props — resolved with profile override, plus device-level data for profiles */
const templateExtraProps = computed(() => {
    const fn = getEntityExtraProps(entity.value.type, deviceProfile.value);
    const base = fn?.(entity.value) ?? {};

    // Profile-specific device-level data injection
    if (deviceProfile.value === 'dali' && device.value) {
        return {
            ...base,
            daliStatus: device.value.status?.dali,
            daliConfig: device.value.settings?.dali
        };
    }

    // Camera: inject storage status + camera zones from device
    if (entity.value.type === 'camera' && device.value) {
        const zones: Array<{
            id: number;
            motion?: boolean;
            config?: Record<string, any>;
        }> = [];
        const st = device.value.status ?? {};
        const cfg = device.value.settings ?? {};
        for (const key of Object.keys(st)) {
            if (key.startsWith('camerazone:')) {
                const zoneId = Number(key.split(':')[1]);
                zones.push({id: zoneId, ...st[key], config: cfg[key]});
            }
        }
        return {
            ...base,
            storageStatus: st['storage:0'],
            cameraZones: zones
        };
    }

    return base;
});

/** Internal temperature: embedded temperature entities (PCB temp from switch/light/cover) */
const isInternalTemp = computed(() => {
    const e = entity.value;
    return e.type === 'temperature' && !!e.properties.embeddedIn;
});

/** Sensor source (BLU / Add-on) from entity properties, or implicit for bthomesensor */
const sensorSource = computed(() => {
    if (entity.value.type === 'bthomesensor') return 'blu';
    return (entity.value.properties as Record<string, any>)?.sensorSource as
        | string
        | undefined;
});

/** Gateway device name for BT/add-on entities */
const gatewayName = computed(() => {
    if (!sensorSource.value) return null;
    const d = device.value;
    if (!d) return null;
    return d.info?.name || d.info?.app || d.shellyID;
});

/** Event listeners — resolved with profile override (profile actions merge on top) */
const templateListeners = computed(() => {
    const actions = getEntityActions(entity.value.type, deviceProfile.value);
    if (!actions) return {};

    const listeners: Record<string, (...args: any[]) => void> = {};
    for (const [eventName, handler] of Object.entries(actions)) {
        listeners[eventName] = (...args: any[]) => {
            const call = handler(
                entity.value.properties.id,
                entityStatus.value,
                ...args
            );
            void dispatchAction(call);
        };
    }
    return listeners;
});
</script>

<style scoped>
/* Inline rename */
.eb-name {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    text-align: center;
    width: 100%;
}
.eb-name__edit {
    appearance: none;
    background: transparent;
    border: none;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.eb-name__edit:hover {
    color: var(--color-text-primary);
    background-color: var(--color-surface-1);
}

.eb-source {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) 0.625rem;
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    width: fit-content;
}
.eb-source--blu {
    background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-primary-text);
}
.eb-source--addon {
    background-color: color-mix(in srgb, var(--color-accent) 15%, transparent);
    color: var(--color-accent-text);
}
.eb-source--internal {
    background-color: color-mix(in srgb, var(--color-warning) 15%, transparent);
    color: var(--color-warning-text);
}
.eb-source__gateway {
    opacity: 0.7;
    font-size: var(--type-body);
}
</style>
