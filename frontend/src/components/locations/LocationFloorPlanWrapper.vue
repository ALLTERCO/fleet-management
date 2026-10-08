<template>
    <LocationFloorPlanSection
        v-if="props.location"
        :location="props.location"
        :devices="floorPlanDevices"
        :can-edit="canWrite"
        :can-import="canUpdateLocation"
        :can-draw="canUpdateLocation"
        @device-click="openDeviceInspector"
        @request-upload="$emit('request-upload')"
    />
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted} from 'vue';
import type {FloorPlanDevice} from '@/components/core/FloorPlanCanvas.vue';
import LocationFloorPlanSection from '@/components/core/LocationFloorPlanSection.vue';
import {useLocationDeviceScope} from '@/composables/useLocationDeviceScope';
import {usePermissions} from '@/composables/usePermissions';
import {DeviceBoard} from '@/helpers/components';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import type {ApiLocation} from '@/stores/locations';
import {useRightSideMenuStore} from '@/stores/right-side';
import {trackInteraction} from '@/tools/observability';

const props = defineProps<{
    location: ApiLocation;
}>();

defineEmits<{
    'request-upload': [];
}>();

const {canWrite} = usePermissions();
const authStore = useAuthStore();
const devicesStore = useDevicesStore();
const rightSideStore = useRightSideMenuStore();

// Importing and drawing both write geometry through location.Update, which
// the backend gates with CrudPermission('locations', 'update', (p) => p?.id).
// Asked once, here, so the UI never offers work the save would reject —
// and so both surfaces can never disagree about who may edit this floor.
const canUpdateLocation = computed(() =>
    authStore.canPerformComponent('locations', 'update', props.location.id)
);

// Reuse the inspector the device list and dashboards already open, so a
// device on the plan lands on the controls users know rather than a
// plan-only surface.
function openDeviceInspector(shellyId: string): void {
    void rightSideStore.showInspector(DeviceBoard, {shellyID: shellyId});
    trackInteraction('locations', 'plan_device_open', shellyId);
}

const rootIds = computed(() => [props.location.id]);
const {allDeviceIds} = useLocationDeviceScope(rootIds);

// Hash a string to a stable pin color so each device renders distinct.
function colorFromId(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) {
        h = (h * 31 + id.charCodeAt(i)) >>> 0;
    }
    return h & 0xffffff;
}

const floorPlanDevices = computed<FloorPlanDevice[]>(() => {
    const out: FloorPlanDevice[] = [];
    for (const shellyId of allDeviceIds.value) {
        const dev = devicesStore.devices[shellyId];
        if (!dev) continue;
        out.push({
            id: shellyId,
            placementId: String(dev.id),
            label: dev.info?.name ?? shellyId,
            color: colorFromId(shellyId),
            online: dev.online ?? true,
            level: extractDeviceLevel(shellyId),
            componentTypes: componentTypesOf(shellyId)
        });
    }
    return out;
});

// What the device says it is, straight from the status keys the backend
// sends ("switch:0" -> "switch"). No local table of models or profiles.
function componentTypesOf(shellyId: string): string[] {
    const status = devicesStore.devices[shellyId]?.status;
    if (!status) return [];
    const types = new Set<string>();
    for (const key of Object.keys(status)) {
        const colon = key.indexOf(':');
        types.add(colon === -1 ? key : key.slice(0, colon));
    }
    return [...types];
}

const OUTPUT_STATUS_KEYS = ['switch:0', 'light:0', 'cover:0', 'rgb:0', 'rgbw:0'];

// Read device output intensity 0..1 from common Shelly status components.
// Goes through statusOf so an optimistic toggle lights the fixture at once
// instead of waiting for the device to echo the new state back.
// Returns 1 when no output is found so the fixture renders at full brightness.
function extractDeviceLevel(shellyId: string): number {
    for (const key of OUTPUT_STATUS_KEYS) {
        const comp = devicesStore.statusOf(shellyId, key) as
            | Record<string, unknown>
            | undefined;
        if (!comp || typeof comp !== 'object') continue;
        if (typeof comp.brightness === 'number') {
            return Math.max(0, Math.min(1, comp.brightness / 100));
        }
        if (typeof comp.output === 'boolean') return comp.output ? 1 : 0;
    }
    return 1;
}

onMounted(() => {
    trackInteraction(
        'locations',
        'plan_render',
        `${props.location.kind}:${props.location.id}`
    );
});

onUnmounted(() => rightSideStore.clearInspector());
</script>
