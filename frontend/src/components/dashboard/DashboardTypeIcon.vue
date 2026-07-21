<template>
    <span class="dti" :class="`dti--${appearance.accent}`">
        <i :class="appearance.icon" aria-hidden="true" />
    </span>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {appearanceForDashboardType} from '@/types/dashboard';

const props = defineProps<{
    type: string;
}>();

const appearance = computed(() => appearanceForDashboardType(props.type));
</script>

<style scoped>
.dti {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    flex-shrink: 0;
}

.dti--primary {
    background: var(--color-primary-subtle);
    color: var(--color-primary-text);
}
.dti--success {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
}
.dti--danger {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
.dti--energy {
    background: var(--accent-energy-soft);
    color: rgb(var(--accent-energy));
}
.dti--environment {
    background: var(--accent-environment-soft);
    color: var(--accent-environment);
}
.dti--neutral {
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
}
</style>
