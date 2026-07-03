<template>
    <div class="drs">
        <div class="drs-pills">
            <button
                v-for="preset in presets"
                :key="preset.value"
                class="drs-pill"
                :class="{ 'drs-pill--active': selectedPreset === preset.value }"
                @click="selectPreset(preset.value)"
            >{{ preset.label }}</button>
        </div>
        <div v-if="showCustom" class="drs-custom">
            <input v-model="customFrom" type="date" class="drs-input" />
            <span class="drs-sep">→</span>
            <input v-model="customTo" type="date" class="drs-input" />
            <button class="drs-apply" @click="applyCustomRange">Apply</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue?: {from: string; to: string};
        defaultRange?: string;
    }>(),
    {defaultRange: 'last_7_days'}
);

const emit = defineEmits<{
    'update:modelValue': [value: {from: string; to: string}];
    change: [value: {from: string; to: string}];
}>();

const presets = [
    {label: '24h', value: 'last_24h'},
    {label: '7d', value: 'last_7_days'},
    {label: '30d', value: 'last_30_days'},
    {label: 'Month', value: 'this_month'},
    {label: 'Custom', value: 'custom'}
];

const selectedPreset = ref(props.defaultRange);
const customFrom = ref('');
const customTo = ref('');

const showCustom = computed(() => selectedPreset.value === 'custom');

function getDateRange(preset: string): {from: string; to: string} {
    const now = new Date();
    const endOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
        999
    );
    const to = endOfToday.toISOString();
    let from: Date;

    switch (preset) {
        case 'last_24h':
            from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
        case 'last_7_days':
            from = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() - 6,
                0,
                0,
                0
            );
            break;
        case 'last_30_days':
            from = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() - 29,
                0,
                0,
                0
            );
            break;
        case 'this_month':
            from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
            break;
        default:
            from = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() - 6,
                0,
                0,
                0
            );
    }

    return {from: from.toISOString(), to};
}

function selectPreset(preset: string) {
    selectedPreset.value = preset;
    if (preset !== 'custom') {
        const range = getDateRange(preset);
        emit('update:modelValue', range);
        emit('change', range);
    }
}

function applyCustomRange() {
    if (customFrom.value && customTo.value) {
        const range = {
            from: new Date(customFrom.value).toISOString(),
            to: new Date(`${customTo.value}T23:59:59`).toISOString()
        };
        emit('update:modelValue', range);
        emit('change', range);
    }
}

// Initialize with default range
const initialRange = getDateRange(props.defaultRange);
emit('update:modelValue', initialRange);
</script>

<style scoped>
.drs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.drs-pills {
    display: inline-flex;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    border-radius: var(--radius-2xl);
    background: var(--state-hover-bg-strong);
}

.drs-pill {
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: var(--radius-xl);
    font-size: var(--type-body);
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    background: transparent;
    color: var(--color-text-tertiary);
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
}

.drs-pill:hover:not(.drs-pill--active) {
    background: var(--state-hover-bg-strong);
    color: var(--color-text-secondary);
}

.drs-pill--active {
    background: var(--color-primary);
    color: var(--color-text-primary);
    cursor: default;
}

.drs-custom {
    display: flex;
    align-items: center;
    gap: var(--space-1);
}

.drs-input {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    font-size: var(--type-body);
    outline: none;
}

.drs-input:focus {
    border-color: var(--color-primary);
}

.drs-sep {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.drs-apply {
    padding: var(--space-1) var(--space-3);
    background: var(--color-primary);
    color: var(--color-text-primary);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
}

.drs-apply:hover {
    opacity: 0.85;
}
</style>
