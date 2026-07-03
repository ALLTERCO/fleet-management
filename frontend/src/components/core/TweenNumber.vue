<template>
    <span aria-live="polite">{{ rendered }}</span>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';

interface Props {
    value: number;
    /** Animation length in ms — default 320 (matches the doc's duration-moderate). */
    durationMs?: number;
    /** Decimals to render — default 0 (integers, matches KPI counters). */
    decimals?: number;
}

const props = withDefaults(defineProps<Props>(), {
    durationMs: 320,
    decimals: 0
});

const displayed = ref(safe(props.value));
let rafId: number | null = null;

const rendered = computed(() => displayed.value.toFixed(props.decimals));

watch(
    () => props.value,
    (next, prev) => {
        const from = Number.isFinite(prev) ? prev : displayed.value;
        animateTo(safe(from), safe(next));
    }
);

onBeforeUnmount(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
});

function safe(n: number): number {
    return Number.isFinite(n) ? n : 0;
}

// easeOutExpo — matches the doc's preferred entrance curve.
function easeOutExpo(t: number): number {
    return t === 1 ? 1 : 1 - 2 ** (-10 * t);
}

function animateTo(from: number, to: number): void {
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (from === to) {
        displayed.value = to;
        return;
    }
    const start = performance.now();
    const span = props.durationMs;
    const step = (now: number): void => {
        const t = Math.min(1, (now - start) / span);
        displayed.value = from + (to - from) * easeOutExpo(t);
        if (t < 1) rafId = requestAnimationFrame(step);
        else rafId = null;
    };
    rafId = requestAnimationFrame(step);
}
</script>
