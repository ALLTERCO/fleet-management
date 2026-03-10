<template>
    <svg :width="width" :height="height" class="overflow-visible flex-shrink-0">
        <defs v-if="filled">
            <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" :stop-color="color" stop-opacity="0.3" />
                <stop offset="100%" :stop-color="color" stop-opacity="0.03" />
            </linearGradient>
        </defs>
        <polygon
            v-if="filled && areaPoints"
            :points="areaPoints"
            :fill="`url(#${gradientId})`"
        />
        <polyline
            v-if="linePoints"
            :points="linePoints"
            fill="none"
            :stroke="color"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"
        />
    </svg>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        data: number[];
        width?: number;
        height?: number;
        color?: string;
        filled?: boolean;
    }>(),
    {
        width: 120,
        height: 32,
        color: '#60a5fa',
        filled: true
    }
);

const gradientId = `spark-grad-${Math.random().toString(36).slice(2, 8)}`;

const linePoints = computed(() => {
    if (!props.data.length) return '';
    const d = props.data;
    const max = Math.max(...d, 1); // avoid division by 0
    const min = Math.min(...d, 0);
    const range = max - min || 1;
    const pad = 1; // padding from edges
    const w = props.width - pad * 2;
    const h = props.height - pad * 2;
    const step = d.length > 1 ? w / (d.length - 1) : 0;

    return d
        .map((v, i) => {
            const x = pad + i * step;
            const y = pad + h - ((v - min) / range) * h;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
});

const areaPoints = computed(() => {
    if (!linePoints.value) return '';
    const pad = 1;
    const bottom = props.height - pad;
    const d = props.data;
    const w = props.width - pad * 2;
    const step = d.length > 1 ? w / (d.length - 1) : 0;
    const lastX = pad + (d.length - 1) * step;
    return `${pad},${bottom} ${linePoints.value} ${lastX.toFixed(1)},${bottom}`;
});
</script>
