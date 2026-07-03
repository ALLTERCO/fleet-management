<template>
    <div v-if="loading && metrics.length === 0" class="kpi-grid kpi-grid--skeleton">
        <div
            v-for="i in skeletonCount"
            :key="i"
            class="kpi-card kpi-card--skeleton"
            aria-hidden="true"
        >
            <div class="kpi-skel-label" />
            <div class="kpi-skel-value" />
            <div class="kpi-skel-spark" />
        </div>
    </div>
    <div v-else class="kpi-grid">
        <div
            v-for="(m, idx) in metrics"
            :key="m.key"
            class="kpi-card"
            :class="[
                `kpi-card--${kpiSeverity(m)}`,
                {'kpi-card--stale': isTileStale(m, nowMs), 'kpi-card--pulse': pulseKeys.has(m.key)}
            ]"
            :style="{'animation-delay': idx * 40 + 'ms'}"
        >
            <div class="kpi-top">
                <span class="kpi-label">{{ m.label }}</span>
                <span v-if="m.live" class="kpi-live" />
            </div>
            <div class="kpi-bottom">
                <span class="kpi-value">{{ formatKpiValue(m) }}</span>
                <span v-if="m.unit" class="kpi-unit">{{ m.unit }}</span>
                <span v-if="m.delta" class="kpi-delta" :class="deltaClass(m.delta)">{{ m.delta }}</span>
            </div>
            <div v-if="m.sparkline && m.sparkline.length >= 2" class="kpi-spark">
                <DashSparkline
                    :points="m.sparkline"
                    :stroke-color="sparkStrokeFor(kpiSeverity(m))"
                    :width="140"
                    :height="22"
                    :aria-label="`${m.label} trend`"
                />
            </div>
            <div class="kpi-foot">
                <span v-if="m.subtitle" class="kpi-subtitle">{{ m.subtitle }}</span>
                <span
                    v-if="m.updatedAt"
                    class="kpi-stamp"
                    :class="{'kpi-stamp--stale': isTileStale(m, nowMs)}"
                >{{ formatRelative(nowMs - m.updatedAt) }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import DashSparkline from '@/components/dashboard/DashSparkline.vue';
import {formatRelative, isStale} from '@/helpers/dashboardTime';
import {
    formatKpiValue,
    kpiDeltaDirection,
    kpiSeverity,
    sparkStrokeFor
} from '@/helpers/kpiFormat';
import type {DashKpiMetric} from '@/types/dashboard-components';

const props = withDefaults(
    defineProps<{
        metrics: DashKpiMetric[];
        loading?: boolean;
        skeletonCount?: number;
    }>(),
    {loading: false, skeletonCount: 6}
);

// Ticking ref so "Xs ago" stamps refresh without each parent re-rendering.
const nowMs = ref(Date.now());
let tickHandle: ReturnType<typeof setInterval> | null = null;

const pulseKeys = ref<Set<string>>(new Set());
const lastValueByKey = new Map<string, DashKpiMetric['value']>();
const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();

onMounted(() => {
    tickHandle = setInterval(() => {
        nowMs.value = Date.now();
    }, 1000);
});

onBeforeUnmount(() => {
    if (tickHandle) clearInterval(tickHandle);
    for (const t of pulseTimers.values()) clearTimeout(t);
    pulseTimers.clear();
});

// Snapshot key→value pairs so the watcher fires on shape changes only,
// not on deep mutations of unrelated metric fields.
const metricSnapshot = computed(() =>
    props.metrics.map((m) => ({key: m.key, value: m.value}))
);

// immediate: true seeds lastValueByKey on mount so the first real change
// pulses (otherwise prev is undefined and we'd silently swallow it).
watch(
    metricSnapshot,
    (next, prev) => {
        const livingKeys = new Set(next.map((m) => m.key));
        const firstRun = prev === undefined;
        for (const {key, value} of next) {
            const last = lastValueByKey.get(key);
            if (!firstRun && last !== undefined && last !== value) {
                schedulePulse(key);
            }
            lastValueByKey.set(key, value);
        }
        for (const key of lastValueByKey.keys()) {
            if (!livingKeys.has(key)) lastValueByKey.delete(key);
        }
        for (const key of pulseTimers.keys()) {
            if (!livingKeys.has(key)) {
                clearTimeout(pulseTimers.get(key));
                pulseTimers.delete(key);
            }
        }
    },
    {immediate: true}
);

function schedulePulse(key: string): void {
    const existing = pulseTimers.get(key);
    if (existing) clearTimeout(existing);
    const live = new Set(pulseKeys.value);
    live.add(key);
    pulseKeys.value = live;
    const timer = setTimeout(() => {
        const next = new Set(pulseKeys.value);
        next.delete(key);
        pulseKeys.value = next;
        pulseTimers.delete(key);
    }, 600);
    pulseTimers.set(key, timer);
}

function isTileStale(m: DashKpiMetric, now: number): boolean {
    return isStale(m.updatedAt, m.expectedIntervalMs, now);
}

function deltaClass(delta: string): string {
    const direction = kpiDeltaDirection(delta);
    if (direction === 'up') return 'kpi-delta--up';
    if (direction === 'down') return 'kpi-delta--down';
    return '';
}
</script>

<style scoped>
.kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-px);
    background: var(--color-border-default);
    border-radius: var(--radius-xl);
    overflow: hidden;
}

