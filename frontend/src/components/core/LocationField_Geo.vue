<template>
    <div class="lfg">
        <div class="lfg__search">
            <label class="lfg__label">Search place</label>
            <PlaceSearchField
                placeholder="Type a city, region, or country…"
                @pick="onPick"
            />
        </div>
        <div class="lfg__row">
            <label class="lfg__label">Latitude</label>
            <Input
                :model-value="value.lat != null ? String(value.lat) : ''"
                type="number"
                placeholder="-90 to 90"
                @update:model-value="update('lat', $event)"
            />
        </div>
        <div class="lfg__row">
            <label class="lfg__label">Longitude</label>
            <Input
                :model-value="value.lng != null ? String(value.lng) : ''"
                type="number"
                placeholder="-180 to 180"
                @update:model-value="update('lng', $event)"
            />
        </div>
        <p v-if="error" class="lfg__error">{{ error }}</p>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Input from '@/components/core/Input.vue';
import PlaceSearchField from '@/components/core/PlaceSearchField.vue';
import type {PlaceCandidate} from '@/helpers/placeSearch';

export interface LocationGeoValue {
    lat: number;
    lng: number;
}

const props = defineProps<{modelValue: LocationGeoValue | null | undefined}>();
const emit = defineEmits<{
    'update:modelValue': [LocationGeoValue | null];
    pick: [PlaceCandidate];
}>();

const draft = ref<{lat: string; lng: string}>({
    lat: props.modelValue?.lat != null ? String(props.modelValue.lat) : '',
    lng: props.modelValue?.lng != null ? String(props.modelValue.lng) : ''
});
const error = ref('');
const value = computed(
    () => props.modelValue ?? {lat: undefined, lng: undefined}
);

watch(
    () => props.modelValue,
    (v) => {
        draft.value = {
            lat: v?.lat != null ? String(v.lat) : '',
            lng: v?.lng != null ? String(v.lng) : ''
        };
    }
);

function update(key: 'lat' | 'lng', raw: string | number | boolean): void {
    draft.value = {...draft.value, [key]: String(raw ?? '')};
    const {lat, lng} = draft.value;
    if (!lat && !lng) {
        error.value = '';
        emit('update:modelValue', null);
        return;
    }
    const parsed = parseLatLng(lat, lng);
    if ('error' in parsed) {
        error.value = parsed.error;
        return;
    }
    error.value = '';
    emit('update:modelValue', {lat: parsed.lat, lng: parsed.lng});
}

type ParsedLatLng = {lat: number; lng: number} | {error: string};

function parseLatLng(lat: string, lng: string): ParsedLatLng {
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!Number.isFinite(latN) || latN < -90 || latN > 90) {
        return {error: 'Latitude must be between -90 and 90'};
    }
    if (!Number.isFinite(lngN) || lngN < -180 || lngN > 180) {
        return {error: 'Longitude must be between -180 and 180'};
    }
    return {lat: latN, lng: lngN};
}

function onPick(candidate: PlaceCandidate): void {
    draft.value = {lat: String(candidate.lat), lng: String(candidate.lng)};
    error.value = '';
    emit('update:modelValue', {lat: candidate.lat, lng: candidate.lng});
    emit('pick', candidate);
}
</script>

<style scoped>
.lfg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
}
.lfg__search {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.lfg__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.lfg__label {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
}
.lfg__error {
    grid-column: 1 / -1;
    font-size: var(--type-body);
    color: var(--color-status-red);
}
@media (max-width: 640px) {
    .lfg {
        grid-template-columns: 1fr;
    }
}
</style>
