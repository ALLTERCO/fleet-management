<template>
    <div class="dash-nod" role="status">
        <span class="dash-nod__title">Not enough data yet</span>
        <span v-if="waitingFor" class="dash-nod__detail">{{ waitingFor }}</span>
    </div>
</template>

<script setup lang="ts">
// The one empty state for thin history. Without it a missing baseline renders
// exactly like a measured "no change", so a fresh install reads as a steady one.
defineProps<{
    /** What the card is still waiting for, e.g. "Needs 3 days of readings — 1 so far". */
    waitingFor?: string;
}>();
</script>

<style scoped>
.dash-nod {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.dash-nod__title {
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
</style>
