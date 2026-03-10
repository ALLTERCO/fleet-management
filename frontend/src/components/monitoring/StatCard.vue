<template>
    <div class="stat-card p-4 rounded-lg">
        <div class="stat-card__label text-xs mb-1">{{ label }}</div>
        <div class="flex items-end justify-between gap-2">
            <span class="text-sm font-mono font-semibold" :class="textClass">{{ value }}{{ suffix }}</span>
            <SparkLine v-if="sparkData.length > 1" :data="sparkData" :color="color" :width="60" :height="20" />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import SparkLine from './SparkLine.vue';

const props = withDefaults(
    defineProps<{
        label: string;
        value: string | number;
        suffix?: string;
        sparkData?: number[];
        color?: string;
        warn?: boolean;
        critical?: boolean;
    }>(),
    {
        suffix: '',
        sparkData: () => [],
        color: '#60a5fa',
        warn: false,
        critical: false
    }
);

const textClass = computed(() => {
    if (props.critical) return 'stat--critical';
    if (props.warn) return 'stat--warning';
    return 'stat--default';
});
</script>

<style scoped>
.stat-card { background-color: var(--color-surface-1); }
.stat-card__label { color: var(--color-text-disabled); }
.stat--critical { color: var(--color-danger-text); }
.stat--warning  { color: var(--color-warning-text); }
.stat--default  { color: var(--color-text-primary); }
</style>
