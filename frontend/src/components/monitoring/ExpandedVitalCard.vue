<template>
    <div
        class="evc-card rounded-lg transition-all cursor-pointer"
        :title="tooltip"
        :class="isExpanded ? 'col-span-full' : ''"
        @click="isExpanded = !isExpanded"
    >
        <!-- Collapsed view -->
        <div class="p-3">
            <div class="flex items-center justify-between mb-1">
                <div class="text-xs evc-label">{{ label }}</div>
                <i class="fa-solid evc-expand-icon text-2xs"
                    :class="isExpanded ? 'fa-compress' : 'fa-expand'"
                />
            </div>
            <div class="flex items-end justify-between gap-2">
                <span class="text-sm font-mono font-semibold" :class="textColorClass">
                    {{ value }}{{ suffix }}
                </span>
                <SparkLine v-if="!isExpanded && sparkData.length > 1" :data="sparkData" :color="color" :width="60" :height="20" />
            </div>
            <!-- Stats row when expanded -->
            <div v-if="isExpanded && sparkData.length > 1" class="flex gap-4 mt-2 text-xs font-mono evc-label">
                <span>Min: <span class="evc-stat-value">{{ stats.min }}{{ unit }}</span></span>
                <span>Max: <span class="evc-stat-value">{{ stats.max }}{{ unit }}</span></span>
                <span>Avg: <span class="evc-stat-value">{{ stats.avg }}{{ unit }}</span></span>
            </div>
        </div>
        <!-- Expanded chart -->
        <div v-if="isExpanded && sparkData.length > 1" class="px-3 pb-3" @click.stop>
            <TimeSeriesChart
                :data="sparkData"
                :label="label"
                :color="color"
                :unit="unit"
                :height="180"
                :thresholds="thresholds"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import SparkLine from './SparkLine.vue';
import type {Threshold} from './TimeSeriesChart.vue';
import TimeSeriesChart from './TimeSeriesChart.vue';

const props = withDefaults(
    defineProps<{
        label: string;
        value: string | number;
        suffix?: string;
        sparkData?: number[];
        color?: string;
        textColor?: string;
        unit?: string;
        thresholds?: Threshold[];
        tooltip?: string;
    }>(),
    {
        suffix: '',
        sparkData: () => [],
        color: '#60a5fa',
        textColor: '',
        unit: '',
        thresholds: () => []
    }
);

const isExpanded = ref(false);

const textColorClass = computed(() => {
    if (props.textColor) return props.textColor;
    return 'vital-neutral';
});

const stats = computed(() => {
    if (props.sparkData.length === 0) return {min: 0, max: 0, avg: 0};
    const nonZero = props.sparkData.filter((v) => v > 0);
    const data = nonZero.length > 0 ? nonZero : props.sparkData;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const avg = Math.round(data.reduce((a, b) => a + b, 0) / data.length);
    return {min, max, avg};
});
</script>

<style scoped>
.evc-card {
    background-color: var(--color-surface-1);
    border: 1px solid color-mix(in srgb, var(--color-border-default) 40%, transparent);
}
.evc-card:hover {
    border-color: color-mix(in srgb, var(--color-border-strong) 60%, transparent);
}
.evc-label { color: var(--color-text-disabled); }
.evc-expand-icon { color: var(--color-border-strong); }
.evc-stat-value { color: var(--color-text-secondary); }

/* Vital status colors (used as :class from parent) */
.vital-critical { color: var(--color-danger-text); }
.vital-warning { color: var(--color-warning-text); }
.vital-ok { color: var(--color-success-text); }
.vital-neutral { color: var(--color-text-secondary); }
</style>
