

<template>
    <BoardTabs v-if="entity && device" @back="openDevice(entity.source)">
        <template #title>
            <span class="text-lg font-semibold line-clamp-2">{{ entity.name }}</span>
        </template>
        <template #info>
            <div class="flex flex-col gap-3 items-center pt-3">
                <figure class="w-20 h-20 rounded-full border-2 flex items-center justify-center" :class="[
                    device.online && !device.loading && 'border-[var(--color-border-strong)]',
                    !device.online && !device.loading && 'border-[var(--color-danger)]',
                    device.loading && 'border-[var(--color-warning)]',
                ]">
                    <i class="text-2xl" :class="getPredefinedImageForEntity(entity.type)"></i>
                </figure>
                <span class="text-[var(--color-text-tertiary)] text-xs">{{ entity.type }} - {{ device.info?.app }}</span>

                <div v-if="device.loading" class="flex flex-col items-center gap-1">
                    <Spinner />
                    <span class="text-sm font-semibold text-[var(--color-warning-text)] animate-pulse">Loading</span>
                </div>

                <span v-if="!device.online && !device.loading" class="text-sm font-semibold text-[var(--color-danger-text)]">Offline</span>

                <div class="w-full flex flex-col gap-2">
                    <EntityEM v-if="entity.type === 'em'" :entity='entity as em_entity'/>

                    <!-- Entity-type template (meter, switch, light, cover) -->
                    <component
                        :is="entityTemplate"
                        v-if="entityTemplate && device.online && entity.type !== 'em' && entity.type !== 'cury'"
                        :status="entityStatus"
                        :settings="entitySettings"
                        :can-execute="canExecute"
                        :favorites="entity.type === 'cover' ? (entity as cover_entity).properties.favorites : undefined"
                        @toggle="toggleEntity"
                        @set-rgb="rgbChange"
                        @set-white="whiteChange"
                        @set-brightness="brightnessChange"
                        @set-temp="colorTempChange"
                        @set-position="positionChange"
                        @open="coverCommand('Open')"
                        @stop="coverCommand('Stop')"
                        @close="coverCommand('Close')"
                    />

                    <!-- Fallback: generic tags for types without a dedicated template -->
                    <EntityWidget v-if="!entityTemplate || entity.type === 'cury'" vertical :entity="entity" />

                    <!-- Cury (Scent Diffuser) controls -->
                    <template v-if="entity.type === 'cury' && device.online">
                        <div class="flex flex-col gap-2 p-3 bg-[var(--color-surface-2)] rounded-lg">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2">
                                    <span class="text-sm font-semibold text-[var(--color-text-primary)]">Left Slot</span>
                                    <span v-if="entityStatus?.slots?.left?.vial?.name" class="text-xs text-[var(--color-text-tertiary)]">
                                        ({{ entityStatus.slots.left.vial.name }})
                                    </span>
                                </div>
                                <button
                                    v-if="isCurySlotAvailable('left')"
                                    class="w-10 h-10 rounded-full"
                                    :class="{
                                        'bg-[var(--color-success)]': entityStatus?.slots?.left?.on,
                                        'bg-[var(--color-surface-4)]': !entityStatus?.slots?.left?.on
                                    }"
                                    @click="toggleCurySlot('left')"
                                >
                                    <i class="fas fa-power-off"></i>
                                </button>
                                <span v-else class="text-xs text-[var(--color-text-disabled)]">No vial</span>
                            </div>
                            <div v-if="isCurySlotAvailable('left')" class="flex flex-col gap-2">
                                <HorizontalSlider
                                    :value="entityStatus?.slots?.left?.intensity ?? 50"
                                    :min="0" :max="100" :step="10"
                                    :saved="{ '0%': 0, '25%': 25, '50%': 50, '75%': 75, '100%': 100 }"
                                    @change="(v: number) => setCurySlotIntensity('left', v)"
                                >
                                    <template #title> Intensity ({{ entityStatus?.slots?.left?.intensity ?? 0 }}%) </template>
                                </HorizontalSlider>
                                <div class="flex gap-2">
                                    <button
                                        v-if="!entityStatus?.slots?.left?.boost"
                                        class="flex-1 py-2 rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-sm"
                                        :class="{ 'opacity-50 cursor-not-allowed': !entityStatus?.slots?.left?.on }"
                                        :disabled="!entityStatus?.slots?.left?.on"
                                        @click="boostCurySlot('left')"
                                    >
                                        <i class="fas fa-rocket mr-1"></i> Boost
                                    </button>
                                    <button
                                        v-else
                                        class="flex-1 py-2 rounded-lg bg-[var(--color-orange)] hover:bg-[var(--color-orange-hover)] text-sm"
                                        @click="stopBoostCurySlot('left')"
                                    >
                                        <i class="fas fa-stop mr-1"></i> Stop Boost
                                    </button>
                                </div>
                            </div>
                            <div class="flex items-center justify-between text-sm">
                                <span class="text-[var(--color-text-tertiary)]">Vial Level</span>
                                <span :class="getVialLevelClass(entityStatus?.slots?.left?.vial)">
                                    {{ formatVialLevel(entityStatus?.slots?.left?.vial) }}
                                </span>
                            </div>
                        </div>
                        <div class="flex flex-col gap-2 p-3 bg-[var(--color-surface-2)] rounded-lg">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-2">
                                    <span class="text-sm font-semibold text-[var(--color-text-primary)]">Right Slot</span>
                                    <span v-if="entityStatus?.slots?.right?.vial?.name" class="text-xs text-[var(--color-text-tertiary)]">
                                        ({{ entityStatus.slots.right.vial.name }})
                                    </span>
                                </div>
                                <button
                                    v-if="isCurySlotAvailable('right')"
                                    class="w-10 h-10 rounded-full"
                                    :class="{
                                        'bg-[var(--color-success)]': entityStatus?.slots?.right?.on,
                                        'bg-[var(--color-surface-4)]': !entityStatus?.slots?.right?.on
                                    }"
                                    @click="toggleCurySlot('right')"
                                >
                                    <i class="fas fa-power-off"></i>
                                </button>
                                <span v-else class="text-xs text-[var(--color-text-disabled)]">No vial</span>
                            </div>
                            <div v-if="isCurySlotAvailable('right')" class="flex flex-col gap-2">
                                <HorizontalSlider
                                    :value="entityStatus?.slots?.right?.intensity ?? 50"
                                    :min="0" :max="100" :step="10"
                                    :saved="{ '0%': 0, '25%': 25, '50%': 50, '75%': 75, '100%': 100 }"
                                    @change="(v: number) => setCurySlotIntensity('right', v)"
                                >
                                    <template #title> Intensity ({{ entityStatus?.slots?.right?.intensity ?? 0 }}%) </template>
                                </HorizontalSlider>
                                <div class="flex gap-2">
                                    <button
                                        v-if="!entityStatus?.slots?.right?.boost"
                                        class="flex-1 py-2 rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-sm"
                                        :class="{ 'opacity-50 cursor-not-allowed': !entityStatus?.slots?.right?.on }"
                                        :disabled="!entityStatus?.slots?.right?.on"
                                        @click="boostCurySlot('right')"
                                    >
                                        <i class="fas fa-rocket mr-1"></i> Boost
                                    </button>
                                    <button
                                        v-else
                                        class="flex-1 py-2 rounded-lg bg-[var(--color-orange)] hover:bg-[var(--color-orange-hover)] text-sm"
                                        @click="stopBoostCurySlot('right')"
                                    >
                                        <i class="fas fa-stop mr-1"></i> Stop Boost
                                    </button>
                                </div>
                            </div>
                            <div class="flex items-center justify-between text-sm">
                                <span class="text-[var(--color-text-tertiary)]">Vial Level</span>
                                <span :class="getVialLevelClass(entityStatus?.slots?.right?.vial)">
                                    {{ formatVialLevel(entityStatus?.slots?.right?.vial) }}
                                </span>
                            </div>
                        </div>
                        <div class="flex flex-col gap-2 p-3 bg-[var(--color-surface-2)] rounded-lg">
                            <span class="text-sm font-semibold text-[var(--color-text-primary)]">Ambient Light</span>
                            <div class="flex items-center gap-3">
                                <ColorWheel :rgb="curyAmbientColor" @change="setCuryAmbientColor" />
                                <div class="flex flex-col gap-1 text-sm">
                                    <span class="text-[var(--color-text-tertiary)]">Current color</span>
                                    <div class="flex items-center gap-2">
                                        <div
                                            class="w-6 h-6 rounded-full border border-[var(--color-border-strong)]"
                                            :style="{ backgroundColor: `rgb(${curyAmbientColor.join(',')})` }"
                                        ></div>
                                        <span class="text-[var(--color-text-secondary)] font-mono text-xs">
                                            {{ curyAmbientColor.join(', ') }}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center justify-between p-3 bg-[var(--color-surface-2)] rounded-lg">
                            <span class="text-sm text-[var(--color-text-primary)]">Away Mode</span>
                            <button
                                class="w-10 h-10 rounded-full"
                                :class="{
                                    'bg-[var(--color-success)]': entityStatus?.away_mode,
                                    'bg-[var(--color-surface-4)]': !entityStatus?.away_mode
                                }"
                                @click="toggleCuryAwayMode"
                            >
                                <i class="fas" :class="entityStatus?.away_mode ? 'fa-plane-departure' : 'fa-home'"></i>
                            </button>
                        </div>
                        <div v-if="entityStatus?.errors?.length" class="p-3 bg-[var(--color-danger-subtle)] rounded-lg">
                            <span class="text-sm text-[var(--color-danger-text)] font-semibold block mb-1">
                                <i class="fas fa-triangle-exclamation mr-1"></i> Issues Detected
                            </span>
                            <span v-for="(err, i) in entityStatus?.errors" :key="i" class="text-xs text-[var(--color-danger-text)] block">
                                {{ formatCuryError(err) }}
                            </span>
                        </div>
                    </template>
                </div>
            </div>
        </template>
        <template #debug>
            <Collapse v-if="device.online" title="Entity" class="w-full">
                <Input v-model="newName" label="Entity name" />
                <Button class="mt-2 w-full" @click="saveNewName"> Save </Button>
            </Collapse>

            <Collapse title="Info">
                <JSONViewer :data="entity as any" />
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
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Collapse from '@/components/core/Collapse.vue';
import {resolveEntityTemplate} from '@/components/entity-templates';
import Input from '@/components/core/Input.vue';
import EntityWidget from '@/components/widgets/EntityWidget.vue';
import {DeviceBoard} from '@/helpers/components';
import {getPredefinedImageForEntity} from '@/helpers/device';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import {cover_entity, em_entity, type entity_t} from '@/types';
import EntityEM from '../core/Meters/EntityEM.vue';
import Spinner from '../core/Spinner.vue';
import JSONViewer from '../JSONViewer.vue';
import BoardTabs from './BoardTabs.vue';

