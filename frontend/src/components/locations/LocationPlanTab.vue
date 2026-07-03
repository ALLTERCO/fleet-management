<template>
    <div class="lpl">
        <component
            :is="planRenderer"
            v-if="planRenderer"
            :location="location"
            @open="onNavigate"
        />
        <div v-else class="lpl__empty">
            <i class="fas fa-cube lpl__empty-icon" aria-hidden="true" />
            <p class="lpl__empty-title">No floor plan here</p>
            <p class="lpl__empty-sub">{{ emptyHint }}</p>
        </div>
    </div>
</template>

<script setup lang="ts">
import {type Component, computed, defineAsyncComponent} from 'vue';
import {isPlanFriendlyKind} from '@/helpers/location-kinds';
import type {ApiLocation, LocationKind} from '@/stores/locations';

const FloorPlanWrapper = defineAsyncComponent(
    () => import('@/components/locations/LocationFloorPlanWrapper.vue')
);
const BuildingFloorStack = defineAsyncComponent(
    () => import('@/components/locations/LocationBuildingFloorStack.vue')
);

const props = defineProps<{
    location: ApiLocation | null;
}>();

const emit = defineEmits<{
    navigate: [locationId: number];
}>();

function onNavigate(locationId: number): void {
    emit('navigate', locationId);
}

// Per-kind renderer. Buildings default to the 3D floor stack but fall back
// to the 2D viewer when the building itself has an uploaded floor plan and
// no child floor locations to stack.
const RENDERERS: Partial<Record<LocationKind, Component>> = {
    building: BuildingFloorStack,
    floor: FloorPlanWrapper,
    room: FloorPlanWrapper,
    area: FloorPlanWrapper,
    zone: FloorPlanWrapper
};

function hasOwnFloorPlan(loc: ApiLocation | null): boolean {
    const p = (loc?.kindFields as {floorPlan?: {url?: string}} | undefined)
        ?.floorPlan;
    return typeof p?.url === 'string' && p.url.length > 0;
}

const planRenderer = computed<Component | null>(() => {
    const loc = props.location;
    if (!loc?.kind) return null;
    if (loc.kind === 'building' && hasOwnFloorPlan(loc)) {
        return FloorPlanWrapper;
    }
    return RENDERERS[loc.kind] ?? null;
});

const emptyHint = computed(() => {
    const loc = props.location;
    if (loc == null) return 'Select a floor or room to see its plan.';
    if (isPlanFriendlyKind(loc.kind)) {
        return 'Use Edit to upload a 2D image, then drop devices onto it.';
    }
    return 'Floor plans live on floors, rooms, areas, and zones.';
});
</script>

<style scoped>
.lpl {
    min-height: 60vh;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.lpl > :first-child {
    flex: 1;
    min-height: 0;
    min-width: 0;
}

.lpl__empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--color-text-tertiary);
    gap: var(--space-2);
    padding: var(--space-5);
}

.lpl__empty-icon {
    font-size: var(--icon-size-xl);
    color: var(--color-text-quaternary);
    margin-bottom: var(--space-2);
}

.lpl__empty-title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    margin: 0;
}

.lpl__empty-sub {
    font-size: var(--type-caption);
    margin: 0;
    max-width: 36ch;
}
</style>
