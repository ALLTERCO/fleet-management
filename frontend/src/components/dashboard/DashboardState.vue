<template>
    <div
        class="dsx"
        :class="`dsx--${state}`"
        role="status"
        :aria-busy="state === 'loading'"
    >
        <i v-if="iconClass" :class="['dsx__icon', iconClass]" aria-hidden="true" />
        <h2 v-if="title" class="dsx__title">{{ title }}</h2>
        <p v-if="message" class="dsx__message">{{ message }}</p>
        <p v-if="state === 'error' && error" class="dsx__error-detail">{{ error }}</p>

        <div class="dsx__actions">
            <slot name="action">
                <button
                    v-if="state === 'error'"
                    class="btn-toolbar btn-toolbar--primary"
                    @click="$emit('retry')"
                >
                    <i class="fas fa-rotate" aria-hidden="true" />
                    {{ retryLabel ?? 'Retry' }}
                </button>
                <button
                    v-else-if="state === 'empty' && ctaLabel"
                    class="btn-toolbar btn-toolbar--primary"
                    @click="$emit('cta')"
                >
                    <i class="fas fa-plus" aria-hidden="true" />
                    {{ ctaLabel }}
                </button>
            </slot>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

export type DashboardStateKind = 'loading' | 'empty' | 'error';

const props = withDefaults(
    defineProps<{
        state: DashboardStateKind;
        title?: string;
        message?: string;
        icon?: string;
        retryLabel?: string;
        ctaLabel?: string;
        error?: string | null;
    }>(),
    {
        icon: undefined,
        title: undefined,
        message: undefined,
        retryLabel: undefined,
        ctaLabel: undefined,
        error: null
    }
);

defineEmits<{
    (e: 'retry'): void;
    (e: 'cta'): void;
}>();

const iconClass = computed(() => {
    if (props.icon) return props.icon;
    if (props.state === 'loading') return 'fas fa-spinner fa-spin';
    if (props.state === 'error') return 'fas fa-triangle-exclamation';
    return 'fas fa-table-cells-large';
});
</script>

<style scoped>
.dsx {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-12) var(--space-4);
    min-height: 320px;
    text-align: center;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-tertiary);
}

.dsx--loading {
    color: var(--color-text-secondary);
}

.dsx--error {
    border-color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 5%, var(--color-surface-1));
    color: var(--color-danger-text);
}

.dsx__icon {
    font-size: var(--icon-size-xl);
    color: var(--color-text-quaternary);
}

.dsx--error .dsx__icon {
    color: var(--color-danger-text);
}

.dsx__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}

.dsx--error .dsx__title {
    color: var(--color-danger-text);
}

.dsx__message {
    margin: 0;
    max-width: 52ch;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.dsx__error-detail {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-danger-subtle);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-danger-text);
    max-width: 60ch;
    overflow-wrap: anywhere;
}

.dsx__actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
}

</style>
