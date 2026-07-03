<template>
    <label :for="id" class="core-cb" :class="{'core-cb--disabled': disabled}">
        <span class="core-cb__box-wrap">
            <input
                :id="id"
                v-model="selected"
                type="checkbox"
                class="core-cb__box"
                :disabled="disabled"
                @click="onClick"
            />
        </span>
        <span class="core-cb__body">
            <span class="core-cb__label">
                <slot>{{ label }}</slot>
                <span
                    v-if="required"
                    class="core-cb__required"
                    aria-hidden="true"
                >
                    *
                </span>
            </span>
            <span v-if="hint" class="core-cb__hint">{{ hint }}</span>
        </span>
    </label>
</template>

<script setup lang="ts">
import {ref, useId, watch} from 'vue';

// Fixes the historical "label prop silently ignored" bug — Checkbox now
// accepts label as a prop OR via the default slot (slot wins if both given).
const props = withDefaults(
    defineProps<{
        modelValue?: boolean;
        label?: string;
        hint?: string;
        required?: boolean;
        disabled?: boolean;
    }>(),
    {
        modelValue: false,
        label: '',
        hint: '',
        required: false,
        disabled: false
    }
);

const emit = defineEmits<{
    'update:modelValue': [value: boolean];
}>();

const id = useId();
const selected = ref(props.modelValue);

watch(
    () => props.modelValue,
    (value) => {
        selected.value = value;
    }
);

function onClick() {
    if (props.disabled) return;
    selected.value = !selected.value;
    emit('update:modelValue', selected.value);
}
</script>

<style scoped>
.core-cb {
    display: inline-flex;
    align-items: flex-start;
    gap: var(--space-2);
    cursor: pointer;
    user-select: none;
    min-height: var(--touch-target-min);
    padding: var(--space-1) 0;
}

.core-cb--disabled {
    cursor: not-allowed;
    opacity: var(--opacity-disabled);
}

.core-cb__box-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    flex-shrink: 0;
}

.core-cb__box {
    width: 1.125rem;
    height: 1.125rem;
    margin: 0;
    accent-color: var(--color-primary);
    background-color: var(--color-surface-3);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    cursor: inherit;
    transition: border-color var(--motion-hover);
}

.core-cb__box:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.core-cb__body {
    display: inline-flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding-top: var(--space-0-5);
    min-width: 0;
}

.core-cb__label {
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    line-height: 1.35;
}

.core-cb__required {
    color: var(--color-danger-text);
    margin-left: var(--space-0-5);
}

.core-cb__hint {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.4;
}
</style>
