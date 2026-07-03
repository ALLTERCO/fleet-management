<template>
    <div class="mf">
        <div v-if="$slots.meta" class="mf__meta">
            <slot name="meta" />
        </div>
        <div class="mf__actions">
            <slot name="secondary" />
            <slot name="primary" />
        </div>
    </div>
</template>

<script setup lang="ts">
// Unified modal footer. Meta block aligns left (timestamps, validation hints);
// secondary + primary actions align right in that order. Order matters —
// primary is the destination, secondary is the escape.
</script>

<style scoped>
.mf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
}

.mf__meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    min-width: 0;
}

.mf__actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
}
</style>
