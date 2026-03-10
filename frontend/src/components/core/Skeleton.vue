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
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

.skeleton {
    background: linear-gradient(
        90deg,
        var(--color-surface-3) 25%,
        var(--color-surface-4) 50%,
        var(--color-surface-3) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
}

/* Variants */
.skeleton--text {
    height: 0.875rem;
    width: 100%;
    border-radius: var(--radius-sm);
    margin-bottom: 0.5rem;
}

.skeleton--circle {
    width: 3rem;
    height: 3rem;
    border-radius: var(--radius-full);
    flex-shrink: 0;
}

.skeleton--rect {
    width: 100%;
    height: 6rem;
    border-radius: var(--radius-md);
}

.skeleton--card {
    width: 100%;
    height: 180px;
    border-radius: var(--radius-lg);
}

.skeleton--row {
    width: 100%;
    height: 2.5rem;
    border-radius: var(--radius-sm);
    margin-bottom: 0.5rem;
}

.skeleton--rounded {
    border-radius: var(--radius-full);
}
</style>
