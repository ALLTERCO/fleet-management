<template>
    <div class="stat-card">
        <div v-if="loading" class="stat-skeleton" />
        <template v-else>
            <div class="stat-value-row">
                <span class="stat-value">{{ displayValue }}</span>
                <span class="stat-unit">{{ config.unit }}</span>
            </div>
            <div class="stat-bar-track">
                <div
                    class="stat-bar-fill"
                    :style="{width: animatedPct + '%', background: barColor}"
                />
            </div>
            <div class="stat-range">
                <span>{{ config.min }}{{ config.unit }}</span>
                <span>{{ config.max }}{{ config.unit }}</span>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {chartColors, hexToRgba} from '@/helpers/chartUtils';
import type {DashGaugeConfig} from '@/types/dashboard-components';

const props = defineProps<{
    config: DashGaugeConfig;
    loading?: boolean;
}>();

const animatedPct = ref(0);
const displayValue = ref(props.config.value);

const fillPct = computed(() => {
    const range = props.config.max - props.config.min;
    if (range <= 0) return 50;
    return Math.max(
        0,
        Math.min(100, ((props.config.value - props.config.min) / range) * 100)
    );
});

const barColor = computed(() => {
    const c = props.config.color ?? chartColors.primary;
    return `linear-gradient(90deg, ${hexToRgba(c, 0.3)}, ${hexToRgba(c, 0.7)})`;
});

function getDecimalPlaces(n: number): number {
    const s = String(n);
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
}

let rafHandle: number | undefined;
function animateTo(target: number, targetValue: number) {
    const startPct = animatedPct.value;
    const startVal = displayValue.value;
    const dp = getDecimalPlaces(targetValue);
    const duration = 800;
    const start = performance.now();
    function step(now: number) {
        const elapsed = Math.min((now - start) / duration, 1);
        const ease = 1 - (1 - elapsed) ** 3;
        animatedPct.value = startPct + (target - startPct) * ease;
        const raw = startVal + (targetValue - startVal) * ease;
        displayValue.value = Number(raw.toFixed(dp));
        if (elapsed < 1) {
            rafHandle = requestAnimationFrame(step);
        } else {
            rafHandle = undefined;
        }
    }
    if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
    rafHandle = requestAnimationFrame(step);
}

onBeforeUnmount(() => {
    if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
});

onMounted(() => {
    animateTo(fillPct.value, props.config.value);
});

watch(
    () => props.config.value,
    () => {
        animateTo(fillPct.value, props.config.value);
    }
);
</script>

<style scoped>
.stat-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    justify-content: center;
    overflow: hidden;
    animation: stat-fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
    width: 100%;
    box-sizing: border-box;
}
@keyframes stat-fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
}
.stat-skeleton {
    height: 60px;
    background: var(--color-surface-3);
    border-radius: var(--radius-sm);
    animation: stat-pulse 1.5s ease infinite;
}
@keyframes stat-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
.stat-value-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
}
.stat-value {
    font-size: var(--type-subheading);
    font-weight: 600;
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.5px;
    line-height: 1;
}
.stat-unit {
    font-size: var(--type-body);
    font-weight: 500;
    color: var(--color-text-tertiary);
}
.stat-bar-track {
    height: 4px;
    background: var(--color-surface-3);
    border-radius: var(--radius-xs);
    overflow: hidden;
}
.stat-bar-fill {
    height: 100%;
    border-radius: var(--radius-xs);
    transition: width 0.05s linear;
}
.stat-range {
    display: flex;
    justify-content: space-between;
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    font-variant-numeric: tabular-nums;
}
</style>
