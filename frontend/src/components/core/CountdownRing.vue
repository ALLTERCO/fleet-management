<template>
    <span
        class="cdr"
        :class="`cdr--${tone}`"
        role="timer"
        :aria-label="`Expires ${label}`"
        :title="`Expires ${label}`"
    >
        <!-- Decorative — the wrapper's role=timer + aria-label speak. -->
        <svg
            class="cdr__ring"
            :width="SIZE"
            :height="SIZE"
            :viewBox="`0 0 ${SIZE} ${SIZE}`"
            aria-hidden="true"
        >
            <circle
                class="cdr__track"
                :cx="SIZE / 2"
                :cy="SIZE / 2"
                :r="RADIUS"
            />
            <circle
                class="cdr__arc"
                :class="`cdr__arc--${tone}`"
                :cx="SIZE / 2"
                :cy="SIZE / 2"
                :r="RADIUS"
                :stroke-dasharray="CIRCUMFERENCE"
                :stroke-dashoffset="dashOffset"
            />
        </svg>
        <span class="cdr__clock" :class="`cdr__clock--${tone}`">
            {{ clock }}
        </span>
    </span>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {formatCountdown, formatUntil} from '@/helpers/format';

// Countdown pill: a draining ring beside a live H:MM:SS clock. Amber
// under 20% of the window, red under 10%. Driven by the caller's ticker
// so one interval serves every timer on screen.

const SIZE = 20;
const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const props = defineProps<{
    /** Window start (mint time). */
    startAt: string;
    /** Window end (expiry). */
    endAt: string;
    /** Reactive wall-clock ms from the shared ticker. */
    nowMs: number;
}>();

const fraction = computed(() => {
    const start = new Date(props.startAt).getTime();
    const end = new Date(props.endAt).getTime();
    if (end <= start) return 0;
    const left = (end - props.nowMs) / (end - start);
    return Math.min(1, Math.max(0, left));
});

const dashOffset = computed(() => CIRCUMFERENCE * (1 - fraction.value));

const tone = computed(() => {
    if (fraction.value <= 0.1) return 'danger';
    if (fraction.value <= 0.2) return 'warn';
    return 'ok';
});

const label = computed(() => formatUntil(props.endAt, props.nowMs));
const clock = computed(() => formatCountdown(props.endAt, props.nowMs));
</script>

<style scoped>
.cdr {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    flex: none;
    transition: border-color var(--duration-normal) var(--ease-default);
}
.cdr--warn {
    border-color: color-mix(in srgb, var(--color-status-warn) 45%, transparent);
}
.cdr--danger {
    border-color: color-mix(in srgb, var(--color-status-off) 55%, transparent);
}
.cdr__ring {
    transform: rotate(-90deg);
    flex: none;
}
.cdr__track,
.cdr__arc {
    fill: none;
    stroke-width: 2.5;
}
.cdr__track {
    stroke: var(--color-border-subtle);
}
.cdr__arc {
    stroke-linecap: round;
    /* The 1s linear glide between ticker beats is the animation. */
    transition:
        stroke-dashoffset 1s linear,
        stroke var(--duration-normal) var(--ease-default);
}
.cdr__arc--ok {
    stroke: var(--color-status-on);
}
.cdr__arc--warn {
    stroke: var(--color-status-warn);
}
.cdr__arc--danger {
    stroke: var(--color-status-off);
}
.cdr__clock {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
    line-height: 1;
}
.cdr__clock--warn {
    color: var(--color-status-warn);
}
.cdr__clock--danger {
    color: var(--color-status-off);
}

@media (prefers-reduced-motion: reduce) {
    .cdr__arc {
        transition: none;
    }
}
</style>
