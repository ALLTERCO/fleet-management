<template>
    <div class="dfp" :class="{'dfp--stale': stale}" :title="title">
        <span class="dfp__dot" />
        <span class="dfp__count">{{ currentCount }}</span>
        <span class="dfp__label">online</span>
        <span class="dfp__spark">
            <DashSparkline
                v-if="history.length >= 2"
                :points="history.map((p) => p.value)"
                :width="64"
                :height="18"
                :aria-label="`Online count over the last ${history.length} samples`"
            />
        </span>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import DashSparkline from '@/components/dashboard/DashSparkline.vue';
import type {TimePoint} from '@/types/dashboard-components';

const props = withDefaults(
    defineProps<{
        history: TimePoint[];
        currentCount: number;
        stale?: boolean;
    }>(),
    {stale: false}
);

const title = computed(() => {
    if (props.history.length === 0)
        return `${props.currentCount} devices online`;
    const min = Math.min(...props.history.map((p) => p.value));
    const max = Math.max(...props.history.map((p) => p.value));
    return `${props.currentCount} online (${min}–${max} over last ${props.history.length} samples)`;
});
</script>

<style scoped>
.dfp {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--glass-2-bg);
    backdrop-filter: blur(var(--glass-2-blur));
    -webkit-backdrop-filter: blur(var(--glass-2-blur));
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-full, 999px);
    font-size: var(--type-caption);
}

.dfp__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: 50%;
    background: var(--color-success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 25%, transparent);
    animation: dfp-blink 2.6s ease infinite;
}

.dfp--stale .dfp__dot {
    background: var(--color-warning);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 25%, transparent);
}

@keyframes dfp-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.dfp__count {
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}

.dfp__label {
    color: var(--color-text-tertiary);
}

.dfp__spark {
    display: inline-block;
    width: 64px;
    height: 18px;
    opacity: 0.85;
}
</style>
