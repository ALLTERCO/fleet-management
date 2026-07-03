<template>
    <LocationFloorPlanSection
        v-if="props.location"
        :location="props.location"
        :devices="floorPlanDevices"
        :can-edit="canWrite"
        @request-upload="$emit('request-upload')"
    />
</template>

<script setup lang="ts">
import {computed, onMounted} from 'vue';
import type {FloorPlanDevice} from '@/components/core/FloorPlanCanvas.vue';
import LocationFloorPlanSection from '@/components/core/LocationFloorPlanSection.vue';
import {useLocationDeviceScope} from '@/composables/useLocationDeviceScope';
import {usePermissions} from '@/composables/usePermissions';
import {useDevicesStore} from '@/stores/devices';
import type {ApiLocation} from '@/stores/locations';
import {trackInteraction} from '@/tools/observability';

const props = defineProps<{
    location: ApiLocation;
}>();

defineEmits<{
    'request-upload': [];
}>();

const {canWrite} = usePermissions();
const devicesStore = useDevicesStore();

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
            label: dev.info?.name ?? shellyId,
            color: colorFromId(shellyId),
            online: dev.online ?? true,
            level: extractDeviceLevel(dev.status)
        });
    }
    return out;
});

// Read device output intensity 0..1 from common Shelly status components.
// Returns 1 when no output is found so the fixture renders at full brightness.
function extractDeviceLevel(status: Record<string, unknown> | undefined): number {
    if (!status) return 1;
    const candidates = ['switch:0', 'light:0', 'cover:0', 'rgb:0', 'rgbw:0'];
    for (const key of candidates) {
        const comp = status[key] as Record<string, unknown> | undefined;
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
</script>
