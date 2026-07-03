<template>
    <div class="et-enum">
        <!-- Current value display -->
        <div class="et-enum__value-card">
            <span class="et-enum__value">{{ displayValue }}</span>
        </div>

        <!-- Dropdown selector -->
        <div v-if="canExecute && view === 'dropdown' && optionEntries.length" class="et-enum__control">
            <select class="et-enum__select" :value="status?.value" @change="onChange">
                <option v-for="[key, label] of optionEntries" :key="key" :value="key">{{ label }}</option>
            </select>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    view?: string;
    options?: Record<string, string>;
}>();

const emit = defineEmits<{
    set: [value: string];
}>();

const optionEntries = computed(() => Object.entries(props.options ?? {}));

const displayValue = computed(() => {
    const v = props.status?.value;
    if (v == null) return 'N/A';
    return props.options?.[v] ?? String(v);
});

function onChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    emit('set', val);
}
</script>

<style scoped>
.et-enum {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-enum__value-card {
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    text-align: center;
}
.et-enum__value {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.et-enum__control {
    display: flex;
}
.et-enum__select {
    flex: 1;
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    cursor: pointer;
}
.et-enum__select:focus {
    outline: none;
    border-color: var(--color-primary);
}
</style>
