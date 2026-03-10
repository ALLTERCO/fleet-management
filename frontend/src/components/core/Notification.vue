<template>
    <div class="notification p-4 mb-4 rounded-lg shadow-md border-l flex flex-row" :class="`notification--${type}`" aria-live="polite" role="status">
        <span class="notification__icon mr-4 m-auto"> <i class="fas fa-circle-info"></i></span>
        <div class="flex-grow">
            <slot />
        </div>
    </div>
</template>

<script setup lang="ts">
import type {notification_type_t} from '@/types';

withDefaults(
    defineProps<{
        type?: notification_type_t;
    }>(),
    {type: 'info'}
);
</script>

<style scoped>
.notification {
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.notification--success {
    border-left-color: var(--color-success);
}
.notification--success .notification__icon {
    color: var(--color-success-text);
}
.notification--info {
    border-left-color: var(--color-primary);
}
.notification--info .notification__icon {
    color: var(--color-primary-text);
}
.notification--warning {
    border-left-color: var(--color-warning);
}
.notification--warning .notification__icon {
    color: var(--color-warning-text);
}
.notification--error {
    border-left-color: var(--color-danger);
}
.notification--error .notification__icon {
    color: var(--color-danger-text);
}
</style>
