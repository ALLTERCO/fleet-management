<template>
    <div class="mon-notice" :class="`is-${tone}`">
        <i v-if="icon" :class="icon" class="mon-notice__icon" aria-hidden="true" />
        <Spinner v-if="loading" size="xs" />
        <div class="mon-notice__copy">
            <p class="mon-notice__title">{{ title }}</p>
            <p v-if="description" class="mon-notice__desc">{{ description }}</p>
        </div>
        <button
            v-if="actionLabel"
            type="button"
            class="mon-notice__action"
            @click="emit('action')"
        >
            {{ actionLabel }}
        </button>
    </div>
</template>

<script setup lang="ts">
import Spinner from '@/components/core/Spinner.vue';

withDefaults(
    defineProps<{
        title: string;
        description?: string;
        actionLabel?: string;
        icon?: string;
        loading?: boolean;
        tone?: 'neutral' | 'warning' | 'danger';
    }>(),
    {
        description: undefined,
        actionLabel: undefined,
        icon: undefined,
        loading: false,
        tone: 'neutral'
    }
);

const emit = defineEmits<{action: []}>();
</script>

<style scoped>
/* Inline console notice — a full-width callout, not a centered dedicated box. */
.mon-notice {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    border: 1px solid var(--color-border-subtle);
    border-left: 3px solid var(--color-border-medium, var(--color-border-default));
    border-radius: var(--radius-md, 8px);
    background: var(--color-surface-2);
}
.mon-notice__icon {
    flex: 0 0 auto;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.mon-notice__copy {
    min-width: 0;
    display: grid;
    gap: 2px;
}
.mon-notice__title,
.mon-notice__desc {
    margin: 0;
}
.mon-notice__title {
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
}
.mon-notice__desc {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.mon-notice__action {
    flex: 0 0 auto;
    margin-left: auto;
    min-height: 30px;
    padding: 0 var(--gap-md);
    border: 1px solid color-mix(in srgb, var(--color-primary) 55%, transparent);
    border-radius: var(--radius-sm, 6px);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary-text);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition:
        background var(--duration-normal, 0.15s) ease,
        border-color var(--duration-normal, 0.15s) ease;
}
.mon-notice__action:hover {
    background: color-mix(in srgb, var(--color-primary) 20%, transparent);
    border-color: color-mix(in srgb, var(--color-primary) 70%, transparent);
}
.mon-notice__action:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: 1px;
}
.mon-notice.is-warning {
    border-left-color: var(--color-warning-text, var(--color-orange-text));
}
.mon-notice.is-danger {
    border-left-color: var(--color-danger-text);
}
@media (max-width: 640px) {
    .mon-notice {
        flex-wrap: wrap;
    }
    .mon-notice__action {
        margin-left: 0;
    }
}
</style>