type props_t = {entity: entity_t};

const props = defineProps<props_t>();
// Use the passed entity's ID to fetch from store - this makes the entity reactive to store updates
const entityId = computed(() => props.entity.id);

const entityStore = useEntityStore();
const toastStore = useToastStore();
const deviceStore = useDevicesStore();
const rightSideStore = useRightSideMenuStore();

// Fetch entity from store to get reactive updates when name changes
const entity = computed(
    () => entityStore.entities[entityId.value] ?? props.entity
);

const newName = ref(entity.value.name);

const device = computed(() => deviceStore.devices[entity.value.source]);
const entityStatus = computed(
    () =>
        device.value?.status?.[
            entity.value.type + ':' + entity.value.properties.id
        ]
);

const authStore = useAuthStore();
const canExecute = computed(() => authStore.canExecuteDevice(entity.value.source));

const entityTemplate = computed(() => resolveEntityTemplate(entity.value.type));

const entitySettings = computed(
    () => device.value?.settings?.[entity.value.type + ':' + entity.value.properties.id]
);

const statusKey = computed(() => {
    if (entity.value.properties.id != undefined) {
        return `${entity.value.type}:${entity.value.properties.id}`;
    }

    return entity.value.type;
});

// Fetch full device data (including settings) — the initial list load
// uses toListJSON() which strips settings for performance.
onMounted(() => {
    const shellyID = entity.value.source;
    ws.sendRPC('FLEET_MANAGER', 'device.Get', {shellyID})
        .then((fullDevice: any) => {
            if (fullDevice) deviceStore.handleNewDevice(fullDevice);
        })
        .catch(() => {});
});

