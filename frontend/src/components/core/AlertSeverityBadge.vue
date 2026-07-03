<template>
    <Pill :variant="variant" :icon="icon" :title="severity">
        {{ capitalized }}
    </Pill>
</template>

<script setup lang="ts">
import type {AlertSeverity} from '@api/alert';
import {computed} from 'vue';
import Pill from '@/components/core/Pill.vue';

const ICONS: Record<AlertSeverity, string> = {
    info: 'fas fa-circle-info',
    warning: 'fas fa-triangle-exclamation',
    critical: 'fas fa-circle-exclamation'
};

const VARIANTS: Record<AlertSeverity, 'info' | 'warning' | 'danger'> = {
    info: 'info',
    warning: 'warning',
    critical: 'danger'
};

const props = defineProps<{severity: AlertSeverity}>();

const icon = computed(() => ICONS[props.severity]);
const variant = computed(() => VARIANTS[props.severity]);
const capitalized = computed(
    () => props.severity.charAt(0).toUpperCase() + props.severity.slice(1)
);
</script>
