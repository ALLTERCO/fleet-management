<template>
    <section class="lf-section">
        <div class="lf-field">
            <label class="lf-label">Search the address</label>
            <PlaceSearchField
                :hide-country-picker="true"
                precision="street"
                placeholder="Search an address — e.g. 51 Cherni vrah, Sofia, Bulgaria"
                @pick="onAddressPicked"
            />
            <p class="lf-hint">
                Type the address and pick it — the pin and the fields below fill
                in. Edit any part if needed.
            </p>
        </div>

        <div v-if="hasResolvedAddress" class="lf-card">
            <div class="lf-card__head">
                <span class="lf-card__title">
                    <i class="fas fa-location-dot" aria-hidden="true" />
                    Address
                </span>
                <button
                    type="button"
                    class="lf-card__edit"
                    @click="editingAddress = !editingAddress"
                >
                    <i
                        class="fas"
                        :class="editingAddress ? 'fa-check' : 'fa-pen'"
                        aria-hidden="true"
                    />
                    {{ editingAddress ? 'Done' : 'Edit' }}
                </button>
            </div>
            <dl v-if="!editingAddress" class="lf-card__list">
                <div v-if="resolvedAddress.street" class="lf-card__row">
                    <dt>Street</dt><dd>{{ resolvedAddress.street }}</dd>
                </div>
                <div v-if="resolvedAddress.city" class="lf-card__row">
                    <dt>City</dt><dd>{{ resolvedAddress.city }}</dd>
                </div>
                <div v-if="resolvedAddress.region" class="lf-card__row">
                    <dt>Region</dt><dd>{{ resolvedAddress.region }}</dd>
                </div>
                <div v-if="resolvedAddress.postalCode" class="lf-card__row">
                    <dt>Postal code</dt><dd>{{ resolvedAddress.postalCode }}</dd>
                </div>
                <div v-if="resolvedAddress.countryCode" class="lf-card__row">
                    <dt>Country</dt><dd>{{ resolvedAddress.countryCode }}</dd>
                </div>
            </dl>
            <div v-else class="lf-card__form">
                <label class="lf-card__label">
                    <span>Street</span>
                    <Input
                        :model-value="addressPart('streetName')"
                        placeholder="Street"
                        @update:model-value="updateAddressPart('streetName', String($event))"
                    />
                </label>
                <label class="lf-card__label">
                    <span>Number</span>
                    <Input
                        :model-value="addressPart('streetNumber')"
                        placeholder="51"
                        @update:model-value="updateAddressPart('streetNumber', String($event))"
                    />
                </label>
                <label class="lf-card__label">
                    <span>City</span>
                    <Input
                        :model-value="addressPart('city')"
                        placeholder="City"
                        @update:model-value="updateAddressPart('city', String($event))"
                    />
                </label>
                <label class="lf-card__label">
                    <span>Region</span>
                    <Input
                        :model-value="addressPart('region')"
                        placeholder="Region"
                        @update:model-value="updateAddressPart('region', String($event))"
                    />
                </label>
                <label class="lf-card__label">
                    <span>Postal code</span>
                    <Input
                        :model-value="addressPart('postalCode')"
                        placeholder="Postal code"
                        @update:model-value="updateAddressPart('postalCode', String($event))"
                    />
                </label>
                <label class="lf-card__label">
                    <span>Country code</span>
                    <Input
                        :model-value="addressPart('countryCode')"
                        placeholder="ISO 2 letter"
                        @update:model-value="updateAddressPart('countryCode', String($event).toUpperCase())"
                    />
                </label>
            </div>
        </div>

        <div ref="mapHostRef" class="lf-map">
            <div v-if="!hasPin" class="lf-map__empty">
                <i class="fas fa-location-dot" aria-hidden="true" />
                <p>Search above or click the map to drop a pin.</p>
            </div>
        </div>

        <div v-if="hasPin" class="lf-map__meta">
            <div class="lf-map__coords">
                <span class="lf-map__coord">
                    <span class="lf-map__coord-label">Lat</span>
                    <span class="lf-map__coord-val">{{ formatCoord(geo.lat) }}</span>
                </span>
                <span class="lf-map__coord">
                    <span class="lf-map__coord-label">Lng</span>
                    <span class="lf-map__coord-val">{{ formatCoord(geo.lng) }}</span>
                </span>
                <span
                    class="lf-map__precision"
                    :class="`lf-map__precision--${precision}`"
                >
                    {{ precisionLabel }}
                </span>
            </div>
            <button
                type="button"
                class="lf-map__reset"
                title="Clear pin"
                @click="onClear"
            >
                <i class="fas fa-rotate-left" aria-hidden="true" />
                Reset
            </button>
        </div>

        <details class="lf-disclose">
            <summary class="lf-disclose__head">
                <i class="fas fa-sliders" aria-hidden="true" />
                Advanced — exact coordinates
            </summary>
            <div class="lf-disclose__body">
                <div class="lf-manual">
                    <label>
                        <span>Latitude</span>
                        <input
                            type="number"
                            step="any"
                            class="lf-manual__input"
                            :value="hasPin ? geo.lat : ''"
                            placeholder="-90 to 90"
                            @change="onManualCoord('lat', ($event.target as HTMLInputElement).value)"
                        />
                    </label>
                    <label>
                        <span>Longitude</span>
                        <input
                            type="number"
                            step="any"
                            class="lf-manual__input"
                            :value="hasPin ? geo.lng : ''"
                            placeholder="-180 to 180"
                            @change="onManualCoord('lng', ($event.target as HTMLInputElement).value)"
                        />
                    </label>
                </div>
                <p v-if="manualError" class="lf-error">{{ manualError }}</p>

                <div class="lf-field mt-3">
                    <label class="lf-label" for="lf-w3w">what3words</label>
                    <Input
                        id="lf-w3w"
                        :model-value="(kindFields.what3words as string) ?? ''"
                        placeholder="///filled.count.soap"
                        @update:model-value="onWhat3wordsInput($event)"
                    />
                    <p v-if="what3wordsError" class="lf-error">
                        {{ what3wordsError }}
                    </p>
                </div>
            </div>
        </details>
    </section>
