<template>
    <button
        type="button"
        class="core-switch"
        :class="{'core-switch--on': modelValue}"
        role="switch"
        :aria-checked="modelValue"
        :aria-label="label"
        @click="toggle"
    >
        <span class="core-switch__thumb" />
    </button>
</template>

<script setup lang="ts">
// Compact on/off switch — green when on. Single source for the rule card and
// the rule form so they always look identical.
const props = defineProps<{modelValue: boolean; label?: string}>();
const emit = defineEmits<{'update:modelValue': [boolean]}>();

function toggle(): void {
    emit('update:modelValue', !props.modelValue);
}
</script>

<style scoped>
.core-switch {
    position: relative;
    flex: none;
    width: var(--space-8);
    height: var(--space-5);
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: var(--color-border-medium);
    cursor: pointer;
    transition: background var(--duration-fast);
}
.core-switch--on {
    background: rgb(var(--color-success-rgb));
}
.core-switch__thumb {
    position: absolute;
    top: var(--space-0-5);
    left: var(--space-0-5);
    width: var(--space-4);
    height: var(--space-4);
    border-radius: 50%;
    background: var(--color-text-on-primary);
    transition: left var(--duration-fast);
}
.core-switch--on .core-switch__thumb {
    left: calc(100% - var(--space-4) - var(--space-0-5));
}
.core-switch:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: 2px;
}
</style>
