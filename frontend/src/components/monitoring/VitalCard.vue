<template>
    <div ref="rootEl" class="vital-card p-4 rounded-lg border" :class="colorClass" :title="tooltip">
        <div class="vital-card__label text-xs mb-1">{{ label }}</div>
        <div class="flex items-end justify-between gap-2">
            <span class="text-sm font-mono font-semibold vital-value">
                {{ value }}{{ suffix }}
            </span>
            <SparkLine
                v-if="sparkData.length > 1"
                :data="sparkData"
                :color="resolvedSparkColor"
                :width="60"
                :height="20"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from 'vue';
import {chartColors} from '@/helpers/chartUtils';
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

const rootEl = ref<HTMLElement | null>(null);
const resolvedSparkColor = ref<string>(chartColors.textDisabled);

const colorClass = computed(() => {
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

function resolveSparkColor() {
    if (rootEl.value) {
        resolvedSparkColor.value =
            getComputedStyle(rootEl.value)
                .getPropertyValue('--vital-spark')
                .trim() || chartColors.textDisabled;
    }
}

onMounted(() => nextTick(resolveSparkColor));
watch(colorClass, () => nextTick(resolveSparkColor));
</script>

<style scoped>
.vital-card {
    background-color: var(--color-surface-1);
    border-color: color-mix(in srgb, var(--color-border-default) 40%, transparent);
}
.vital-card__label { color: var(--color-text-disabled); }
.vital-value { color: inherit; }
.vital--danger   { color: var(--color-danger-text);  --vital-spark: var(--color-danger-text); }
.vital--warning  { color: var(--color-warning-text); --vital-spark: var(--color-warning-text); }
.vital--success  { color: var(--color-success-text); --vital-spark: var(--color-success-text); }
.vital--info     { color: var(--color-primary-text); --vital-spark: var(--color-primary-text); }
.vital--default  { color: var(--color-text-primary); --vital-spark: var(--color-text-disabled); }
</style>
