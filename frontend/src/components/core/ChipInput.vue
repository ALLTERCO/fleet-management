<template>
    <div class="chip-input" :class="{'chip-input--focused': focused}">
        <span
            v-for="(chip, idx) in modelValue"
            :key="`${chip}-${idx}`"
            class="chip-input__chip"
        >
            {{ chip }}
            <button
                type="button"
                class="chip-input__chip-remove"
                :title="`Remove ${chip}`"
                @click="removeAt(idx)"
            >
                <i class="fas fa-times" />
            </button>
        </span>
        <input
            ref="inputEl"
            v-model="draft"
            class="chip-input__input"
            :placeholder="modelValue.length === 0 ? placeholder : ''"
            :list="datalistId"
            spellcheck="false"
            autocomplete="off"
            @keydown.enter.prevent="commit"
            @keydown.,.prevent="commit"
            @keydown.tab="onTab"
            @keydown.backspace="onBackspace"
            @blur="onBlur"
            @focus="focused = true"
        />
        <datalist v-if="suggestions?.length" :id="datalistId">
            <option
                v-for="opt in suggestions"
                :key="opt"
                :value="opt"
            />
        </datalist>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue: string[];
        suggestions?: readonly string[];
        placeholder?: string;
    }>(),
    {placeholder: '', suggestions: () => []}
);

const emit = defineEmits<{
    'update:modelValue': [string[]];
}>();

const draft = ref('');
const focused = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);

let nextId = 0;
const datalistId = computed(() => `chip-input-suggestions-${++nextId}`);

function commit(): void {
    const v = draft.value.trim();
    if (!v) return;
    if (props.modelValue.includes(v)) {
        draft.value = '';
        return;
    }
    emit('update:modelValue', [...props.modelValue, v]);
    draft.value = '';
}

function removeAt(idx: number): void {
    const next = [...props.modelValue];
    next.splice(idx, 1);
    emit('update:modelValue', next);
}

function onBackspace(): void {
    if (draft.value.length > 0) return;
    if (props.modelValue.length === 0) return;
    removeAt(props.modelValue.length - 1);
}

function onTab(): void {
    // Commit pending draft on tab so typed values aren't lost.
    if (draft.value.trim()) commit();
}

function onBlur(): void {
    focused.value = false;
    if (draft.value.trim()) commit();
}
</script>

<style scoped>
.chip-input {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target-min);
    padding: var(--input-padding) var(--space-3);
    border: 1px solid var(--input-border);
    border-radius: var(--input-radius);
    background-color: var(--input-bg);
    transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.chip-input:hover {
    border-color: var(--input-border-hover);
}
.chip-input--focused {
    border-color: var(--input-focus-ring);
    box-shadow: 0 0 0 var(--focus-ring-width) rgba(var(--color-primary-rgb), 0.25);
}
.chip-input__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-px) var(--space-2);
    border-radius: var(--radius-full);
    background-color: var(--color-primary-subtle);
    color: var(--color-primary-text);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
}
.chip-input__chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--color-primary-text);
    cursor: pointer;
    font-size: var(--type-caption);
    padding: 0;
    line-height: 1;
    transition: color var(--duration-fast);
}
.chip-input__chip-remove:hover {
    color: var(--color-danger-text);
}
.chip-input__input {
    flex: 1 1 var(--space-20);
    min-width: var(--space-20);
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-text-primary);
    font-size: var(--input-font-size);
}
.chip-input__input::placeholder {
    color: var(--input-placeholder);
}
</style>
