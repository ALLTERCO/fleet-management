<template>
    <div ref="hostRef" class="mc-host">
        <div v-if="unsupported" class="mc-fallback">
            Map view unavailable — WebGL is disabled in this browser.
        </div>
        <MapSkeleton v-else-if="!loaded" />
        <slot :map="map" :loaded="loaded" />
    </div>
</template>

<script setup lang="ts">
import MapSkeleton from '@/components/core/maps/MapSkeleton.vue';
import {useMapInstance} from '@/composables/useMapInstance';
import {DEFAULT_VIEWPORT, type MapViewport} from '@/types/map';
import 'maplibre-gl/dist/maplibre-gl.css';
import {ref} from 'vue';

// Generic MapLibre canvas. Slot receives {map, loaded} for overlays.

const props = withDefaults(
    defineProps<{
        initial?: MapViewport;
        showNavControl?: boolean;
        showAttribution?: boolean;
        enableBuildings?: boolean;
        suppressMinorLabels?: boolean;
    }>(),
    {
        initial: () => DEFAULT_VIEWPORT,
        showNavControl: true,
        showAttribution: true,
        enableBuildings: true,
        suppressMinorLabels: false
    }
);

const hostRef = ref<HTMLElement | null>(null);
const {map, loaded, unsupported} = useMapInstance(hostRef, props.initial, {
    showNavControl: props.showNavControl,
    showAttribution: props.showAttribution,
    enableBuildings: props.enableBuildings,
    suppressMinorLabels: props.suppressMinorLabels
});
defineExpose({map, loaded, unsupported});
</script>

<style scoped>
.mc-host {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-surface-1);
}
.mc-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-md);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    text-align: center;
    background: var(--color-surface-1);
}
.mc-host :deep(.maplibregl-ctrl-attrib) {
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.mc-host :deep(.maplibregl-ctrl-attrib a) {
    color: var(--color-primary-text);
}
.mc-host :deep(.maplibregl-ctrl-group) {
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    box-shadow: var(--shadow-card-sm, none);
}
.mc-host :deep(.maplibregl-ctrl-group button) {
    background: transparent;
}
.mc-host :deep(.maplibregl-ctrl-group button:hover) {
    background: var(--color-surface-3);
}
.mc-host :deep(.maplibregl-ctrl-icon) {
    filter: invert(0.85);
}
</style>
