<template>
    <div
        class="metric-card rounded-lg p-4 flex flex-col"
        :class="[colorClasses.bg]"
    >
        <div class="flex items-center justify-between mb-2">
            <span class="text-[var(--color-text-tertiary)] text-sm flex items-center gap-2">
                <i :class="icon" class="text-lg" :style="{ color: iconColor }"></i>
                {{ label }}
            </span>
            <span v-if="trend !== undefined" class="text-xs" :class="trendClass">
                <i :class="trendIcon"></i>
                {{ Math.abs(trend).toFixed(1) }}%
            </span>
        </div>
        <div class="flex items-baseline gap-2">
            <span class="text-2xl font-bold" :class="colorClasses.text">
                {{ formattedValue }}
            </span>
            <span class="text-[var(--color-text-tertiary)] text-sm">{{ unit }}</span>
        </div>
        <div v-if="showRange && min !== undefined && max !== undefined" class="mt-2 text-xs text-[var(--color-text-disabled)]">
            <span>Min: {{ formatValue(min) }}</span>
            <span class="mx-2">|</span>
            <span>Max: {{ formatValue(max) }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = withDefaults(
    defineProps<{
        label: string;
        value: number | string | null;
        unit: string;
        icon: string;
        color?:
            | 'blue'
            | 'green'
            | 'yellow'
            | 'red'
            | 'purple'
            | 'cyan'
            | 'orange'
            | 'teal'
            | 'gray';
        min?: number;
        max?: number;
        trend?: number;
        showRange?: boolean;
        decimals?: number;
    }>(),
    {
        color: 'blue',
        showRange: false,
        decimals: 1
    }
);

const colorMap = {
    blue: {bg: 'hover:bg-[var(--color-primary-subtle)]/30', text: 'text-[var(--color-primary-text)]'},
    green: {bg: 'hover:bg-[var(--color-success-subtle)]/30', text: 'text-[var(--color-success-text)]'},
    yellow: {bg: 'hover:bg-[var(--color-warning-subtle)]/30', text: 'text-[var(--color-warning-text)]'},
    red: {bg: 'hover:bg-[var(--color-danger-subtle)]/30', text: 'text-[var(--color-danger-text)]'},
    purple: {bg: 'hover:bg-[var(--color-accent-subtle)]/30', text: 'text-[var(--color-accent-text)]'},
    cyan: {bg: 'hover:bg-[var(--color-info-subtle)]/30', text: 'text-[var(--color-info-text)]'},
    teal: {bg: 'hover:bg-[var(--color-teal)]/10', text: 'text-[var(--color-teal-text)]'},
    orange: {bg: 'hover:bg-[var(--color-orange-subtle)]/30', text: 'text-[var(--color-orange-text)]'},
    gray: {bg: 'hover:bg-[var(--color-surface-1)]/30', text: 'text-[var(--color-text-tertiary)]'}
};

const iconColorMap: Record<string, string> = {
    blue: '#60a5fa',
    green: '#4ade80',
    yellow: '#facc15',
    red: '#f87171',
    purple: '#c084fc',
    cyan: '#22d3ee',
    teal: '#2dd4bf',
    orange: '#fb923c',
    gray: '#9ca3af'
};

const colorClasses = computed(() => colorMap[props.color] || colorMap.blue);
const iconColor = computed(
    () => iconColorMap[props.color] || iconColorMap.blue
);

const formattedValue = computed(() => {
    if (props.value === null || props.value === undefined) return '--';
    if (typeof props.value === 'string') return props.value;
    return formatValue(props.value);
});

function formatValue(val: number): string {
    if (val >= 1000000) return (val / 1000000).toFixed(props.decimals) + 'M';
    if (val >= 1000) return (val / 1000).toFixed(props.decimals) + 'k';
    return val.toFixed(props.decimals);
}

const trendClass = computed(() => {
    if (props.trend === undefined) return '';
    return props.trend >= 0 ? 'text-[var(--color-success-text)]' : 'text-[var(--color-danger-text)]';
});

const trendIcon = computed(() => {
    if (props.trend === undefined) return '';
    return props.trend >= 0 ? 'fas fa-arrow-up' : 'fas fa-arrow-down';
});
</script>

<style scoped>
.metric-card {
    background-color: var(--color-surface-3);
    border: 1px solid var(--glass-border);
    box-shadow: var(--glass-shadow);
    transition: background-color var(--duration-fast) var(--ease-default);
}
</style>
