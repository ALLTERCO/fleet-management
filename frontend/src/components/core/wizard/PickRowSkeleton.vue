<template>
    <ul class="stack-list" aria-busy="true" :aria-label="label">
        <li v-for="row in rows" :key="row" class="prs__row">
            <Skeleton variant="rect" rounded decorative class="prs__lead" />
            <span class="prs__body">
                <Skeleton variant="text" decorative :width="titleWidth(row)" />
                <Skeleton variant="text" decorative width="30%" />
            </span>
        </li>
    </ul>
</template>

<script setup lang="ts">
import Skeleton from '@/components/core/Skeleton.vue';

// A spinner says "wait". A skeleton says "a list of rows is coming, and this is
// how many", so the step does not jump when the answer lands.
withDefaults(defineProps<{rows?: number; label?: string}>(), {
    rows: 3,
    label: 'Loading'
});

// Uneven widths so the placeholder reads as content, not as a pattern.
const WIDTHS = ['62%', '48%', '55%', '40%'];

function titleWidth(row: number): string {
    return WIDTHS[(row - 1) % WIDTHS.length];
}
</script>

<style scoped>
/* Mirrors PickRow's shell, whose own styles are scoped and cannot reach here. */
.prs__row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    min-height: var(--touch-target-min);
    padding: var(--gap-sm) var(--gap-md);
    border: var(--space-px) solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    pointer-events: none;
}

.prs__lead {
    flex-shrink: 0;
    width: var(--pick-row-lead);
    height: var(--pick-row-lead);
}

.prs__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gap-2xs);
    min-width: 0;
}
</style>
