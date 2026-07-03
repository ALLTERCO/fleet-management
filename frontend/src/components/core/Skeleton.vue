<template>
    <div
        class="skeleton"
        :class="[
            `skeleton--${variant}`,
            { 'skeleton--rounded': rounded },
        ]"
        :style="customStyle"
        role="status"
        aria-label="Loading"
    >
        <span class="sr-only">Loading...</span>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        variant?: 'text' | 'circle' | 'rect' | 'card' | 'row';
        width?: string;
        height?: string;
        rounded?: boolean;
    }>(),
    {
        variant: 'text',
        rounded: false
    }
);

const customStyle = computed(() => {
    const s: Record<string, string> = {};
    if (props.width) s.width = props.width;
    if (props.height) s.height = props.height;
    return s;
});
</script>

<style scoped>
@keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}

.skeleton {
    position: relative;
    overflow: hidden;
    background: var(--color-surface-3);
}

/* Shimmer sweep — left-to-right highlight pass */
.skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
        90deg,
        transparent 0%,
        color-mix(in srgb, var(--color-primary) 6%, var(--color-surface-4)) 50%,
        transparent 100%
    );
    animation: shimmer 1.5s ease-in-out infinite;
}

/* Variants — all sizes use design tokens */
.skeleton--text {
    height: var(--gap-sm);
    width: 100%;
    border-radius: var(--radius-sm);
    margin-bottom: var(--gap-xs);
}

.skeleton--circle {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-full);
    flex-shrink: 0;
}

.skeleton--rect {
    width: 100%;
    height: var(--gap-xl);
    border-radius: var(--radius-md);
}

.skeleton--card {
    width: 100%;
    height: 180px;
    border-radius: var(--radius-lg);
}

.skeleton--row {
    width: 100%;
    height: var(--touch-target-min);
    border-radius: var(--radius-sm);
    margin-bottom: var(--gap-xs);
}

.skeleton--rounded {
    border-radius: var(--radius-full);
}
</style>
