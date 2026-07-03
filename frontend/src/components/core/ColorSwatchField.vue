<template>
    <label class="csf">
        <span class="csf__label">{{ label }}</span>
        <span class="csf__row">
            <span
                class="csf__swatch"
                :style="{background: resolvedValue}"
                :aria-hidden="true"
            />
            <input
                ref="inputRef"
                type="color"
                class="csf__native"
                :value="resolvedValue"
                :disabled="disabled"
                @input="onInput"
            />
            <span class="csf__value">{{ resolvedValue.toUpperCase() }}</span>
        </span>
    </label>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue?: string;
        label: string;
        disabled?: boolean;
        fallback?: string;
    }>(),
    {modelValue: '', disabled: false, fallback: '#000000'}
);

const emit = defineEmits<{'update:modelValue': [value: string]}>();

const inputRef = ref<HTMLInputElement | null>(null);

const resolvedValue = computed(() => normalizeHex(props.modelValue) || props.fallback);

function normalizeHex(value: string | undefined): string {
    if (!value) return '';
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
        const r = trimmed[1];
        const g = trimmed[2];
        const b = trimmed[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return '';
}

function onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    emit('update:modelValue', target.value);
}
</script>

<style scoped>
.csf {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.csf__label {
    font-weight: var(--font-semibold);
}
.csf__row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    min-height: var(--touch-target-min);
    cursor: pointer;
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast);
}
.csf__row:hover {
    background: var(--color-surface-3);
    border-color: var(--color-border-focus);
}
.csf__row:focus-within {
    outline: none;
    border-color: var(--color-border-focus);
    box-shadow: var(--shadow-brand-ring);
}
.csf__swatch {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
}
.csf__native {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
}
.csf__native:disabled {
    cursor: not-allowed;
}
.csf__value {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    letter-spacing: 0;
    text-transform: none;
}
</style>
