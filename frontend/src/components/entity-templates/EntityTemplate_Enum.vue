<template>
    <div class="et-enum">
        <!-- Current value display -->
        <div class="et-enum__value-card">
            <span class="et-enum__value">{{ displayValue }}</span>
        </div>

        <!-- Dropdown selector -->
        <div v-if="canExecute && view === 'dropdown' && optionEntries.length" class="et-enum__control">
            <select class="et-enum__select" :value="selectValue" @change="onChange">
                <option value="" disabled>Select…</option>
                <option v-for="[key, label] of optionEntries" :key="key" :value="key">{{ label }}</option>
            </select>
            <button
                v-if="selectValue !== ''"
                type="button"
                class="et-enum__clear"
                title="Clear value"
                aria-label="Clear value"
                @click="clearValue"
            >
                <i class="fas fa-xmark" />
            </button>
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

// null clears the enum — Enum.Set accepts it per device spec.
const emit = defineEmits<{
    set: [value: string | null];
}>();

const optionEntries = computed(() => Object.entries(props.options ?? {}));

// Controlled select: the display always derives from props.status. A fresh
// virtual component has no status until its first write, so a null value
// maps to the disabled placeholder instead of the browser silently showing
// the first option.
const selectValue = computed(() => {
    const v = props.status?.value;
    return v == null ? '' : String(v);
});

const displayValue = computed(() => {
    const v = props.status?.value;
    if (v == null) return 'N/A';
    return props.options?.[v] ?? String(v);
});

function onChange(e: Event) {
    const el = e.target as HTMLSelectElement;
    emit('set', el.value);
    // The confirmed value arrives via NotifyStatus and flows back in through
    // props.status. Snap the DOM back so a failed write cannot leave the
    // select asserting a value the device never took.
    el.value = selectValue.value;
}

// Same confirm-via-status flow as onChange: the display only moves once
// the device reports the cleared value.
function clearValue() {
    emit('set', null);
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
    gap: var(--space-1-5);
}
.et-enum__clear {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
}
.et-enum__clear:hover {
    background-color: var(--color-surface-2);
    color: var(--color-text-primary);
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
