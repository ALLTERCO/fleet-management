<template>
    <div class="monitoring-status-row">
        <HealthDot :status="status" />
        <div class="monitoring-status-row__copy">
            <h3>{{ title }}</h3>
            <p v-if="description">{{ description }}</p>
        </div>
        <slot />
    </div>
</template>

<script setup lang="ts">
import HealthDot from '@/components/monitoring/HealthDot.vue';
import type {FlowStatus} from '@/stores/monitoring';

defineProps<{
    status: FlowStatus;
    title: string;
    description?: string;
}>();
</script>

<style scoped>
.monitoring-status-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
}
.monitoring-status-row__copy {
    min-width: 0;
}
.monitoring-status-row h3,
.monitoring-status-row p {
    margin: 0;
}
.monitoring-status-row h3 {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.monitoring-status-row p {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>
