<template>
    <div class="chart-card" :style="accentStyle">
        <!-- Header -->
        <div class="chart-card__header">
            <h3 class="chart-card__title">
                <i v-if="icon" :class="icon" class="chart-card__icon"></i>
                {{ title }}
            </h3>
            <div class="chart-card__header-right">
                <slot name="summary" />
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
import {computed} from 'vue';

const props = withDefaults(defineProps<{
    title: string;
    icon?: string;
    color?: string;
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

const accentStyle = computed(() => {
    if (!props.color) return {};
    return {'--_accent': props.color};
});
</script>

<style scoped>
.chart-card {
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-left: 3px solid var(--_accent, var(--color-border-default));
    border-radius: var(--radius-lg);
    padding: var(--space-4);
}

.chart-card__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-3);
}

.chart-card__title {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.chart-card__icon {
    font-size: var(--text-sm);
}

.chart-card__header-right {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
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
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
}

.chart-card__stats {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
}

.chart-card__stats :deep(strong) {
    color: var(--color-text-primary);
}
</style>
