<template>
    <div class="lm">
        <MapCanvas
            ref="canvasRef"
            :initial="initialViewport"
            class="lm-canvas"
        />
    </div>
</template>

<script setup lang="ts">
import maplibregl, {
    type Map as MapLibreMap,
    type Marker
} from 'maplibre-gl';
import {computed, onBeforeUnmount, ref, watch} from 'vue';
// biome-ignore lint/style/useImportType: Vue SFC template registration needs the value binding at runtime.
import MapCanvas from '@/components/core/maps/MapCanvas.vue';
import {useDeckOverlay} from '@/composables/useDeckOverlay';
import {MAP_DETAIL_ZOOM, MAP_FLY_DURATION_MS} from '@/constants';
import {childIconLayer, locationPinLayers} from '@/helpers/map-layers';
import type {MapPin, MapViewport} from '@/types/map';

const props = withDefaults(
    defineProps<{
        center: MapPin;
        children?: MapPin[];
        zoom?: number;
        interleaved?: boolean;
        draggable?: boolean;
    }>(),
    {
        children: () => [],
        zoom: MAP_DETAIL_ZOOM,
        interleaved: true,
        draggable: false
    }
);

const emit = defineEmits<{
    childClick: [pin: MapPin];
    pinMove: [coords: {lat: number; lng: number}];
}>();

const canvasRef = ref<InstanceType<typeof MapCanvas> | null>(null);

const initialViewport = computed<MapViewport>(() => ({
    longitude: props.center.lng,
    latitude: props.center.lat,
    zoom: props.zoom,
    pitch: 0,
    bearing: 0
}));

const mapRef = computed(() => canvasRef.value?.map ?? null);
const loadedRef = computed(() => canvasRef.value?.loaded ?? false);

const layers = computed(() => [
    ...locationPinLayers([props.center]),
    childIconLayer(props.children, (p) => emit('childClick', p))
]);

useDeckOverlay(mapRef, layers, {interleaved: props.interleaved});

watch(
    () => [props.center.lat, props.center.lng] as const,
    ([lat, lng]) => {
        flyTo(mapRef.value, lng, lat, props.zoom);
    }
);

function flyTo(
    map: MapLibreMap | null,
    lng: number,
    lat: number,
    zoom: number
) {
    map?.flyTo({center: [lng, lat], zoom, duration: MAP_FLY_DURATION_MS});
}

// Draggable marker is opt-in; deck.gl pin layer renders the center otherwise.
let draggableMarker: Marker | null = null;

watch(
    [mapRef, () => props.draggable],
    ([m, isDraggable]) => {
        detachDraggableMarker();
        if (!m || !isDraggable) return;
        draggableMarker = createDraggableMarker(m);
    },
    {immediate: true}
);

watch(
    () => [props.center.lat, props.center.lng] as const,
    ([lat, lng]) => {
        if (props.draggable) draggableMarker?.setLngLat([lng, lat]);
    }
);

function createDraggableMarker(map: MapLibreMap): Marker {
    const marker = new maplibregl.Marker({draggable: true, color: '#4495D1'});
    marker.setLngLat([props.center.lng, props.center.lat]).addTo(map);
    marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        emit('pinMove', {lat: lngLat.lat, lng: lngLat.lng});
    });
    return marker;
}

function detachDraggableMarker(): void {
    if (draggableMarker !== null) {
        draggableMarker.remove();
        draggableMarker = null;
    }
}

onBeforeUnmount(() => {
    detachDraggableMarker();
});
</script>

<style scoped>
.lm,
.lm-canvas {
    position: relative;
    height: 100%;
    width: 100%;
    min-height: 360px;
    border-radius: var(--radius-lg);
}
.lm-controls {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    display: flex;
    gap: var(--space-1);
    z-index: 2;
}
.lm-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: color-mix(in srgb, var(--color-surface-2) 90%, transparent);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast);
}
.lm-btn:hover {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.lm-btn--active {
    background: color-mix(in srgb, var(--color-primary) 25%, var(--color-surface-2));
    border-color: var(--color-primary);
    color: var(--color-primary-text);
}
</style>
