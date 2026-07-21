<template>
    <div class="chip-field">
        <label v-if="label" :for="inputId" class="chip-field__label">
            {{ label }}
        </label>
        <div class="chip-field__box" :class="{'chip-field__box--full': atMax}">
            <span
                v-for="(chip, i) in modelValue"
                :key="i"
                class="chip-field__chip"
            >
                {{ chip }}
                <button
                    type="button"
                    class="chip-field__remove"
                    :aria-label="`Remove ${chip}`"
                    @click="remove(i)"
                >
                    <i class="fas fa-xmark" />
                </button>
            </span>
            <input
                v-if="!atMax"
                :id="inputId"
                v-model="draft"
                type="text"
                class="chip-field__input"
                :placeholder="placeholder"
                @keydown.enter.prevent="commit"
                @keydown.backspace="onBackspace"
                @blur="commit"
            />
        </div>
        <p v-if="atMax" class="chip-field__hint">
            Maximum {{ max }} entries reached.
        </p>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, useId} from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue: string[];
        label?: string;
        placeholder?: string;
        max?: number;
    }>(),
    {
        label: '',
        placeholder: '',
        max: 50
    }
);

const emit = defineEmits<{
    'update:modelValue': [value: string[]];
}>();

const draft = ref('');
const inputId = useId();
const atMax = computed(() => props.modelValue.length >= props.max);

function commit() {
    const value = draft.value.trim();
    if (!value) return;
    if (atMax.value) return;
    // De-dupe — silently drop duplicates so chips are a unique set.
    if (props.modelValue.includes(value)) {
        draft.value = '';
        return;
    }
    emit('update:modelValue', [...props.modelValue, value]);
    draft.value = '';
}

function remove(index: number) {
    emit(
        'update:modelValue',
        props.modelValue.filter((_, i) => i !== index)
    );
}

function onBackspace(e: KeyboardEvent) {
    // Empty draft + backspace → remove last chip (standard chip-input UX).
    if (draft.value === '' && props.modelValue.length > 0) {
        e.preventDefault();
        remove(props.modelValue.length - 1);
    }
}
</script>

<style scoped>
.chip-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.chip-field__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.chip-field__box {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    min-height: var(--touch-target-min);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    transition: border-color var(--duration-fast);
}

.chip-field__box:focus-within {
    border-color: var(--color-border-focus);
}

.chip-field__box--full {
    background: var(--color-surface-3);
}

.chip-field__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    color: var(--color-text-primary);
}

.chip-field__remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
}

.chip-field__remove:hover {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
}

.chip-field__input {
    flex: 1;
    min-width: 120px;
    padding: var(--space-1);
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-text-primary);
    font-size: var(--type-body);
}

.chip-field__hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
