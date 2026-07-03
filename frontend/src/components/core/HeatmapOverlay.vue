<template>
    <canvas
        v-if="active"
        ref="canvasRef"
        class="heatmap-overlay"
        aria-hidden="true"
    />
</template>

<script setup lang="ts">
import {onMounted, onUnmounted, ref} from 'vue';
import {
    getClickEvents,
    isHeatmapEnabled,
    onHeatmapChange
} from '@/tools/observability';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const active = ref(isHeatmapEnabled());
let intervalId: ReturnType<typeof setInterval> | null = null;

function startLoop() {
    if (intervalId) return;
    intervalId = setInterval(render, 250); // ~4fps — click data barely changes
}
function stopLoop() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

// Subscribe to toggle changes from control panel
const unsubscribe = onHeatmapChange((v) => {
    active.value = v;
    if (v) startLoop();
    else stopLoop();
});

// Heatmap color stops: cold (blue) → warm (yellow) → hot (red)
function intensityColor(ratio: number): string {
    if (ratio < 0.5) {
        const t = ratio * 2;
        const r = Math.round(60 + 195 * t);
        const g = Math.round(100 + 155 * t);
        const b = Math.round(250 - 210 * t);
        return `rgba(${r},${g},${b},0.45)`;
    }
    const t = (ratio - 0.5) * 2;
    const r = 255;
    const g = Math.round(255 - 185 * t);
    const b = Math.round(40 - 40 * t);
    return `rgba(${r},${g},${b},0.55)`;
}

function render() {
    const canvas = canvasRef.value;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);

    const clicks = getClickEvents();
    if (clicks.length === 0) return;

    const now = Date.now();
    const maxAge = 5 * 60_000; // 5 minutes

    for (const click of clicks) {
        const age = now - click.timestamp;
        if (age > maxAge) continue;

        const freshness = 1 - age / maxAge;
        const radius = 8 + freshness * 16;

        // Count nearby clicks for intensity
        let nearby = 0;
        for (const other of clicks) {
            const dx = click.x - other.x;
            const dy = click.y - other.y;
            if (dx * dx + dy * dy < 2500) nearby++;
        }
        const intensity = Math.min(nearby / 10, 1);

        const gradient = ctx.createRadialGradient(
            click.x,
            click.y,
            0,
            click.x,
            click.y,
            radius
        );
        gradient.addColorStop(0, intensityColor(intensity));
        gradient.addColorStop(1, 'transparent');

        ctx.globalAlpha = 0.3 + freshness * 0.5;
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(click.x, click.y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

onMounted(() => {
    if (active.value) startLoop();
});

onUnmounted(() => {
    stopLoop();
    unsubscribe();
});
</script>

<style scoped>
.heatmap-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-tooltip);
    pointer-events: none;
    mix-blend-mode: screen;
}
</style>
