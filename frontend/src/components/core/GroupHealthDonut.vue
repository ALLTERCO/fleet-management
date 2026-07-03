<template>
    <div class="ghd" :title="title">
        <svg
            class="ghd__svg"
            :viewBox="`0 0 ${SIZE} ${SIZE}`"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            :aria-label="title"
        >
            <!-- Background track. -->
            <circle
                :cx="SIZE / 2"
                :cy="SIZE / 2"
                :r="R"
                fill="none"
                stroke="var(--color-surface-3)"
                :stroke-width="STROKE"
            />
            <!-- Online arc — primary stroke, primary-tinted glow. -->
            <circle
                v-if="total > 0"
                :cx="SIZE / 2"
                :cy="SIZE / 2"
                :r="R"
                fill="none"
                :stroke="onlinePct >= 100
                    ? 'var(--color-status-on)'
                    : healthColor"
                :stroke-width="STROKE"
                stroke-linecap="round"
                :stroke-dasharray="circumference"
                :stroke-dashoffset="offset"
                :transform="`rotate(-90 ${SIZE / 2} ${SIZE / 2})`"
            />
            <!-- Center text: online count over total. -->
            <text
                :x="SIZE / 2"
                :y="SIZE / 2"
                text-anchor="middle"
                dominant-baseline="central"
                fill="var(--color-text-primary)"
                :font-size="SIZE * 0.32"
                :font-weight="800"
            >
                {{ online }}
                <tspan
                    fill="var(--color-text-disabled)"
                    :font-size="SIZE * 0.18"
                    :font-weight="600"
                >/{{ total }}</tspan>
            </text>
        </svg>
        <div class="ghd__label" :style="{color: healthColor}">
            {{ healthLabel }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

/**
 * Compact health ring showing online/total devices for a group. Stroke
 * color reflects health: green when 100% online, amber when partial, red
 * when none. Drop into group-detail summaries to make fleet status
 * scannable at a glance.
 */

const SIZE = 80;
const STROKE = 8;
const R = (SIZE - STROKE) / 2;

const props = withDefaults(
    defineProps<{
        online: number;
        total: number;
    }>(),
    {online: 0, total: 0}
);

const circumference = computed(() => 2 * Math.PI * R);
const onlinePct = computed(() =>
    props.total === 0 ? 0 : (props.online / props.total) * 100
);
const offset = computed(
    () => circumference.value * (1 - onlinePct.value / 100)
);

const healthColor = computed(() => {
    if (props.total === 0) return 'var(--color-text-disabled)';
    if (props.online === 0) return 'var(--color-status-off)';
    if (props.online < props.total) return 'var(--color-status-warn)';
    return 'var(--color-status-on)';
});

const healthLabel = computed(() => {
    if (props.total === 0) return 'No devices';
    if (props.online === 0) return 'All offline';
    if (props.online === props.total) return 'All online';
    return `${props.total - props.online} offline`;
});

const title = computed(
    () => `${props.online} of ${props.total} online — ${healthLabel.value}`
);
</script>

<style scoped>
.ghd {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 96px;
    flex-shrink: 0;
}
.ghd__svg {
    width: 100%;
    height: auto;
    display: block;
}
.ghd__label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-align: center;
    line-height: var(--leading-tight);
}
</style>
