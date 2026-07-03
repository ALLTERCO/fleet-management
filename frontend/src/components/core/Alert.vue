<template>
    <div class="alert" :class="`alert--${type}`" role="alert">
        <i v-if="iconClass" :class="iconClass" class="alert__icon" aria-hidden="true" />
        <div class="alert__body">
            <p v-if="title" class="alert__title">{{ title }}</p>
            <div v-if="$slots.default" class="alert__text"><slot /></div>
        </div>
        <div v-if="$slots.action" class="alert__action">
            <slot name="action" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        /** Severity. Drives color + default icon. */
        type?: 'info' | 'success' | 'warn' | 'danger';
        /** Optional title — bold, on the first line. */
        title?: string;
        /** Custom icon override; falls back to a sensible default per type. */
        icon?: string;
    }>(),
    {type: 'info'}
);

const DEFAULT_ICON: Record<string, string> = {
    info: 'fas fa-circle-info',
    success: 'fas fa-circle-check',
    warn: 'fas fa-triangle-exclamation',
    danger: 'fas fa-circle-exclamation'
};

const iconClass = computed(() => props.icon ?? DEFAULT_ICON[props.type]);
</script>

<style scoped>
.alert {
    display: flex;
    align-items: flex-start;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}
.alert__icon {
    font-size: var(--type-body);
    line-height: 1.5;
    flex-shrink: 0;
}
.alert__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.alert__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    margin: 0;
}
.alert__text {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    margin: 0;
}
.alert__action {
    flex-shrink: 0;
    align-self: center;
}

/* Type variants — left-edge accent + tinted bg + matching icon. */
.alert--info {
    border-left: 3px solid var(--color-info);
    background: color-mix(in srgb, var(--color-info) 8%, var(--color-surface-2));
}
.alert--info .alert__icon { color: var(--color-info-text); }

.alert--success {
    border-left: 3px solid var(--color-success);
    background: color-mix(in srgb, var(--color-success) 10%, var(--color-surface-2));
}
.alert--success .alert__icon { color: var(--color-success-text); }

.alert--warn {
    border-left: 3px solid var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 12%, var(--color-surface-2));
}
.alert--warn .alert__icon { color: var(--color-warning-text); }

.alert--danger {
    border-left: 3px solid var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 12%, var(--color-surface-2));
}
.alert--danger .alert__icon { color: var(--color-danger-text); }
</style>
