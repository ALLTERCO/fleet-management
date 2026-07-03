<template>
    <div v-if="buttons.length" class="blu-btn-picker">
        <Dropdown
            :groups="buttonGroups"
            :default="selectedButtonKey"
            label="Button"
            placeholder="Choose a button"
            @selected="onButtonSelected"
        />
        <Dropdown
            :groups="gestureGroups"
            :default="selectedGesture"
            label="Press type"
            @selected="onGestureSelected"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {
    BLU_BUTTON_GESTURES,
    buildButtonEventConfig,
    listBluButtons,
    parseButtonEventConfig
} from '@/helpers/bluButtonRule';
import type {entity} from '@/types/entities';
import Dropdown from './Dropdown.vue';

const props = defineProps<{
    entities: readonly entity[];
    modelValue: Record<string, unknown>;
}>();
const emit = defineEmits<{
    'update:modelValue': [config: Record<string, unknown>];
}>();

const buttons = computed(() => listBluButtons(props.entities));

// Dropdown values must be primitives, so a button is encoded "componentKey#idx".
function encode(componentKey: string, idx: number): string {
    return `${componentKey}#${idx}`;
}

const buttonGroups = computed(() => {
    const byDevice = new Map<string, {value: string; label: string}[]>();
    for (const b of buttons.value) {
        const items = byDevice.get(b.deviceLabel) ?? [];
        items.push({value: encode(b.componentKey, b.idx), label: b.label});
        byDevice.set(b.deviceLabel, items);
    }
    return [...byDevice].map(([label, items]) => ({label, items}));
});

const gestureGroups = computed(() => [
    {
        label: 'Press type',
        items: BLU_BUTTON_GESTURES.map((g) => ({value: g.value, label: g.label}))
    }
]);

const selectedButtonKey = ref<string | undefined>();
const selectedGesture = ref<string>(BLU_BUTTON_GESTURES[0].value);

// Seed the controls from an existing rule's config, and re-seed if it changes
// externally (e.g. loading a saved rule for edit).
watch(
    () => props.modelValue,
    (config) => {
        const parsed = parseButtonEventConfig(config);
        if (!parsed) return;
        selectedButtonKey.value = encode(parsed.componentKey, parsed.idx);
        selectedGesture.value = parsed.gesture;
    },
    {immediate: true}
);

function emitConfig(): void {
    const key = selectedButtonKey.value;
    if (!key) return;
    const hash = key.lastIndexOf('#');
    emit(
        'update:modelValue',
        buildButtonEventConfig({
            componentKey: key.slice(0, hash),
            idx: Number(key.slice(hash + 1)),
            gesture: selectedGesture.value
        })
    );
}

function onButtonSelected(value: string): void {
    selectedButtonKey.value = value;
    emitConfig();
}

function onGestureSelected(value: string): void {
    selectedGesture.value = value;
    emitConfig();
}
</script>

<style scoped>
.blu-btn-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
</style>
