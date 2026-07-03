<template>
    <div ref="hostRef" class="erm">
        <div v-if="unsupported" class="erm-fallback">
            Replay map unavailable — WebGL is disabled in this browser.
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useDeckOverlay} from '@/composables/useDeckOverlay';
import {useMapInstance} from '@/composables/useMapInstance';
import {REPLAY_TRAIL_LENGTH_SEC} from '@/constants';
import {type TripPath, tripsLayer} from '@/helpers/map-trips';
import {DEFAULT_VIEWPORT, type MapViewport} from '@/types/map';

// Map presentation for Location.EventReplay output. The scrubber owns
// `currentTime` and the trips array; this component just renders them.

const props = defineProps<{
    trips: TripPath[];
    currentTime: number;
}>();

const hostRef = ref<HTMLElement | null>(null);

const tripBounds = computed<[[number, number], [number, number]] | null>(() => {
    let minLng = 180,
        minLat = 90,
        maxLng = -180,
        maxLat = -90;
    let any = false;
    for (const t of props.trips) {
        for (const [lng, lat] of t.path) {
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
            any = true;
            if (lng < minLng) minLng = lng;
            if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng;
            if (lat > maxLat) maxLat = lat;
        }
    }
    return any ? [[minLng, minLat], [maxLng, maxLat]] : null;
});

// Center on the trips' centroid for first paint; fitBounds below refines.
const initial = computed<MapViewport>(() => {
    const b = tripBounds.value;
    if (!b) return DEFAULT_VIEWPORT;
    return {
        longitude: (b[0][0] + b[1][0]) / 2,
        latitude: (b[0][1] + b[1][1]) / 2,
        zoom: 11
    };
});

const {map, loaded, unsupported} = useMapInstance(hostRef, initial.value);

const layers = computed(() => [
    tripsLayer(
        'fm-event-replay',
        props.trips,
        props.currentTime,
        REPLAY_TRAIL_LENGTH_SEC
    )
]);

useDeckOverlay(map, layers);

let lastFitSig = '';
watch(
    () => [loaded.value, tripBounds.value],
    () => {
        const m = map.value;
        const b = tripBounds.value;
        if (!m || !loaded.value || !b) return;
        const sig = `${b[0][0]},${b[0][1]},${b[1][0]},${b[1][1]}`;
        if (sig === lastFitSig) return;
        lastFitSig = sig;
        m.fitBounds(b, {padding: 32, duration: 0});
    },
    {immediate: true}
);
</script>

<style scoped>
.erm {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 320px;
    border-radius: var(--radius-lg);
    overflow: hidden;
}
.erm-fallback {
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
</style>
