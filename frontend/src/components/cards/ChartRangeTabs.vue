<template>
    <div class="crt">
        <button
            v-for="opt in options"
            :key="opt.value"
            class="crt-tab"
            :class="{ 'crt-tab--active': modelValue === opt.value }"
            :style="modelValue === opt.value ? activeStyle : undefined"
            @click.stop="emit('update:modelValue', opt.value)"
        >
            {{ opt.label }}
        </button>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {ChartRange} from '@/composables/useChartData';

const props = withDefaults(
    defineProps<{
        modelValue: ChartRange;
        accentColor?: string;
    }>(),
    {accentColor: '#3B82F6'}
);

const emit = defineEmits<{
    'update:modelValue': [value: ChartRange];
}>();

const options: {label: string; value: ChartRange}[] = [
    {label: '24h', value: '24h'},
    {label: '7d', value: '7d'},
    {label: '30d', value: '30d'}
];

const activeStyle = computed(() => ({
    background: props.accentColor,
    color: '#fff'
}));
</script>

<style scoped>
.crt {
    display: inline-flex;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-2xl);
    background: var(--state-hover-bg-strong);
}
.crt-tab {
    padding: var(--space-0-5) 10px;
    border: none;
    border-radius: var(--radius-xl);
    font-size: var(--type-body);
    font-weight: 700;
    letter-spacing: 0.04em;
    cursor: pointer;
    background: transparent;
    color: var(--color-text-tertiary);
    transition: background 0.15s, color 0.15s;
}
.crt-tab:hover:not(.crt-tab--active) {
    background: var(--state-hover-bg-strong);
    color: var(--color-text-secondary);
}
.crt-tab--active {
    cursor: default;
}
</style>
