<template>
    <div
        v-if="geo"
        ref="hostRef"
        class="lgi"
        role="img"
        :aria-label="`Map preview of ${locationName}`"
    >
        <div class="lgi__coords">
            <i class="fas fa-location-dot lgi__coords-icon" aria-hidden="true" />
            <span>{{ coordsLabel }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import maplibregl, {type Map as MapLibreMap} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {circlePolygon} from '@/helpers/map-circle';
import {getMapStyleUrl} from '@/helpers/map-style';
import {applyAppleMapsTint} from '@/helpers/map-tint';
import {hasWebGL} from '@/helpers/webgl';

const props = defineProps<{
    geo: {lat: number; lng: number} | null;
    locationName: string;
    /** Footprint radius shown around the pin in meters. */
    radiusMeters?: number;
}>();

const RADIUS_DEFAULT_M = 200;
const ZOOM_LEVEL = 16;
const FILL_LAYER_ID = 'lgi-footprint-fill';
const STROKE_LAYER_ID = 'lgi-footprint-stroke';
const SOURCE_ID = 'lgi-footprint';

const hostRef = ref<HTMLElement | null>(null);
// Hoisted before the immediate watcher — the first watcher tick may run
// tearDown() while hostRef is still null, which reaches into these. A
// mid-file `let` would TDZ-throw "Cannot access X before initialization".
let mapInstance: MapLibreMap | null = null;
let resizeObserver: ResizeObserver | null = null;
let activeMarker: maplibregl.Marker | null = null;

const coordsLabel = computed(() => {
    if (!props.geo) return '';
    return `${props.geo.lat.toFixed(4)}, ${props.geo.lng.toFixed(4)}`;
});

watch(
    () => [hostRef.value, props.geo?.lat, props.geo?.lng] as const,
    ([host]) => {
        if (!host || !props.geo) {
            tearDown();
            return;
        }
        if (!mapInstance) {
            initMap(host);
        } else {
            recenterMap();
        }
    },
    {immediate: true, flush: 'post'}
);

onBeforeUnmount(tearDown);

function initMap(host: HTMLElement): void {
    if (!hasWebGL()) return;
    if (!props.geo) return;
    const instance = new maplibregl.Map({
        container: host,
        style: getMapStyleUrl(),
        center: [props.geo.lng, props.geo.lat],
        zoom: ZOOM_LEVEL,
        interactive: false,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false
    });
    instance.on('load', () => {
        if (!mapInstance) return;
        applyAppleMapsTint(mapInstance, {buildings: false});
        addFootprint(mapInstance);
        addMarker(mapInstance);
    });
    mapInstance = instance;
    if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => mapInstance?.resize());
        resizeObserver.observe(host);
    }
}

function recenterMap(): void {
    if (!mapInstance || !props.geo) return;
    mapInstance.setCenter([props.geo.lng, props.geo.lat]);
    refreshFootprint(mapInstance);
    refreshMarker(mapInstance);
}

function addFootprint(instance: MapLibreMap): void {
    instance.addSource(SOURCE_ID, {
        type: 'geojson',
        data: footprintFeature()
    });
    instance.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
            'fill-color': '#4495d1',
            'fill-opacity': 0.14
        }
    });
    instance.addLayer({
        id: STROKE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
            'line-color': '#4495d1',
            'line-width': 1.5,
            'line-opacity': 0.65
        }
    });
}

function refreshFootprint(instance: MapLibreMap): void {
    const source = instance.getSource(SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
    source?.setData(footprintFeature());
}

function addMarker(instance: MapLibreMap): void {
    if (!props.geo) return;
    activeMarker = new maplibregl.Marker({color: '#4495d1', scale: 0.85})
        .setLngLat([props.geo.lng, props.geo.lat])
        .addTo(instance);
}

function refreshMarker(_instance: MapLibreMap): void {
    if (!props.geo || !activeMarker) return;
    activeMarker.setLngLat([props.geo.lng, props.geo.lat]);
}

// Empty polygon for the "no geo" case so callers never feed MapLibre null.
const EMPTY_FOOTPRINT: GeoJSON.Feature<GeoJSON.Polygon> = {
    type: 'Feature',
    geometry: {type: 'Polygon', coordinates: [[]]},
    properties: {}
};

function footprintFeature(): GeoJSON.Feature<GeoJSON.Polygon> {
    if (!props.geo) return EMPTY_FOOTPRINT;
    return circlePolygon({
        center: props.geo,
        radiusMeters: props.radiusMeters ?? RADIUS_DEFAULT_M
    });
}

function tearDown(): void {
    resizeObserver?.disconnect();
    resizeObserver = null;
    activeMarker?.remove();
    activeMarker = null;
    mapInstance?.remove();
    mapInstance = null;
}
</script>

<style scoped>
.lgi {
    position: relative;
    width: 100%;
    height: 160px;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
}

.lgi__coords {
    position: absolute;
    bottom: var(--space-2);
    right: var(--space-2);
    z-index: 1;
    pointer-events: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) var(--space-2);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
}

.lgi__coords-icon {
    color: var(--color-primary);
    font-size: var(--icon-size-2xs);
}
</style>
