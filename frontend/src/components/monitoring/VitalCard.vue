<template>
    <div class="vital-card p-4 rounded-lg border" :title="tooltip">
        <div class="vital-card__label text-xs mb-1">{{ label }}</div>
        <div class="flex items-end justify-between gap-2">
            <span class="text-sm font-mono font-semibold" :class="textClass">
                {{ value }}{{ suffix }}
            </span>
            <SparkLine
                v-if="sparkData.length > 1"
                :data="sparkData"
                :color="sparkColor"
                :width="60"
                :height="20"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import SparkLine from './SparkLine.vue';

const props = withDefaults(
    defineProps<{
        label: string;
        value: string;
        color?: string;
        suffix?: string;
        sparkData?: number[];
        tooltip?: string;
    }>(),
    {
        color: 'neutral',
        suffix: '',
        sparkData: () => []
    }
);

const textClass = computed(() => {
    switch (props.color) {
        case 'red':
            return 'vital--danger';
        case 'yellow':
            return 'vital--warning';
        case 'green':
            return 'vital--success';
        case 'blue':
            return 'vital--info';
        default:
            return 'vital--default';
    }
});

const sparkColor = computed(() => {
    switch (props.color) {
        case 'red':
            return '#f87171';
        case 'yellow':
            return '#fbbf24';
        case 'green':
            return '#34d399';
        case 'blue':
            return '#60a5fa';
        default:
            return '#a3a3a3';
    }
});
</script>

<style scoped>
.vital-card {
    background-color: var(--color-surface-1);
    border-color: color-mix(in srgb, var(--color-border-default) 40%, transparent);
}
.vital-card__label { color: var(--color-text-disabled); }
.vital--danger   { color: var(--color-danger-text); }
.vital--warning  { color: var(--color-warning-text); }
.vital--success  { color: var(--color-success-text); }
.vital--info     { color: var(--color-primary-text); }
.vital--default  { color: var(--color-text-primary); }
</style>
