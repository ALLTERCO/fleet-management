<template>
    <div class="lfr">
        <label v-if="field.label" class="lfr__label">
            {{ field.label }}
            <span v-if="inherited" class="lfr__inherited"
                :title="`Inherited from parent: ${inheritedDisplay}`">
                <i class="fas fa-link" /> inherited
            </span>
        </label>
        <p v-if="field.description" class="lfr__desc">{{ field.description }}</p>

        <template v-if="field.widget === 'text'">
            <Input :model-value="(modelValue as string) ?? ''" :placeholder="field.placeholder"
                @update:model-value="emitUpdate($event === '' ? null : String($event))" />
        </template>

        <template v-else-if="field.widget === 'number'">
            <Input :model-value="numberAsString(modelValue)" type="number"
                :placeholder="field.placeholder ?? numberRangePlaceholder"
                @update:model-value="emitNumber($event)" />
            <span v-if="field.unit" class="lfr__unit">{{ field.unit }}</span>
        </template>

        <template v-else-if="field.widget === 'iso' || field.widget === 'combobox'">
            <div class="lfr__combo">
                <input :value="(modelValue as string) ?? ''"
                    :placeholder="field.placeholder ?? ''"
                    :list="`lfr-opts-${field.key}`"
                    :readonly="field.widget === 'iso' && !optionSet?.allowCustom"
                    class="lfr__combo-input"
                    @input="onComboInput" />
                <datalist :id="`lfr-opts-${field.key}`">
                    <option v-for="v in optionValues" :key="v" :value="v" />
                </datalist>
            </div>
        </template>

        <template v-else-if="field.widget === 'multiCombobox'">
            <div class="lfr__multi">
                <div class="lfr__chips">
                    <span v-for="(v, i) in selectedMulti" :key="v + i" class="lfr__chip">
                        {{ v }}
                        <button type="button" class="lfr__chip-x" @click="removeMulti(i)">
                            <i class="fas fa-xmark" />
                        </button>
                    </span>
                </div>
                <input v-model="multiDraft" class="lfr__combo-input"
                    :list="`lfr-opts-${field.key}`"
                    :placeholder="field.placeholder ?? 'Add…'"
                    @keydown.enter.prevent="commitMulti"
                    @change="commitMulti" />
                <datalist :id="`lfr-opts-${field.key}`">
                    <option v-for="v in optionValues" :key="v" :value="v" />
                </datalist>
            </div>
        </template>

        <LocationField_Address v-else-if="field.widget === 'address'"
            :model-value="modelValue as LocationAddressValue | null"
            @update:model-value="emitUpdate($event)" />

        <LocationField_Geo v-else-if="field.widget === 'geo'"
            :model-value="modelValue as LocationGeoValue | null"
            @update:model-value="emitUpdate($event)"
            @pick="emit('pick', $event)" />

        <LocationField_Contact v-else-if="field.widget === 'contact'"
            :model-value="modelValue as LocationContactValue | null"
            @update:model-value="emitUpdate($event)" />

        <LocationField_OperatingHours v-else-if="field.widget === 'operatingHours'"
            :model-value="modelValue as LocationOperatingHoursValue | null"
            @update:model-value="emitUpdate($event)" />

        <LocationField_EnvironmentalSetpoint v-else-if="field.widget === 'environmentalSetpoint'"
            :model-value="modelValue as LocationEnvSetpointValue | null"
            @update:model-value="emitUpdate($event)" />
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Input from '@/components/core/Input.vue';
import LocationField_Address from '@/components/core/LocationField_Address.vue';
import LocationField_Contact from '@/components/core/LocationField_Contact.vue';
import LocationField_EnvironmentalSetpoint from '@/components/core/LocationField_EnvironmentalSetpoint.vue';
import LocationField_Geo from '@/components/core/LocationField_Geo.vue';
import LocationField_OperatingHours from '@/components/core/LocationField_OperatingHours.vue';
import type {PlaceCandidate} from '@/helpers/placeSearch';
import type {
    LocationFieldDescriptor,
    LocationOptionSet
} from '@/stores/locations';
import type {LocationAddressValue} from './LocationField_Address.vue';
import type {LocationContactValue} from './LocationField_Contact.vue';
import type {LocationEnvSetpointValue} from './LocationField_EnvironmentalSetpoint.vue';
import type {LocationGeoValue} from './LocationField_Geo.vue';
import type {LocationOperatingHoursValue} from './LocationField_OperatingHours.vue';

