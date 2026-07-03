<template>
    <transition name="building-stage">
        <section
            v-if="location"
            class="bld-stage"
            role="dialog"
            :aria-label="`${location.name} 3D view`"
        >
            <header class="bld-stage__head">
                <button
                    type="button"
                    class="bld-stage__close"
                    aria-label="Close 3D view"
                    @click="emit('close')"
                >
                    <i class="fas fa-arrow-left" aria-hidden="true" />
                    <span>Back to map</span>
                </button>
                <div class="bld-stage__title">{{ location.name }}</div>
            </header>
            <div class="bld-stage__canvas">
                <LocationBuildingFloorStack
                    :location="location"
                    @open="(floorId: number) => emit('openFloor', floorId)"
                />
            </div>
        </section>
    </transition>
</template>

<script setup lang="ts">
import type {Location as ApiLocation} from '@api/location';
import LocationBuildingFloorStack from '@/components/locations/LocationBuildingFloorStack.vue';

defineProps<{location: ApiLocation | null}>();
const emit = defineEmits<{
    close: [];
    openFloor: [floorId: number];
}>();
</script>

<style scoped>
.bld-stage {
    position: absolute;
    inset: 0;
    z-index: 9;
    display: flex;
    flex-direction: column;
    background: var(--color-surface-bg);
}
.bld-stage__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border-default);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
}
.bld-stage__close {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-md);
    background: transparent;
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
}
.bld-stage__close:hover {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
}
.bld-stage__title {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.bld-stage__canvas {
    flex: 1;
    min-height: 0;
    position: relative;
}
.building-stage-enter-active,
.building-stage-leave-active {
    transition:
        opacity var(--duration-normal) var(--ease-out-expo),
        transform var(--duration-moderate) var(--ease-out-expo);
}
.building-stage-enter-from,
.building-stage-leave-to {
    opacity: 0;
    transform: scale(0.98);
}
</style>
