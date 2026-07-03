<template>
    <button
        type="button"
        class="scrubber-toggle"
        :class="{'scrubber-toggle--active': active}"
        :title="title ?? defaultTitle"
        :aria-pressed="active"
        @click="emit('toggle')"
    >
        <i class="fas fa-play scrubber-toggle__icon" aria-hidden="true" />
        {{ label }}
    </button>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    active: boolean;
    label: string;
    title?: string;
}>();
const emit = defineEmits<{toggle: []}>();

const defaultTitle = computed(() =>
    props.active ? `Hide ${props.label}` : `Show ${props.label}`
);
</script>

<style scoped>
.scrubber-toggle {
    height: 44px;
    padding: 0 var(--space-4);
    border-radius: 22px;
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    border: 1px solid var(--glass-border);
    color: var(--color-text-secondary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    transition: all var(--duration-normal) var(--ease-out-expo);
    box-shadow: var(--shadow-lg);
}
.scrubber-toggle:hover {
    background: var(--glass-3-bg);
    color: var(--color-text-primary);
    transform: translateY(-1px);
}
.scrubber-toggle--active {
    color: var(--color-primary);
    background: rgba(var(--color-primary-rgb), 0.18);
    border-color: rgba(var(--color-primary-rgb), 0.3);
}
.scrubber-toggle__icon { flex-shrink: 0; font-size: var(--type-caption); }
</style>
