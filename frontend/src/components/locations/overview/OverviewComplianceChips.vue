<template>
    <ul v-if="tags.length > 0" class="ov-chips">
        <li v-for="t in tags" :key="t" class="ov-chip">
            <i class="fas fa-shield-halved" aria-hidden="true" />
            {{ t }}
        </li>
    </ul>
    <p v-else class="ov-chips__empty">No compliance tags.</p>
</template>

<script setup lang="ts">
defineProps<{tags: readonly string[]}>();
</script>

<style scoped>
.ov-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.ov-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
}

.ov-chip i {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-2xs);
}

.ov-chips__empty {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
