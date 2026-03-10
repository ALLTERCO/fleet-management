<template>
    <div class="chart-card">
        <!-- Header -->
        <div class="chart-card__header">
            <h3 class="chart-card__title">
                <i v-if="icon" :class="icon" class="chart-card__icon"></i>
                {{ title }}
            </h3>
            <div v-if="$slots.actions" class="chart-card__actions">
                <slot name="actions" />
            </div>
        </div>

        <!-- Chart area -->
        <div class="chart-card__canvas" :style="{height: height + 'px'}">
            <slot />

            <!-- Loading overlay -->
            <div v-if="loading" class="chart-card__overlay">
                <i class="fas fa-spinner fa-spin text-xl text-[var(--color-text-disabled)]"></i>
            </div>

            <!-- Empty state -->
            <div v-if="!loading && empty" class="chart-card__overlay">
                <span class="text-[var(--color-text-disabled)] text-sm">{{ emptyText }}</span>
            </div>
        </div>

        <!-- Stats footer -->
        <div v-if="$slots.stats" class="chart-card__stats">
            <slot name="stats" />
        </div>
    </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
    title: string;
    icon?: string;
    height?: number;
    loading?: boolean;
    empty?: boolean;
    emptyText?: string;
}>(), {
    height: 256,
    loading: false,
    empty: false,
    emptyText: 'No data available'
});
</script>

<style scoped>
.chart-card {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
}

.chart-card__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-4);
}

.chart-card__title {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.chart-card__icon {
    font-size: var(--text-base);
}

.chart-card__actions {
    display: flex;
    gap: var(--space-1);
}

.chart-card__canvas {
    position: relative;
}

.chart-card__overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--glass-bg) 70%, transparent);
}

.chart-card__stats {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
}

.chart-card__stats :deep(strong) {
    color: var(--color-text-primary);
}
</style>
