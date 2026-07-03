<template>
    <div v-if="state !== 'hidden'" class="agb" :class="`agb--${state}`">
        <span v-if="state === 'checking'" class="agb__line">
            <i class="fas fa-spinner fa-spin" aria-hidden="true" /> Checking address…
        </span>
        <span v-else-if="state === 'match'" class="agb__line">
            <i class="fas fa-circle-check" aria-hidden="true" /> Pin matches the address
        </span>
        <span v-else-if="state === 'nofix'" class="agb__line">
            <i class="fas fa-circle-question" aria-hidden="true" />
            Could not locate this address on the map
        </span>
        <template v-else-if="state === 'mismatch'">
            <span class="agb__line">
                <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                Pin is {{ distanceLabel }} from the address
            </span>
            <button
                type="button"
                class="agb__fix"
                :disabled="applying"
                @click="movePinToAddress"
            >
                <i :class="applying ? 'fas fa-spinner fa-spin' : 'fas fa-location-crosshairs'" />
                Move pin to address
            </button>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {geoDistanceMeters} from '@/helpers/geoDistance';
import {type PlaceCandidate, searchPlaces} from '@/helpers/placeSearch';
import {useLocationsStore} from '@/stores/locations';

const props = defineProps<{
    locationId: number;
    address: Record<string, unknown> | null | undefined;
    geo: {lat: number; lng: number} | null | undefined;
}>();

// A stored pin within this many metres of the geocoded address is "matching".
const MATCH_THRESHOLD_M = 150;

type State = 'hidden' | 'checking' | 'match' | 'mismatch' | 'nofix';

const locations = useLocationsStore();
const state = ref<State>('hidden');
const best = ref<PlaceCandidate | null>(null);
const distanceLabel = ref('');
const applying = ref(false);
let activeRequest = 0;

function str(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

// Free-text query built from the stored address parts.
const query = computed(() => {
    const a = props.address;
    if (!a || typeof a !== 'object') return '';
    const street = [str(a.streetNumber), str(a.streetName)]
        .filter(Boolean)
        .join(' ');
    return [street, str(a.city), str(a.region), str(a.postalCode), str(a.countryCode)]
        .filter(Boolean)
        .join(', ');
});

// Only meaningful when the address is street-level. A city/country-only address
// would geocode to a centroid and falsely flag (and "fix" to) a wrong point.
const hasStreetAddress = computed(() => {
    const a = props.address;
    return !!(a && typeof a === 'object' && str(a.streetName));
});

// One geocode per distinct (address, pin) — not per render.
watch(
    () => `${query.value}|${props.geo?.lat ?? ''},${props.geo?.lng ?? ''}`,
    () => {
        void runCheck();
    },
    {immediate: true}
);

async function runCheck(): Promise<void> {
    if (!hasStreetAddress.value || !props.geo) {
        state.value = 'hidden';
        return;
    }
    state.value = 'checking';
    const token = ++activeRequest;
    const {candidates} = await searchPlaces({
        query: query.value,
        precision: 'street',
        limit: 1
    });
    // A newer check started while this one was in flight — drop this result.
    if (token !== activeRequest) return;
    const hit = candidates[0];
    if (!hit) {
        state.value = 'nofix';
        return;
    }
    best.value = hit;
    const meters = geoDistanceMeters(props.geo, {lat: hit.lat, lng: hit.lng});
    distanceLabel.value = formatMeters(meters);
    state.value = meters <= MATCH_THRESHOLD_M ? 'match' : 'mismatch';
}

function formatMeters(m: number): string {
    return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

async function movePinToAddress(): Promise<void> {
    const hit = best.value;
    if (!hit) return;
    applying.value = true;
    try {
        await locations.updateLocation(props.locationId, {
            kindFields: {geo: {lat: hit.lat, lng: hit.lng}}
        });
    } finally {
        applying.value = false;
    }
}
</script>

<style scoped>
.agb {
    margin-top: var(--space-2);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--type-caption);
}
.agb__line {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
}
.agb--match {
    color: var(--color-status-on);
}
.agb--mismatch {
    color: var(--color-status-warn);
}
.agb--checking,
.agb--nofix {
    color: var(--color-text-tertiary);
}
.agb__fix {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-primary);
    font-size: var(--type-caption);
    cursor: pointer;
}
.agb__fix:hover {
    border-color: var(--color-primary);
    background: var(--color-primary-subtle);
}
.agb__fix:disabled {
    opacity: 0.6;
    cursor: default;
}
</style>
