<template>
    <dl v-if="stats.length > 0" class="ov-stat-grid">
        <div v-for="s in stats" :key="s.label" class="ov-stat">
            <dt class="ov-stat__label">{{ s.label }}</dt>
            <dd class="ov-stat__value" :title="s.value">{{ s.value }}</dd>
        </div>
    </dl>
    <p v-else class="ov-stat-grid__empty">{{ emptyHint ?? 'No data on file.' }}</p>
</template>

<script setup lang="ts">
export interface OverviewStat {
    readonly label: string;
    readonly value: string;
}

defineProps<{
    stats: readonly OverviewStat[];
    emptyHint?: string;
}>();
</script>

<style scoped>
.ov-stat-grid {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-3);
}

.ov-stat {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.ov-stat__label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
}

.ov-stat__value {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
}

.ov-stat-grid__empty {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