async function saveNewName() {
    try {
        // Capitalize first letter of entity type for proper Shelly RPC method format
        const componentType =
            entity.value.type.charAt(0).toUpperCase() +
            entity.value.type.slice(1);
        await entityStore.sendRPC(
            entity.value.id,
            componentType + '.SetConfig',
            {
                config: {name: newName.value}
            }
        );
        // Wait for backend to process config_changed event from the device
        await new Promise((resolve) => setTimeout(resolve, 500));
        await entityStore.updateEntity(entity.value.id);
        toastStore.success('Entity renamed successfully');
    } catch (error) {
        toastStore.error('Failed to rename entity');
        console.error(error);
    }
}

function openDevice(source: string) {
    rightSideStore.setActiveComponent(DeviceBoard, {shellyID: source});
}

async function setValue(
    componentType: string,
    propName: string,
    value: any,
    method: string = 'set'
) {
    if (!device.value) {
        console.warn('[setValue] No device found for entity:', entity.value);
        return;
    }

    try {
        await deviceStore.sendRPC(
            device.value.shellyID,
            `${componentType}.${method}`,
            {
                id: entity.value.properties.id,
                [propName]: value
            }
        );
    } catch (e) {
        console.error(`[EntityBoard] Failed to set ${propName}:`, e);
    }
}

