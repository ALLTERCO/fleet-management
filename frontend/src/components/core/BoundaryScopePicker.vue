<template>
    <div class="bsp">
        <div class="bsp__pickers">
            <FormField label="What kind of resource?">
                <Dropdown
                    :groups="kindGroups"
                    :default="activeKind"
                    @selected="onKindSelected"
                />
            </FormField>
            <FormField v-if="activeKind === 'devices'" label="Choose by">
                <Dropdown
                    :groups="deviceSelectorGroups"
                    :default="deviceSelector"
                    @selected="onDeviceSelectorSelected"
                />
            </FormField>
        </div>
        <ScopeDimensionField
            v-if="activeDimensionMeta"
            :dim="activeDimensionMeta"
            :options="activeOptions"
            :model-value="pickedValues"
            @update:model-value="setValues"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';
import ScopeDimensionField from '@/components/core/ScopeDimensionField.vue';
import {useScopeDimensionSources} from '@/composables/useScopeDimensionSources';
import {
    DEVICE_SELECTORS,
    type DeviceSelectorKey,
    SCOPE_DIMENSIONS,
    SCOPE_KINDS,
    type ScopeDimensionKey,
    type ScopeKindKey,
    type ScopeOption,
    type ScopeSelection,
    scopeKindsForPersona
} from '@/helpers/scopeDimensions';

const model = defineModel<ScopeSelection>({required: true});

const props = defineProps<{
    // System-role key; limits offered kinds to what the backend accepts
    // (shared persona↔scope-type matrix). Custom roles get every kind.
    personaKey?: string;
}>();

const sources = useScopeDimensionSources();
const kinds = computed(() => scopeKindsForPersona(props.personaKey));

// Re-open with an existing scope lands on its kind; default is devices.
function initialState(): {kind: ScopeKindKey; selector: DeviceSelectorKey} {
    for (const dim of SCOPE_DIMENSIONS) {
        if (!(model.value[dim.key] as unknown[] | undefined)?.length) continue;
        const deviceSel = DEVICE_SELECTORS.find((s) => s.key === dim.key);
        if (deviceSel) return {kind: 'devices', selector: deviceSel.key};
        const kind = SCOPE_KINDS.find((k) => k.dimension === dim.key);
        if (kind) return {kind: kind.key, selector: 'device_ids'};
    }
    return {kind: 'devices', selector: 'device_ids'};
}

const initial = initialState();
const activeKind = ref<ScopeKindKey>(initial.kind);
const deviceSelector = ref<DeviceSelectorKey>(initial.selector);

// If the role does not allow the active kind — at mount (stale scope from a
// previous role) or when the role changes — fall back and clear the picks.
watch(
    kinds,
    (next) => {
        if (next.some((k) => k.key === activeKind.value)) return;
        activeKind.value = next[0]?.key ?? 'devices';
        model.value = {};
    },
    {immediate: true}
);

const kindGroups = computed(() => [
    {
        label: '',
        items: kinds.value.map((k) => ({value: k.key, label: k.label}))
    }
]);

const deviceSelectorGroups = [
    {
        label: '',
        items: DEVICE_SELECTORS.map((s) => ({value: s.key, label: s.label}))
    }
];

const activeDimension = computed<ScopeDimensionKey>(() => {
    if (activeKind.value === 'devices') return deviceSelector.value;
    const kind = SCOPE_KINDS.find((k) => k.key === activeKind.value);
    return kind?.dimension ?? 'device_ids';
});

const activeDimensionMeta = computed(() =>
    SCOPE_DIMENSIONS.find((dim) => dim.key === activeDimension.value)
);

function onKindSelected(value: unknown): void {
    const kind = value as ScopeKindKey;
    if (kind === activeKind.value) return;
    activeKind.value = kind;
    model.value = {};
}

function onDeviceSelectorSelected(value: unknown): void {
    const selector = value as DeviceSelectorKey;
    if (selector === deviceSelector.value) return;
    deviceSelector.value = selector;
    model.value = {};
}

// Lazy-load each list the first time its picker is shown.
const fetchedDimensions = new Set<ScopeDimensionKey>();
watch(
    activeDimension,
    (dim) => {
        if (fetchedDimensions.has(dim)) return;
        fetchedDimensions.add(dim);
        sources[dim]?.fetch?.();
    },
    {immediate: true}
);

const activeOptions = computed<ScopeOption[]>(
    () => sources[activeDimension.value]?.options.value ?? []
);

const pickedValues = computed<Array<string | number>>(
    () =>
        (model.value[activeDimension.value] as
            | Array<string | number>
            | undefined) ?? []
);

// One grant scopes one dimension — writing replaces the whole selection.
function setValues(values: Array<string | number>): void {
    model.value = values.length
        ? ({[activeDimension.value]: values} as ScopeSelection)
        : {};
}
</script>

<style scoped>
.bsp {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.bsp__pickers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-3);
}
</style>
