<template>
    <div
        v-if="loading && insights.length === 0"
        class="dash-insights dash-insights--skeleton"
        aria-hidden="true"
    >
        <span
            v-for="i in skeletonCount"
            :key="i"
            class="dash-insight dash-insight--skeleton"
        />
    </div>
    <div v-else-if="insights.length" class="dash-insights">
        <div
            v-for="ins in insights"
            :key="ins.key"
            class="dash-insight"
            :class="'insight-' + ins.color"
        >
            <span class="dash-insight-dot" />
            <span class="dash-insight-text">{{ ins.text }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {DashInsight} from '@/types/dashboard-components';

withDefaults(
    defineProps<{
        insights: DashInsight[];
        loading?: boolean;
        skeletonCount?: number;
    }>(),
    {loading: false, skeletonCount: 3}
);
</script>

<style scoped>
.dash-insights {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.dash-insight {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    line-height: 1.3;
}
.dash-insight-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}
.dash-insight-text {
    color: var(--color-text-secondary);
}

/* Color variants */
.insight-blue { background: rgba(var(--color-primary-rgb), 0.06); }
.insight-blue .dash-insight-dot { background: var(--color-primary); }

.insight-warning { background: rgba(var(--color-warning-rgb), 0.06); }
.insight-warning .dash-insight-dot { background: var(--color-warning-text); }

.insight-danger { background: rgba(var(--color-danger-rgb), 0.06); }
.insight-danger .dash-insight-dot { background: var(--color-danger-text); }

.insight-success { background: rgba(var(--color-success-rgb), 0.06); }
.insight-success .dash-insight-dot { background: var(--color-success-text); }

.dash-insight--skeleton {
    width: var(--space-16);
    height: var(--space-3);
    border-radius: var(--radius-sm);
    background: linear-gradient(
        90deg,
        var(--color-surface-3) 0%,
        var(--color-surface-2) 50%,
        var(--color-surface-3) 100%
    );
    background-size: 200% 100%;
    animation: di-shimmer 1.6s ease-in-out infinite;
}
@keyframes di-shimmer {
    0%, 100% { background-position: 0% 0%; opacity: 1; }
    50% { background-position: 200% 0%; opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
    .dash-insight--skeleton { animation: none; }
}
</style>