function rgbChange(rgb: [number, number, number]) {
    setValue(entity.value.type, 'rgb', rgb);
}

function whiteChange(value: number) {
    setValue('rgbw', 'white', value);
}

function brightnessChange(value: number) {
    setValue(entity.value.type, 'brightness', value);
}

function colorTempChange(value: number) {
    setValue(entity.value.type, 'temp', value);
}

function positionChange(value: number) {
    setValue(entity.value.type, 'pos', value, 'GoToPosition');
}

function toggleEntity() {
    setValue(entity.value.type, 'on', !entityStatus.value?.output, 'Set');
}

function coverCommand(method: string) {
    if (!device.value) return;
    const type = entity.value.type.charAt(0).toUpperCase() + entity.value.type.slice(1);
    deviceStore.sendRPC(device.value.shellyID, `${type}.${method}`, {
        id: entity.value.properties.id
    }).catch((e) => console.error(`[EntityBoard] Cover ${method} failed:`, e));
}

// Cury (Scent Diffuser) controls

// Check if a slot has a vial inserted (serial is not all zeros)
function isCurySlotAvailable(slot: 'left' | 'right'): boolean {
    const vial = entityStatus.value?.slots?.[slot]?.vial;
    if (!vial) return false;
    // Serial "0000000000000000" means no vial inserted
    return vial.serial && vial.serial !== '0000000000000000';
}

// Toggle on/off for a specific slot
async function toggleCurySlot(slot: 'left' | 'right') {
    if (!device.value) return;
    const currentState = entityStatus.value?.slots?.[slot]?.on ?? false;
    try {
        await deviceStore.sendRPC(device.value.shellyID, 'Cury.Set', {
            id: entity.value.properties.id,
            slot,
            on: !currentState
        });
    } catch (e) {
        console.error(`[EntityBoard] Failed to toggle Cury slot ${slot}:`, e);
    }
}

