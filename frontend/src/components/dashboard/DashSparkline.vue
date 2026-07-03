<template>
    <svg
        v-if="hasPoints"
        class="dsl"
        :viewBox="`0 0 ${width} ${height}`"
        preserveAspectRatio="none"
        :aria-label="ariaLabel"
        role="img"
    >
        <path
            v-if="fillPath"
            class="dsl__fill"
            :d="fillPath"
            :style="{fill: fillColor}"
        />
        <path
            class="dsl__stroke"
            :d="strokePath"
            :style="{stroke: strokeColor}"
            fill="none"
        />
    </svg>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        points: readonly number[];
        width?: number;
        height?: number;
        strokeColor?: string;
        fillColor?: string;
        ariaLabel?: string;
    }>(),
    {
        width: 100,
        height: 24,
        strokeColor: 'var(--sparkline-stroke)',
        fillColor: 'var(--sparkline-fill)',
        ariaLabel: 'Trend'
    }
);

const hasPoints = computed(() => props.points.length >= 2);

const normalized = computed<readonly {x: number; y: number}[]>(() => {
    const points = props.points;
    if (points.length < 2) return [];
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const stride = props.width / (points.length - 1);
    return points.map((value, idx) => ({
        x: idx * stride,
        y: props.height - ((value - min) / range) * props.height
    }));
});

const strokePath = computed(() => {
    const pts = normalized.value;
    if (pts.length === 0) return '';
    const head = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    const tail = pts
        .slice(1)
        .map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(' ');
    return `${head} ${tail}`;
});

const fillPath = computed(() => {
    const pts = normalized.value;
    if (pts.length === 0) return '';
    const head = `M ${pts[0].x.toFixed(2)} ${props.height} L ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    const tail = pts
        .slice(1)
        .map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(' ');
    const close = `L ${pts[pts.length - 1].x.toFixed(2)} ${props.height} Z`;
    return `${head} ${tail} ${close}`;
});
</script>

<style scoped>
.dsl {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
}

.dsl__stroke {
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
}
</style>