</template>

<script setup lang="ts">
import maplibregl, {
    type Map as MapLibreMap,
    type Marker
} from 'maplibre-gl';
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    watch
} from 'vue';
import Input from '@/components/core/Input.vue';
import PlaceSearchField from '@/components/core/PlaceSearchField.vue';
import type {
    GeoPrecision,
    GeoState
} from '@/helpers/location-drawer-steps';
import {
    isPossibleWhat3Words,
    isValidLatitude,
    isValidLongitude
} from '@/helpers/location-drawer-steps';
import type {PlaceCandidate} from '@/helpers/placeSearch';
import {
    MAP_FLY_DURATION_MANUAL_MS,
    MAP_FLY_DURATION_MS,
    MAP_ZOOM_INITIAL,
    MAP_ZOOM_WORLD
} from '@/helpers/map-config';
import {getMapStyleUrl} from '@/helpers/map-style';
import {applyAppleMapsTint} from '@/helpers/map-tint';

const PRECISION_LABELS: Record<GeoPrecision, string> = {
    geocoded: 'Geocoded',
    confirmed: 'Confirmed',
    manual: 'Manual'
};

const props = defineProps<{
    isActive: boolean;
    kindFields: Record<string, unknown>;
}>();

const geo = defineModel<GeoState>('geo', {required: true});
const precision = defineModel<GeoPrecision>('precision', {required: true});
const hasPin = defineModel<boolean>('hasPin', {required: true});
const what3wordsError = defineModel<string>('what3wordsError', {
    required: true
});
const manualError = defineModel<string>('manualError', {required: true});

const emit = defineEmits<{
    'set-kind-field': [args: {key: string; value: unknown}];
}>();

const mapHostRef = ref<HTMLElement | null>(null);
const editingAddress = ref(false);
let mapInstance: MapLibreMap | null = null;
let marker: Marker | null = null;

const precisionLabel = computed(() => PRECISION_LABELS[precision.value]);

// The stored address sub-document — the single source for the breakdown.
const address = computed(
    () => (props.kindFields.address as Record<string, string>) ?? {}
);

const hasResolvedAddress = computed(() => {
    const a = address.value;
    return !!(
        a.streetName ||
        a.streetNumber ||
        a.city ||
        a.region ||
        a.postalCode ||
        a.countryCode
    );
});

const resolvedAddress = computed(() => {
    const a = address.value;
    return {
        street: [a.streetNumber, a.streetName].filter(Boolean).join(' '),
        city: a.city ?? '',
        region: a.region ?? '',
        postalCode: a.postalCode ?? '',
        countryCode: a.countryCode ?? ''
    };
});

function addressPart(key: string): string {
    return address.value[key] ?? '';
}

// Edit one component of the address sub-document — the single source of truth
// for the address. Per-kind schemas reject top-level city/region/country, so
// everything lives under `address`.
function updateAddressPart(key: string, value: string): void {
    const next = {...address.value};
    if (value) next[key] = value;
    else delete next[key];
    emit('set-kind-field', {
        key: 'address',
        value: Object.keys(next).length > 0 ? next : null
    });
}

function formatCoord(n: number): string {
    return n.toFixed(6);
}

function placeOrMoveMarker(lng: number, lat: number): void {
    if (!mapInstance) return;
    if (!marker) {
        const el = document.createElement('div');
        el.className = 'lf-marker';
        el.innerHTML =
            '<span class="lf-marker__pin"></span><span class="lf-marker__shadow"></span>';
        marker = new maplibregl.Marker({
            element: el,
            draggable: true,
            anchor: 'bottom'
        })
            .setLngLat([lng, lat])
            .addTo(mapInstance);
        marker.on('dragend', onMarkerDragEnd);
    } else {
        marker.setLngLat([lng, lat]);
    }
}