const props = defineProps<{
    field: LocationFieldDescriptor;
    modelValue: unknown;
    optionSets: Record<string, LocationOptionSet>;
    inherited?: boolean;
    inheritedDisplay?: string;
}>();

const emit = defineEmits<{
    'update:modelValue': [unknown];
    pick: [PlaceCandidate];
}>();

const optionSet = computed<LocationOptionSet | null>(() =>
    props.field.optionSet
        ? (props.optionSets[props.field.optionSet] ?? null)
        : null
);
const optionValues = computed<string[]>(() => optionSet.value?.values ?? []);

const numberRangePlaceholder = computed(() => {
    const {min, max} = props.field;
    if (min != null && max != null) return `${min} to ${max}`;
    return undefined;
});

function numberAsString(v: unknown): string {
    return typeof v === 'number' ? String(v) : '';
}

function emitUpdate(v: unknown) {
    emit('update:modelValue', v);
}

function emitNumber(raw: string | number | boolean) {
    const s = String(raw ?? '').trim();
    if (!s) return emitUpdate(null);
    const n = Number(s);
    if (!Number.isFinite(n)) return;
    emitUpdate(n);
}

function onComboInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    // For strict iso without allowCustom, the datalist already constrains the input.
    emitUpdate(v === '' ? null : v);
}

// ── Multi-combobox state ──
const multiDraft = ref('');
const selectedMulti = computed<string[]>(() =>
    Array.isArray(props.modelValue) ? (props.modelValue as string[]) : []
);

watch(
    () => props.modelValue,
    () => {
        multiDraft.value = '';
    }
);

function commitMulti() {
    const raw = multiDraft.value.trim();
    if (!raw) return;
    if (selectedMulti.value.includes(raw)) {
        multiDraft.value = '';
        return;
    }
    // Respect strict option sets when allowCustom is false.
    if (
        optionSet.value &&
        !optionSet.value.allowCustom &&
        !optionSet.value.values.includes(raw)
    ) {
        return;
    }
    emitUpdate([...selectedMulti.value, raw]);
    multiDraft.value = '';
}
function removeMulti(i: number) {
    const next = [...selectedMulti.value];
    next.splice(i, 1);
    emitUpdate(next.length > 0 ? next : null);
}
</script>

<style scoped>
.lfr { display: flex; flex-direction: column; gap: var(--space-1); }
.lfr__label {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    display: inline-flex; align-items: center; gap: var(--space-2);
}
.lfr__inherited {
    font-size: var(--type-body);
    font-weight: 500;
    color: var(--color-text-tertiary);
    background: var(--color-surface-3);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
}
.lfr__desc {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.lfr__unit {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    margin-top: var(--space-1);
}
.lfr__combo, .lfr__multi { display: flex; flex-direction: column; gap: var(--space-2); }
.lfr__combo-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
.lfr__combo-input:focus {
    outline: none;
    border-color: var(--color-primary);
}
.lfr__chips {
    display: flex; flex-wrap: wrap; gap: var(--space-1);
}
.lfr__chip {
    display: inline-flex; align-items: center; gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    font-size: var(--type-body); font-weight: 500;
    color: var(--color-text-primary);
}
.lfr__chip-x {
    border: none; background: none; color: var(--color-text-tertiary);
    cursor: pointer; padding: 0; font-size: var(--type-body);
}
.lfr__chip-x:hover { color: var(--color-text-primary); }
</style>
