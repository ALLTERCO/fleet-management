<!-- Hex swatches in script are user-facing color choices, not design-system chrome. -->
<template>
    <div class="cpp">
        <div class="cpp__swatches">
            <button
                v-for="s in swatches"
                :key="s.value ?? '__none__'"
                type="button"
                class="cpp__swatch"
                :class="s.value === model && 'cpp__swatch--active'"
                :style="{background: s.value || 'transparent'}"
                :title="s.label"
                @click="emit('update:modelValue', s.value)"
            >
                <i v-if="!s.value" class="fas fa-ban" />
            </button>
        </div>
        <div class="cpp__custom">
            <input
                type="color"
                :value="hexFor(model)"
                @input="onHexInput"
            />
            <input
                v-model="hexInput"
                type="text"
                class="cpp__hex"
                placeholder="#RRGGBB"
                @change="onHexCommit"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue';

interface ColorSwatch {
    value: string | null;
    label: string;
}

const props = defineProps<{
    modelValue: string | null;
    swatches?: ColorSwatch[];
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string | null];
}>();

// Shelly brand palette + state semantics + "no color".
const DEFAULT_SWATCHES: ColorSwatch[] = [
    {value: null, label: 'No color'},
    {value: '#4495D1', label: 'Shelly Blue'},
    {value: '#003C82', label: 'Shelly Medium'},
    {value: '#122A4F', label: 'Shelly Dark'},
    {value: '#AAE1FA', label: 'Shelly Light'},
    {value: '#A0A0A0', label: 'Neutral'},
    {value: '#22c55e', label: 'Success'},
    {value: '#f59e0b', label: 'Warning'},
    {value: '#ef4444', label: 'Danger'}
];

const swatches = props.swatches ?? DEFAULT_SWATCHES;
const model = props.modelValue;
const hexInput = ref(props.modelValue ?? '');

watch(
    () => props.modelValue,
    (v) => {
        hexInput.value = v ?? '';
    }
);

function hexFor(v: string | null): string {
    return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#000000';
}

function onHexInput(e: Event): void {
    emit('update:modelValue', (e.target as HTMLInputElement).value);
}

function onHexCommit(): void {
    const v = hexInput.value.trim();
    if (!v) {
        emit('update:modelValue', null);
        return;
    }
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
        emit('update:modelValue', v);
    }
}
</script>

<style scoped>
.cpp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.cpp__swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
}
.cpp__swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--color-border-default);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    background: transparent;
}
.cpp__swatch--active {
    border-color: var(--color-primary);
    transform: scale(1.1);
}
.cpp__custom {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}
.cpp__custom input[type='color'] {
    width: 36px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
    background: transparent;
    cursor: pointer;
}
.cpp__hex {
    flex: 1;
    padding: var(--space-1) var(--space-2);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
    color: var(--color-text-primary);
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
}
</style>
