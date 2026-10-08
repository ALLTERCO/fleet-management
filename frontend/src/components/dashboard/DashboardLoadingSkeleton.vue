<template>
    <section
        class="dashboard-loading-skeleton"
        :class="`dashboard-loading-skeleton--${variant}`"
        role="status"
        aria-live="polite"
        :aria-label="label"
    >
        <div class="dashboard-loading-skeleton__header" aria-hidden="true">
            <Skeleton decorative width="12rem" height="1.25rem" />
            <Skeleton decorative width="7rem" height="1.25rem" />
        </div>
        <div class="dashboard-loading-skeleton__kpis" aria-hidden="true">
            <Skeleton
                v-for="n in 4"
                :key="`kpi-${n}`"
                decorative
                variant="card"
            />
        </div>
        <div class="dashboard-loading-skeleton__grid" aria-hidden="true">
            <Skeleton
                v-for="n in cardCount"
                :key="`card-${n}`"
                decorative
                variant="card"
                :class="{
                    'dashboard-loading-skeleton__card--wide':
                        variant === 'energy' && n <= 2,
                    'dashboard-loading-skeleton__card--large':
                        variant === 'bento' && n === 1
                }"
            />
        </div>
    </section>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Skeleton from '@/components/core/Skeleton.vue';

const props = withDefaults(
    defineProps<{
        variant?: 'bento' | 'energy';
        label?: string;
    }>(),
    {
        variant: 'bento',
        label: 'Loading dashboard'
    }
);

const cardCount = computed(() => (props.variant === 'energy' ? 5 : 6));
</script>

<style scoped>
.dashboard-loading-skeleton {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-4);
    animation: dashboard-skeleton-enter 180ms ease-out both;
}

.dashboard-loading-skeleton__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}

.dashboard-loading-skeleton__kpis,
.dashboard-loading-skeleton__grid {
    display: grid;
    gap: var(--card-grid-gap);
}

.dashboard-loading-skeleton__kpis {
    grid-template-columns: repeat(4, minmax(0, 1fr));
}

.dashboard-loading-skeleton__kpis :deep(.skeleton--card) {
    height: 88px;
}

.dashboard-loading-skeleton__grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
}

.dashboard-loading-skeleton__grid :deep(.skeleton--card) {
    min-height: var(--grid-cell);
    height: 100%;
}

.dashboard-loading-skeleton__card--wide {
    grid-column: span 2;
}

.dashboard-loading-skeleton__card--large {
    grid-column: span 2;
    grid-row: span 2;
}

@keyframes dashboard-skeleton-enter {
    from {
        opacity: 0;
        transform: translateY(4px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@media (max-width: 900px) {
    .dashboard-loading-skeleton__kpis,
    .dashboard-loading-skeleton__grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 560px) {
    .dashboard-loading-skeleton {
        padding: var(--space-3);
    }

    .dashboard-loading-skeleton__kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .dashboard-loading-skeleton__grid {
        grid-template-columns: minmax(0, 1fr);
    }

    .dashboard-loading-skeleton__card--wide,
    .dashboard-loading-skeleton__card--large {
        grid-column: span 1;
        grid-row: span 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .dashboard-loading-skeleton {
        animation: none;
    }
}
</style>
