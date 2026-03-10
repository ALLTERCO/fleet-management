<template>
    <span class="relative inline-flex" role="img" :aria-label="label">
        <span
            class="inline-block w-2.5 h-2.5 rounded-full"
            :class="dotClass"
            :title="label"
            aria-hidden="true"
        />
        <span
            v-if="status === 'warning' || status === 'critical'"
            class="absolute inset-0 rounded-full animate-ping opacity-40"
            :class="dotClass"
            aria-hidden="true"
        />
    </span>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {FlowStatus} from '@/stores/monitoring';

const props = defineProps<{
    status: FlowStatus;
}>();

const dotClass = computed(() => {
    switch (props.status) {
        case 'healthy':
            return 'dot--healthy';
        case 'warning':
            return 'dot--warning';
        case 'critical':
            return 'dot--critical';
        default:
            return 'dot--unknown';
    }
});

const label = computed(() => {
    switch (props.status) {
        case 'healthy':
            return 'Healthy';
        case 'warning':
            return 'Warning';
        case 'critical':
            return 'Critical';
        default:
            return 'Unknown';
    }
});
</script>

<style scoped>
.dot--healthy { background-color: var(--color-success-text); }
.dot--warning { background-color: var(--color-warning-text); }
.dot--critical { background-color: var(--color-danger); }
.dot--unknown { background-color: var(--color-text-disabled); }
</style>