// Set intensity for a specific slot
async function setCurySlotIntensity(slot: 'left' | 'right', intensity: number) {
    if (!device.value) return;
    try {
        await deviceStore.sendRPC(device.value.shellyID, 'Cury.Set', {
            id: entity.value.properties.id,
            slot,
            intensity
        });
    } catch (e) {
        console.error(`[EntityBoard] Failed to set Cury slot intensity:`, e);
    }
}

// Boost a specific slot
async function boostCurySlot(slot: 'left' | 'right') {
    if (!device.value) return;
    try {
        await deviceStore.sendRPC(device.value.shellyID, 'Cury.Boost', {
            id: entity.value.properties.id,
            slot
        });
    } catch (e) {
        console.error(`[EntityBoard] Failed to boost Cury slot ${slot}:`, e);
    }
}

// Stop boost for a specific slot
async function stopBoostCurySlot(slot: 'left' | 'right') {
    if (!device.value) return;
    try {
        await deviceStore.sendRPC(device.value.shellyID, 'Cury.StopBoost', {
            id: entity.value.properties.id,
            slot
        });
    } catch (e) {
        console.error(`[EntityBoard] Failed to stop Cury boost ${slot}:`, e);
    }
}

// Get current ambient color from device settings
const curyAmbientColor = computed((): [number, number, number] => {
    const color = device.value?.settings?.['cury:0']?.ambient?.color;
    if (Array.isArray(color) && color.length === 3) {
        return color as [number, number, number];
    }
    return [255, 255, 255]; // Default white
});

// Set ambient light color
async function setCuryAmbientColor(rgb: [number, number, number]) {
    if (!device.value) return;
    try {
        await deviceStore.sendRPC(device.value.shellyID, 'Cury.SetConfig', {
            id: entity.value.properties.id,
            config: {
                ambient: {
                    color: rgb
                }
            }
        });
    } catch (e) {
        console.error('[EntityBoard] Failed to set Cury ambient color:', e);
    }
}

async function toggleCuryAwayMode() {
    if (!device.value) return;
    const currentAwayMode = entityStatus.value?.away_mode ?? false;
    try {
        await deviceStore.sendRPC(device.value.shellyID, 'Cury.SetAwayMode', {
            id: entity.value.properties.id,
            away_mode: !currentAwayMode
        });
    } catch (e) {
        console.error('[EntityBoard] Failed to toggle Cury away mode:', e);
    }
}

// Format vial object to display level
function getVialLevelClass(
    vial: {level?: number; serial?: string} | undefined | null
): string {
    if (!vial) return 'text-[var(--color-text-tertiary)]';
    // No vial inserted
    if (!vial.serial || vial.serial === '0000000000000000')
        return 'text-[var(--color-text-disabled)]';
    const level = vial.level;
    if (level === undefined || level === null || level < 0)
        return 'text-[var(--color-text-tertiary)]';
    if (level <= 20) return 'text-[var(--color-danger-text)]';
    if (level <= 50) return 'text-[var(--color-warning-text)]';
    return 'text-[var(--color-success-text)]';
}

function formatVialLevel(
    vial: {level?: number; serial?: string} | undefined | null
): string {
    if (!vial) return 'N/A';
    // No vial inserted (serial is all zeros)
    if (!vial.serial || vial.serial === '0000000000000000')
        return 'Not inserted';
    const level = vial.level;
    if (level === undefined || level === null) return 'N/A';
    if (level < 0) return 'Reading...';
    return `${level}%`;
}

// Format Cury error codes to human-readable messages
function formatCuryError(error: string): string {
    const errorMessages: Record<string, string> = {
        orientation_tilt: 'Device is tilted - please place it upright',
        orientation_upside_down: 'Device is upside down',
        vial_fault: 'Vial fault detected',
        heater_fault: 'Heater fault',
        fan_fault: 'Fan fault',
        temperature_high: 'Temperature too high',
        temperature_low: 'Temperature too low'
    };
    return errorMessages[error] || error;
}
</script>
