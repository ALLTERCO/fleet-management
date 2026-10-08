<template>
    <div class="dmc">
        <div class="dmc-head">
            <span class="dmc-title">
                <i :class="meta.icon" aria-hidden="true" />
                {{ meta.label }}
            </span>
            <span v-if="stats" class="dmc-stats">
                avg {{ fmt(stats.avg) }}{{ meta.unit }}
                <span class="dmc-range">
                    · {{ fmt(stats.min) }}–{{ fmt(stats.max) }}
                </span>
            </span>
        </div>
        <DashTimeChart
            :data="data"
            :type="chartType"
            :color="meta.color"
            :unit="meta.unit"
            :height="180"
            :loading="loading"
        />
    </div>
</template>

<script setup lang="ts">
import type {SensorSource} from '@api/sensor';
import {computed} from 'vue';
import DashTimeChart from '@/components/dashboard/DashTimeChart.vue';
import type {ChartMetric, ChartRange} from '@/composables/useChartData';
import {useChartData} from '@/composables/useChartData';
import {metricMeta} from '@/helpers/chartMetrics';

const props = defineProps<{
    shellyId: string;
    metric: ChartMetric;
    range: ChartRange;
    channel?: number;
    /** Entity's reading source; 'internal' charts the device's own chip. */
    source?: SensorSource;
}>();

const meta = computed(() => metricMeta(props.metric));

// Cumulative energy reads as discrete per-bucket bars; the rest are continuous.
const chartType = computed<'area' | 'bar'>(() =>
    props.metric === 'consumption' ? 'bar' : 'area'
);

const {data, loading} = useChartData(
    () => props.shellyId,
    () => props.metric,
    () => props.range,
    () => props.channel,
    () => props.source
);

// Window summary shown in the header, matching the dashboard chart cards.
const stats = computed(() => {
    const vals = data.value
        .map((d) => d.value)
        .filter((v) => Number.isFinite(v));
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return {avg: sum / vals.length, min: Math.min(...vals), max: Math.max(...vals)};
});

function fmt(v: number): string {
    return v.toFixed(meta.value.precision);
}
</script>

<style scoped>
.dmc {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    padding: var(--space-3) var(--space-4) var(--space-2);
}
.dmc-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-1);
}
.dmc-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-tertiary);
}
.dmc-stats {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.dmc-range {
    color: var(--color-text-tertiary);
}
</style>
