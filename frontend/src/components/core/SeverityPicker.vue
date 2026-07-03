<template>
    <div class="sp" role="radiogroup" aria-label="Severity">
        <button
            v-for="entry in entries"
            :key="entry.value"
            type="button"
            v-bind="ariaAttrs(entry.value)"
            class="sp__option"
            :class="[
                `sp__option--${entry.value}`,
                {'sp__option--active': entry.value === selected}
            ]"
            @click="pick(entry.value)"
        >
            <i :class="['sp__icon', entry.icon]" aria-hidden="true" />
            <span class="sp__label">{{ entry.label }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import type {AlertSeverity} from '@api/alert';
import {computed} from 'vue';

interface Entry {
    value: AlertSeverity;
    label: string;
    icon: string;
}

const ENTRIES: readonly Entry[] = [
    {value: 'critical', label: 'Critical', icon: 'fa-solid fa-circle-exclamation'},
    {value: 'warning', label: 'Warning', icon: 'fa-solid fa-triangle-exclamation'},
    {value: 'info', label: 'Info', icon: 'fa-solid fa-circle-info'}
];

const selected = defineModel<AlertSeverity>({required: true});

const entries = computed(() => ENTRIES);

function pick(value: AlertSeverity): void {
    selected.value = value;
}

function ariaAttrs(value: AlertSeverity): {
    role: string;
    'aria-checked': 'true' | 'false';
} {
    return {
        role: 'radio',
        'aria-checked': value === selected.value ? 'true' : 'false'
    };
}
</script>

<style scoped>
.sp {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    padding: var(--space-1);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
}

.sp__option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
        color var(--duration-fast) var(--ease-out-expo),
        background-color var(--duration-fast) var(--ease-out-expo),
        border-color var(--duration-fast) var(--ease-out-expo);
}

.sp__option:hover {
    color: var(--color-text-primary);
    background-color: var(--color-surface-3);
}

.sp__option--critical.sp__option--active {
    color: var(--color-alert-critical-fg);
    background-color: var(--color-alert-critical-bg);
    border-color: var(--color-alert-critical-border);
}

.sp__option--warning.sp__option--active {
    color: var(--color-alert-warning-fg);
    background-color: var(--color-alert-warning-bg);
    border-color: var(--color-alert-warning-border);
}

.sp__option--info.sp__option--active {
    color: var(--color-alert-info-fg);
    background-color: var(--color-alert-info-bg);
    border-color: var(--color-alert-info-border);
}

.sp__icon {
    font-size: var(--type-subheading);
}

.sp__label {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
}

.sp__option--active .sp__label {
    font-weight: var(--font-semibold);
}
</style>
