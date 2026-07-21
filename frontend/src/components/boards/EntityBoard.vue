

<template>
    <BoardTabs v-if="resolvedEntity && device" :show-back="!!fromDevice" @back="goBackToDevice">
        <template #title>
            <div class="eb-name">
                <span class="text-[length:var(--type-subheading)] font-semibold line-clamp-2">{{ resolvedEntity.name }}</span>
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
            <div class="eb-detail">
                <header class="eb-summary">
                    <figure class="eb-summary__icon">
                        <i :class="getPredefinedImageForEntity(resolvedEntity.type, resolvedEntity.properties)" />
                    </figure>
                    <div class="eb-summary__body">
                        <strong>{{ entityTypeLabel }}</strong>
                        <span>{{ deviceLabel }}</span>
                        <div class="eb-summary__pills">
                            <span v-if="device.loading" class="eb-status eb-status--loading">
                                <Spinner /> Connecting
                            </span>
                            <span v-else-if="device.online" class="eb-status eb-status--online">
                                Ready
                            </span>
                            <span v-else class="eb-status eb-status--offline">
                                Offline
                            </span>

                            <span v-if="isInternalTemp" class="eb-source eb-source--internal">
                                <i class="fas fa-microchip" /> Internal
                            </span>
                            <span v-if="sensorSource" class="eb-source" :class="`eb-source--${sensorSource}`">
                                <i :class="sensorSource === 'blu' ? 'fab fa-bluetooth-b' : 'fas fa-puzzle-piece'" />
                                {{ sensorSource === 'blu' ? 'BLU Sensor' : 'Add-on' }}
                            </span>
                        </div>
                    </div>
                </header>

                <div v-if="resolvedEntity.properties?.errors?.length && !entityTemplate" class="eb-errors">
                    <i class="fas fa-exclamation-triangle mr-1" />
                    <span v-for="(err, i) in resolvedEntity.properties.errors" :key="i">
                        {{ err }}<template v-if="i < resolvedEntity.properties.errors.length - 1">; </template>
                    </span>
                </div>

                <section class="eb-controls" :aria-label="`${resolvedEntity.name} controls`">
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
                    <EntityWidget v-if="!entityTemplate" vertical :entity="resolvedEntity" />
                </section>
            </div>
        </template>
        <template #debug>
            <Collapse title="Info">
                <JSONViewer :data="resolvedEntity" />
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
        v-if="isVirtualEntity && resolvedEntity && device"
        :visible="showDetails"
        :shelly-i-d="resolvedEntity.source"
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
import {getDeviceName, getPredefinedImageForEntity} from '@/helpers/device';
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
const resolvedEntity = computed(
    () => entityStore.entities[entityId.value] ?? props.entity
);

const device = computed(() => deviceStore.devices[resolvedEntity.value.source]);
const entityTypeLabel = computed(() =>
    resolvedEntity.value.type
        .split(/[_-]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
);
const deviceLabel = computed(() =>
    getDeviceName(device.value?.info, resolvedEntity.value.source)
);
const entityStatus = computed(() => {
    const st = device.value?.status;
    if (!st) return undefined;
    // Embedded temperature: data lives inside the parent component's status
    const e = resolvedEntity.value;
    if (e.type === 'temperature' && e.properties.embeddedIn) {
        return st[e.properties.embeddedIn]?.temperature;
    }
    return deviceStore.statusOf(e.source, statusKey.value);
});

const authStore = useAuthStore();
const canExecute = computed(() =>
    authStore.canExecuteDevice(resolvedEntity.value.source)
);

const deviceProfile = computed(
    () => resolvedEntity.value.properties.deviceProfile
);

const entityTemplate = computed(() =>
    getEntityTemplate(resolvedEntity.value.type, deviceProfile.value)
);

const entitySettings = computed(
    () =>
        device.value?.settings?.[
            `${resolvedEntity.value.type}:${resolvedEntity.value.properties.id}`
        ]
);

const statusKey = computed(() => {
    if (resolvedEntity.value.properties.id != null) {
        return `${resolvedEntity.value.type}:${resolvedEntity.value.properties.id}`;
    }

    return resolvedEntity.value.type;
});

const isVirtualEntity = computed(() =>
    VIRTUAL_ENTITY_TYPES.has(resolvedEntity.value.type)
);

const virtualComponentKey = computed(() => statusKey.value);

const showDetails = ref(false);

// Fetch full device data (including settings) — the initial list load
// uses toListJSON() which strips settings for performance.
onMounted(() => {
    const shellyID = resolvedEntity.value.source;
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
            resolvedEntity.value.id,
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
    const fn = getEntityExtraProps(
        resolvedEntity.value.type,
        deviceProfile.value
    );
    const base = fn?.(resolvedEntity.value) ?? {};

    // Profile-specific device-level data injection
    if (deviceProfile.value === 'dali' && device.value) {
        return {
            ...base,
            daliStatus: device.value.status?.dali,
            daliConfig: device.value.settings?.dali
        };
    }

    // Camera: inject storage status + camera zones from device
    if (resolvedEntity.value.type === 'camera' && device.value) {
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
    const e = resolvedEntity.value;
    return e.type === 'temperature' && !!e.properties.embeddedIn;
});

/** Sensor source (BLU / Add-on) from entity properties, or implicit for bthomesensor */
const sensorSource = computed(() => {
    if (resolvedEntity.value.type === 'bthomesensor') return 'blu';
    return (resolvedEntity.value.properties as Record<string, any>)
        ?.sensorSource as
        | string
        | undefined;
});

/** Event listeners — resolved with profile override (profile actions merge on top) */
const templateListeners = computed(() => {
    const actions = getEntityActions(
        resolvedEntity.value.type,
        deviceProfile.value
    );
    if (!actions) return {};

    const listeners: Record<string, (...args: any[]) => void> = {};
    for (const [eventName, handler] of Object.entries(actions)) {
        listeners[eventName] = (...args: any[]) => {
            const call = handler(
                resolvedEntity.value.properties.id,
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

.eb-detail {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-4);
    padding-top: var(--space-2);
}
.eb-summary {
    display: grid;
    min-width: 0;
    grid-template-columns: var(--space-16) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    border-bottom: var(--space-px) solid var(--color-border-subtle);
}
.eb-summary__icon {
    display: inline-flex;
    width: var(--space-16);
    height: var(--space-16);
    align-items: center;
    justify-content: center;
    border: var(--space-px) solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-size: var(--icon-size-lg);
}
.eb-summary__body {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-1);
}
.eb-summary__body strong {
    color: var(--color-text-primary);
    font-size: var(--type-caption);
}
.eb-summary__body > span {
    overflow: hidden;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.eb-summary__pills {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
}
.eb-status {
    display: inline-flex;
    min-height: var(--space-6);
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.eb-status--online::before,
.eb-status--offline::before {
    width: var(--space-1-5);
    height: var(--space-1-5);
    border-radius: var(--radius-full);
    background: currentColor;
    content: '';
}
.eb-status--online {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
}
.eb-status--loading {
    background: var(--color-warning-subtle);
    color: var(--color-warning-text);
}
.eb-status--offline {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
.eb-errors {
    border: var(--space-px) solid var(--color-alert-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-subtle);
    padding: var(--space-3);
    color: var(--color-warning-text);
    font-size: var(--type-body);
}
.eb-controls {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-2);
}

.eb-source {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    min-height: var(--space-6);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
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
</style>
