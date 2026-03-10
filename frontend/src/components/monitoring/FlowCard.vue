<template>
    <router-link :to="to" class="block">
        <div
            class="flow-card p-4 rounded-lg border transition-colors"
            :class="cardClass"
            :title="tooltip"
        >
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                    <HealthDot :status="status" />
                    <span class="flow-card__title font-semibold text-sm">{{ title }}</span>
                </div>
                <i :class="icon" class="flow-card__icon text-sm" />
            </div>
            <div class="flex items-end justify-between gap-3">
                <div class="flex flex-col gap-0.5 min-w-0">
                    <div
                        v-for="metric in metrics"
                        :key="metric.label"
                        class="flow-card__metric text-xs font-mono truncate"
                    >
                        {{ metric.label }}: <span class="flow-card__metric-value">{{ metric.value }}</span>
                    </div>
                </div>
                <SparkLine
                    :data="sparkData"
                    :color="sparkColor"
                    :width="100"
                    :height="28"
                />
            </div>
        </div>
    </router-link>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {FlowStatus} from '@/stores/monitoring';
import HealthDot from './HealthDot.vue';
import SparkLine from './SparkLine.vue';

const props = defineProps<{
    title: string;
    icon: string;
    status: FlowStatus;
    to: string;
    metrics: Array<{label: string; value: string | number}>;
    sparkData: number[];
    sparkColor: string;
    tooltip?: string;
}>();

const cardClass = computed(() => {
    switch (props.status) {
        case 'critical':
            return 'flow-card--critical';
        case 'warning':
            return 'flow-card--warning';
        case 'healthy':
            return 'flow-card--healthy';
        default:
            return 'flow-card--default';
    }
});
</script>

<style scoped>
.flow-card:hover { border-color: color-mix(in srgb, var(--color-primary-text) 40%, transparent); }
.flow-card__title { color: var(--color-text-primary); }
.flow-card__icon  { color: var(--color-text-disabled); }
.flow-card__metric { color: var(--color-text-tertiary); }
.flow-card__metric-value { color: var(--color-text-primary); }

.flow-card--critical {
    background-color: color-mix(in srgb, var(--color-danger) 12%, transparent);
    border-color: color-mix(in srgb, var(--color-danger) 35%, transparent);
}
.flow-card--warning {
    background-color: color-mix(in srgb, var(--color-warning) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
}
.flow-card--healthy {
    background-color: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    border-color: color-mix(in srgb, var(--color-border-default) 50%, transparent);
}
.flow-card--default {
    background-color: color-mix(in srgb, var(--color-surface-2) 50%, transparent);
    border-color: color-mix(in srgb, var(--color-border-default) 30%, transparent);
}
</style>