function onMarkerDragEnd(): void {
    if (!marker) return;
    const ll = marker.getLngLat();
    geo.value = {lat: ll.lat, lng: ll.lng};
    precision.value = 'confirmed';
}

function onMapClick(e: maplibregl.MapMouseEvent): void {
    geo.value = {lat: e.lngLat.lat, lng: e.lngLat.lng};
    precision.value = 'manual';
    hasPin.value = true;
    placeOrMoveMarker(e.lngLat.lng, e.lngLat.lat);
}

function ensureMap(): void {
    if (mapInstance || !mapHostRef.value) return;
    mapInstance = new maplibregl.Map({
        container: mapHostRef.value,
        style: getMapStyleUrl(),
        center: hasPin.value ? [geo.value.lng, geo.value.lat] : [0, 20],
        zoom: hasPin.value ? MAP_ZOOM_INITIAL : MAP_ZOOM_WORLD,
        attributionControl: {compact: true}
    });
    mapInstance.on('load', () => {
        if (!mapInstance) return;
        applyAppleMapsTint(mapInstance, {suppressMinorLabels: true});
        if (hasPin.value) {
            placeOrMoveMarker(geo.value.lng, geo.value.lat);
        }
    });
    mapInstance.on('click', onMapClick);
}

function focusMapOn(target: {
    lng: number;
    lat: number;
    durationMs: number;
}): void {
    if (!mapInstance) return;
    mapInstance.flyTo({
        center: [target.lng, target.lat],
        zoom: MAP_ZOOM_INITIAL,
        duration: target.durationMs,
        essential: false
    });
    placeOrMoveMarker(target.lng, target.lat);
}

// One search bar: a picked result fills the address breakdown AND drops the
// pin on the exact spot — no manual dragging. Everything goes into the nested
// `address` sub-document (the single source of truth the schema accepts).
function onAddressPicked(c: PlaceCandidate): void {
    geo.value = {lat: c.lat, lng: c.lng};
    precision.value = 'geocoded';
    hasPin.value = true;

    const next: Record<string, string> = {};
    if (c.streetName) next.streetName = c.streetName;
    if (c.houseNumber) next.streetNumber = c.houseNumber;
    if (c.city) next.city = c.city;
    if (c.adminName) next.region = c.adminName;
    if (c.postalCode) next.postalCode = c.postalCode;
    if (c.countryCode) next.countryCode = c.countryCode;
    emit('set-kind-field', {
        key: 'address',
        value: Object.keys(next).length > 0 ? next : null
    });
    // Timezone is not set here: the `building` kind schema forbids a top-level
    // timezone, and timezone is resolved by inheritance from the parent chain.

    focusMapOn({lng: c.lng, lat: c.lat, durationMs: MAP_FLY_DURATION_MS});
}

function onClear(): void {
    hasPin.value = false;
    precision.value = 'geocoded';
    if (marker) {
        marker.remove();
        marker = null;
    }
}

function onWhat3wordsInput(raw: string | number | boolean): void {
    const value = String(raw).trim().toLowerCase();
    emit('set-kind-field', {key: 'what3words', value: value || null});
    what3wordsError.value = isPossibleWhat3Words(value)
        ? ''
        : 'Format is three lowercase words separated by dots (e.g. filled.count.soap).';
}

function onManualCoord(key: 'lat' | 'lng', raw: string): void {
    const parsed = Number(raw);
    const message = manualCoordErrorMessage(key, parsed);
    manualError.value = message;
    if (message) return;
    const next: GeoState = {...geo.value, [key]: parsed};
    geo.value = next;
    precision.value = 'manual';
    hasPin.value = true;
    focusMapOn({
        lng: next.lng,
        lat: next.lat,
        durationMs: MAP_FLY_DURATION_MANUAL_MS
    });
}

function manualCoordErrorMessage(key: 'lat' | 'lng', value: number): string {
    if (!Number.isFinite(value)) {
        return 'Latitude / Longitude must be numbers.';
    }
    if (key === 'lat' && !isValidLatitude(value)) {
        return 'Latitude must be between -90 and 90.';
    }
    if (key === 'lng' && !isValidLongitude(value)) {
        return 'Longitude must be between -180 and 180.';
    }
    return '';
}

watch(
    () => props.isActive,
    async (active) => {
        if (!active) return;
        await nextTick();
        ensureMap();
        await nextTick();
        mapInstance?.resize();
    }
);

onMounted(() => {
    if (props.isActive) {
        void nextTick().then(() => {
            ensureMap();
            void nextTick().then(() => mapInstance?.resize());
        });
    }
});

onBeforeUnmount(() => {
    if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
    }
    marker = null;
});
</script>
