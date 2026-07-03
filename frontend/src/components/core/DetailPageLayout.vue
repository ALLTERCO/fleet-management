<template>
    <div class="dpl">
        <header class="dpl__hdr">
            <slot name="header-left">
                <RouterLink v-if="backTo" :to="backTo" class="dpl__back">
                    <i class="fas fa-arrow-left" /> {{ backLabel }}
                </RouterLink>
            </slot>
            <slot name="header-actions" />
        </header>

        <div v-if="loading" class="dpl__loading">
            <Spinner />
        </div>

        <template v-else-if="!missing">
            <section v-if="$slots.summary" class="dpl__summary">
                <slot name="summary" />
            </section>

            <slot />
        </template>

        <EmptyBlock v-else>
            <slot name="missing">
                <p class="dpl__missing-title">Not found</p>
                <p class="dpl__missing-sub">{{ missingSub }}</p>
            </slot>
        </EmptyBlock>
    </div>
</template>

<script setup lang="ts">
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Spinner from '@/components/core/Spinner.vue';

withDefaults(
    defineProps<{
        backTo?: string;
        backLabel?: string;
        loading?: boolean;
        missing?: boolean;
        missingSub?: string;
    }>(),
    {
        backLabel: 'Back',
        missingSub: 'This item may have been deleted or is not accessible.'
    }
);
</script>

<style scoped>
.dpl {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--gap-sm);
    min-height: 0;
}
.dpl__hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.dpl__back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    text-decoration: none;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    transition:
        background var(--duration-fast),
        color var(--duration-fast);
}
.dpl__back:hover {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
}
.dpl__loading {
    display: flex;
    justify-content: center;
    padding: var(--space-6) 0;
}
/* Glass tier-1 — matches BasicBlock --glass + GlassShell tier-1 (SSOT). */
.dpl__summary {
    padding: var(--space-4);
    background: var(--glass-1-bg);
    backdrop-filter: var(--glass-1-filter);
    -webkit-backdrop-filter: var(--glass-1-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.dpl__missing-title {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.dpl__missing-sub {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    max-width: var(--prose-max-width);
}
</style>
