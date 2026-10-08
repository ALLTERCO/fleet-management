<template>
    <div
        class="wz-state"
        :class="[`wz-state--${tone}`, isBanner ? 'wz-state--banner' : 'wz-state--placeholder']"
        :role="tone === 'error' ? 'alert' : 'status'"
    >
        <Spinner v-if="tone === 'loading'" size="md" />
        <i v-else class="wz-state__icon" :class="icon ?? TONE_ICON[tone]" aria-hidden="true" />

        <span class="wz-state__body">
            <span v-if="title" class="wz-state__title">{{ title }}</span>
            <span class="wz-state__text"><slot /></span>
        </span>

        <slot name="action" />
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Spinner from '@/components/core/Spinner.vue';

export type WizardStateTone = 'loading' | 'empty' | 'error' | 'info' | 'success';

const TONE_ICON: Record<WizardStateTone, string> = {
    loading: '',
    empty: 'fas fa-circle-info',
    error: 'fas fa-triangle-exclamation',
    info: 'fas fa-circle-info',
    success: 'fas fa-circle-check'
};

const props = defineProps<{
    tone: WizardStateTone;
    title?: string;
    icon?: string;
}>();

// Nothing-to-show fills the step; something-happened announces itself in a line.
const isBanner = computed(
    () => props.tone === 'error' || props.tone === 'info' || props.tone === 'success'
);
</script>

<style scoped>
.wz-state {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.wz-state__body {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    min-width: 0;
}

.wz-state__title {
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}

/* Nothing to show yet — owns the step so it never collapses to a thin line. */
.wz-state--placeholder {
    display: grid;
    place-items: center;
    gap: var(--gap-sm);
    min-height: var(--wizard-state-min-height);
    padding: var(--gap-lg);
    text-align: center;
}

.wz-state--placeholder .wz-state__icon {
    font-size: var(--icon-size-xl);
    color: var(--color-text-tertiary);
}

.wz-state--empty .wz-state__icon {
    color: var(--color-primary-text);
}

/* Something happened — one line, tinted by what it was. */
.wz-state--banner {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-md);
    border: var(--space-px) solid transparent;
    border-radius: var(--radius-md);
}

.wz-state--banner .wz-state__icon {
    flex-shrink: 0;
    font-size: var(--icon-size-sm);
}

.wz-state--banner .wz-state__body {
    flex: 1;
}

/* The tint is 8% of the tone over the base surface, not the -800 primitive.
   Bright text on the solid primitive measured 2.21:1; this measures 4.62:1. */
.wz-state--error {
    color: var(--color-danger-text);
    background: color-mix(in srgb, var(--color-danger-text) 8%, var(--color-surface-1));
    border-color: color-mix(in srgb, var(--color-danger-text) 35%, transparent);
}

.wz-state--info {
    color: var(--color-info-text);
    background: color-mix(in srgb, var(--color-info-text) 8%, var(--color-surface-1));
    border-color: color-mix(in srgb, var(--color-info-text) 30%, transparent);
}

.wz-state--success {
    color: var(--color-success-text);
    background: color-mix(in srgb, var(--color-success-text) 8%, var(--color-surface-1));
    border-color: color-mix(in srgb, var(--color-success-text) 30%, transparent);
}

/* The tint carries the meaning; the message itself stays readable. */
.wz-state--banner .wz-state__title,
.wz-state--banner .wz-state__text {
    color: inherit;
}
</style>