.kpi-card {
    background: var(--color-surface-2);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 92px;
    position: relative;
    animation: kpi-slide-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
    transition: background var(--duration-fast) var(--ease-default);
    border-left: 3px solid transparent;
}

.kpi-card:hover {
    background: var(--color-surface-3);
}

.kpi-card--warning {
    border-left-color: var(--color-warning);
}

.kpi-card--danger {
    border-left-color: var(--color-danger);
    background: color-mix(in srgb, var(--color-danger) 5%, var(--color-surface-2));
}

.kpi-card--pulse {
    box-shadow: var(--pulse-ring);
    transition:
        box-shadow var(--pulse-ring-duration) var(--ease-default),
        background var(--duration-fast) var(--ease-default);
}

@keyframes kpi-slide-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
}

.kpi-top {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
}

.kpi-label {
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
}

.kpi-bottom {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
}

.kpi-value {
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.5px;
    line-height: 1.1;
}

.kpi-card--danger .kpi-value {
    color: var(--color-danger-text);
}

.kpi-unit {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

.kpi-spark {
    height: 22px;
    margin-top: var(--space-1);
    opacity: 0.85;
}

.kpi-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    margin-top: auto;
    padding-top: var(--space-1);
}

.kpi-subtitle {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}

.kpi-stamp {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    font-variant-numeric: tabular-nums;
}

.kpi-stamp--stale {
    color: var(--color-warning);
    font-weight: var(--font-semibold);
}

@keyframes kpi-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
}

.kpi-live {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-success-text);
    animation: kpi-pulse 2.5s ease infinite;
    flex-shrink: 0;
}

.kpi-delta {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    padding: 1px var(--space-1-5);
    border-radius: var(--radius-sm);
    margin-left: var(--space-0-5);
}

.kpi-delta--up {
    color: var(--color-danger-text);
    background: rgba(var(--color-danger-rgb), 0.08);
}

.kpi-delta--down {
    color: var(--color-success-text);
    background: rgba(var(--color-success-rgb), 0.08);
}

.kpi-grid--skeleton .kpi-card--skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    min-height: var(--space-12);
}
.kpi-skel-label,
.kpi-skel-value,
.kpi-skel-spark {
    border-radius: var(--radius-sm);
    background: linear-gradient(
        90deg,
        var(--color-surface-3) 0%,
        var(--color-surface-2) 50%,
        var(--color-surface-3) 100%
    );
    background-size: 200% 100%;
    animation: kpi-shimmer 1.6s ease-in-out infinite;
}
.kpi-skel-label { width: 40%; height: var(--space-2); }
.kpi-skel-value { width: 70%; height: var(--space-4); }
.kpi-skel-spark { width: 100%; height: var(--space-3); margin-top: auto; }
@keyframes kpi-shimmer {
    0%, 100% { background-position: 0% 0%; opacity: 1; }
    50% { background-position: 200% 0%; opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
    .kpi-skel-label,
    .kpi-skel-value,
    .kpi-skel-spark { animation: none; }
}
</style>
