<template>
    <div class="map-skel" aria-busy="true" aria-label="Loading map">
        <div class="map-skel__shimmer" />
        <div class="map-skel__pins" aria-hidden="true">
            <span
                v-for="i in 5"
                :key="i"
                class="map-skel__pin"
                :style="pinStyle(i)"
            />
        </div>
        <div class="map-skel__caption">Loading map…</div>
    </div>
</template>

<script setup lang="ts">
// Random-but-stable positions for the placeholder pins; matches the bound
// distribution most fleets fall into (Europe/Americas cluster).
const PIN_POSITIONS = [
    {top: 38, left: 22},
    {top: 32, left: 48},
    {top: 36, left: 53},
    {top: 30, left: 56},
    {top: 60, left: 68}
] as const;

function pinStyle(i: number): Record<string, string> {
    const pos = PIN_POSITIONS[i - 1] ?? PIN_POSITIONS[0];
    return {top: `${pos.top}%`, left: `${pos.left}%`};
}
</script>

<style scoped>
.map-skel {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background:
        radial-gradient(
            ellipse 70% 55% at 25% 35%,
            rgba(var(--color-primary-rgb), 0.08) 0%,
            transparent 60%
        ),
        radial-gradient(
            ellipse 50% 50% at 75% 65%,
            rgba(var(--color-status-on-rgb), 0.04) 0%,
            transparent 60%
        ),
        linear-gradient(180deg, var(--color-surface-1) 0%, var(--color-surface-bg) 100%);
}

.map-skel__shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
        100deg,
        transparent 0%,
        rgba(var(--color-frost-rgb), 0.04) 50%,
        transparent 100%
    );
    background-size: 200% 100%;
    animation: map-skel-sweep 2.4s var(--ease-out-expo) infinite;
}

.map-skel__pins {
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.map-skel__pin {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(var(--color-primary-rgb), 0.45);
    box-shadow: 0 0 0 4px rgba(var(--color-primary-rgb), 0.12);
    transform: translate(-50%, -50%);
    animation: map-skel-pulse 1.8s ease-in-out infinite;
}
.map-skel__pin:nth-child(2) { animation-delay: 0.3s; }
.map-skel__pin:nth-child(3) { animation-delay: 0.6s; }
.map-skel__pin:nth-child(4) { animation-delay: 0.9s; }
.map-skel__pin:nth-child(5) { animation-delay: 1.2s; }

.map-skel__caption {
    position: absolute;
    bottom: var(--space-4);
    left: 50%;
    transform: translateX(-50%);
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-full);
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    border: 1px solid var(--glass-border);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

@keyframes map-skel-sweep {
    0% { background-position: 200% 0; }
    100% { background-position: -100% 0; }
}

@keyframes map-skel-pulse {
    0%, 100% {
        transform: translate(-50%, -50%) scale(0.9);
        opacity: 0.45;
    }
    50% {
        transform: translate(-50%, -50%) scale(1.15);
        opacity: 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .map-skel__shimmer,
    .map-skel__pin { animation: none; }
}
</style>
