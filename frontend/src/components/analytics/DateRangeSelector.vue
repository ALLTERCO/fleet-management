<template>
    <div class="flex items-center gap-4">
        <div class="flex gap-2">
            <button
                v-for="preset in presets"
                :key="preset.value"
                class="px-3 py-1 text-sm rounded transition-colors"
                :class="selectedPreset === preset.value
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-2)]'"
                @click="selectPreset(preset.value)"
            >
                {{ preset.label }}
            </button>
        </div>

        <div v-if="showCustom" class="flex items-center gap-2">
            <input
                v-model="customFrom"
                type="date"
                class="bg-[var(--color-surface-3)] text-white px-3 py-1 rounded text-sm border border-[var(--color-border-strong)] focus:border-[var(--color-primary)] focus:outline-none"
            />
            <span class="text-[var(--color-text-tertiary)]">to</span>
            <input
                v-model="customTo"
                type="date"
                class="bg-[var(--color-surface-3)] text-white px-3 py-1 rounded text-sm border border-[var(--color-border-strong)] focus:border-[var(--color-primary)] focus:outline-none"
            />
            <button
                class="px-3 py-1 bg-[var(--color-primary)] text-white text-sm rounded hover:bg-[var(--color-primary-hover)] transition-colors"
                @click="applyCustomRange"
            >
                Apply
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';

const props = withDefaults(
    defineProps<{
        modelValue?: {from: string; to: string};
        defaultRange?: string;
    }>(),
    {
        defaultRange: 'last_7_days'
    }
);

const emit = defineEmits<{
    'update:modelValue': [value: {from: string; to: string}];
    change: [value: {from: string; to: string}];
}>();

const presets = [
    {label: '24h', value: 'last_24h'},
    {label: '7 days', value: 'last_7_days'},
    {label: '30 days', value: 'last_30_days'},
    {label: 'This month', value: 'this_month'},
    {label: 'Custom', value: 'custom'}
];

const selectedPreset = ref(props.defaultRange);
const customFrom = ref('');
const customTo = ref('');

const showCustom = computed(() => selectedPreset.value === 'custom');

function getDateRange(preset: string): {from: string; to: string} {
    const now = new Date();
    // Set 'to' to end of today (23:59:59) to ensure today is fully included
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
            // Start from 7 days ago at 00:00:00
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
            to: new Date(customTo.value + 'T23:59:59').toISOString()
        };
        emit('update:modelValue', range);
        emit('change', range);
    }
}

// Initialize with default range
const initialRange = getDateRange(props.defaultRange);
emit('update:modelValue', initialRange);
</script>
