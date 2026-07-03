<template>
    <span class="pill" :class="[`pill--${variant}`, `pill--${size}`]" :title="title">
        <i v-if="icon" :class="icon" class="pill__icon" aria-hidden="true" />
        <slot />
    </span>
</template>

<script setup lang="ts">
withDefaults(
    defineProps<{
        /** Visual intent. Drives bg/border/fg colors. */
        variant?: 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'primary';
        /** Pill size — xs is the default and used in dense rows. */
        size?: 'xs' | 'sm';
        /** Optional FontAwesome icon class, e.g. 'fas fa-check'. */
        icon?: string;
        /** Native tooltip text. */
        title?: string;
    }>(),
    {variant: 'neutral', size: 'xs'}
);
</script>

<style scoped>
.pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    font-weight: var(--font-semibold);
    line-height: 1;
    white-space: nowrap;
}
.pill__icon {
    font-size: 0.85em;
}
.pill--xs {
    font-size: var(--type-caption);
    padding: var(--space-1) var(--space-2);
}
.pill--sm {
    font-size: var(--type-caption);
    padding: var(--space-1-5) var(--space-3);
}

.pill--info {
    background: var(--color-alert-info-bg);
    color: var(--color-text-primary);
    border-color: var(--color-alert-info-border);
}
.pill--success {
    background: var(--color-alert-success-bg, var(--color-success-subtle));
    color: var(--color-text-primary);
    border-color: var(--color-alert-success-border, var(--color-success));
}
.pill--warning {
    background: var(--color-alert-warning-bg);
    color: var(--color-text-primary);
    border-color: var(--color-alert-warning-border);
}
.pill--danger {
    background: var(--color-alert-critical-bg);
    color: var(--color-text-primary);
    border-color: var(--color-alert-critical-border);
}
.pill--primary {
    background: var(--color-primary-subtle);
    color: var(--color-primary);
    border-color: var(--color-primary);
}
.pill--neutral {
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
    border-color: transparent;
}
</style>
