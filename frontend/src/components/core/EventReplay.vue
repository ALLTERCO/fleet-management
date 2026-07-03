<template>
    <div class="er">
        <div class="er-stage">
            <slot :current-time="currentTime" />
        </div>
        <div class="er-bar">
            <button
                type="button"
                class="er-play"
                :title="playing ? 'Pause' : 'Play'"
                @click="toggle"
            >
                <i class="fas" :class="playing ? 'fa-pause' : 'fa-play'" />
            </button>
            <input
                type="range"
                class="er-scrub"
                :min="startTime"
                :max="endTime"
                :step="step"
                :value="currentTime"
                @input="onScrub"
            />
            <span class="er-time">{{ formatTime(currentTime) }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';

// Time-scrubber shell. currentTime advances at speed*realtime while
// playing; slot exposes the value for any time-aware visualization.

const props = withDefaults(
    defineProps<{
        startTime: number;
        endTime: number;
        speed?: number;
        step?: number;
        format?: (ts: number) => string;
    }>(),
    {
        speed: 60,
        step: 1
    }
);

const currentTime = ref(props.startTime);
const playing = ref(false);
let raf = 0;
let lastFrame = 0;

const totalDuration = computed(() => Math.max(1, props.endTime - props.startTime));

function tick(now: number) {
    if (!playing.value) return;
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    currentTime.value = Math.min(
        props.endTime,
        currentTime.value + dt * props.speed
    );
    if (currentTime.value >= props.endTime) {
        playing.value = false;
        return;
    }
    raf = requestAnimationFrame(tick);
}

function toggle() {
    playing.value = !playing.value;
    if (playing.value) {
        if (currentTime.value >= props.endTime) currentTime.value = props.startTime;
        lastFrame = performance.now();
        raf = requestAnimationFrame(tick);
    } else {
        cancelAnimationFrame(raf);
    }
}

function onScrub(e: Event) {
    currentTime.value = Number((e.target as HTMLInputElement).value);
}

function formatTime(ts: number): string {
    if (props.format) return props.format(ts);
    const pct = ((ts - props.startTime) / totalDuration.value) * 100;
    return `${pct.toFixed(0)}%`;
}

watch(
    () => [props.startTime, props.endTime],
    () => {
        currentTime.value = Math.max(
            props.startTime,
            Math.min(currentTime.value, props.endTime)
        );
    }
);

onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<style scoped>
.er {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    height: 100%;
    min-height: 0;
}
.er-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    border-radius: var(--radius-lg);
    overflow: hidden;
}
.er-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}
.er-play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-3);
    color: var(--color-text-primary);
    cursor: pointer;
    flex-shrink: 0;
}
.er-play:hover {
    background: color-mix(in srgb, var(--color-primary) 30%, var(--color-surface-3));
    border-color: var(--color-primary);
}
.er-scrub {
    flex: 1;
    accent-color: var(--color-primary);
}
.er-time {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    min-width: 64px;
    text-align: right;
}
</style>
