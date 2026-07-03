<template>
    <div
        class="search-box"
        :class="{'search-box--open': open}"
        @click="expand"
    >
        <i class="fas fa-search search-box__icon" aria-hidden="true" />
        <input
            ref="inputEl"
            class="search-box__input"
            type="search"
            :value="modelValue"
            :placeholder="placeholder"
            :tabindex="open ? 0 : -1"
            autocomplete="off"
            spellcheck="false"
            @input="emitInput"
            @blur="collapseIfEmpty"
            @keydown.escape="collapse"
        />
    </div>
</template>

<script setup lang="ts">
import {nextTick, ref} from 'vue';

const props = defineProps<{
    modelValue: string;
    placeholder?: string;
}>();
const emit = defineEmits<{'update:modelValue': [value: string]}>();

const inputEl = ref<HTMLInputElement | null>(null);
const open = ref(false);

function expand(): void {
    if (open.value) return;
    open.value = true;
    void nextTick(() => inputEl.value?.focus());
}

function collapse(): void {
    emit('update:modelValue', '');
    open.value = false;
    inputEl.value?.blur();
}

function collapseIfEmpty(): void {
    if (props.modelValue.length === 0) open.value = false;
}

function emitInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    emit('update:modelValue', target.value);
}
</script>

<style scoped>
.search-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 44px;
    height: 44px;
    border-radius: 22px;
    padding: 0;
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    border: 1px solid var(--glass-border);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
    overflow: hidden;
    transition:
        width var(--duration-moderate) var(--ease-out-expo),
        padding var(--duration-moderate) var(--ease-out-expo),
        justify-content var(--duration-moderate) var(--ease-out-expo),
        background var(--duration-normal) var(--ease-out-expo);
}
.search-box:hover { color: var(--color-text-primary); }
.search-box--open {
    width: 260px;
    padding: 0 var(--space-4);
    justify-content: flex-start;
    cursor: text;
}
.search-box__icon {
    font-size: var(--type-caption);
    flex-shrink: 0;
}
.search-box__input {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--type-caption);
    width: 0;
    opacity: 0;
    transition:
        width var(--duration-moderate) var(--ease-out-expo),
        opacity var(--duration-normal) var(--ease-out-expo) 0.15s;
    padding: 0;
}
.search-box__input::placeholder { color: var(--color-text-quaternary); }
.search-box--open .search-box__input {
    width: 196px;
    opacity: 1;
}
</style>
