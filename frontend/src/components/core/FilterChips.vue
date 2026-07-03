<template>
    <div v-if="chips.length > 0" class="fc">
        <button
            v-for="chip in chips"
            :key="chip.key"
            type="button"
            class="fc__chip"
            :aria-label="`Remove filter: ${chip.label}`"
            @click="emit('remove', chip.key)"
        >
            <span v-if="chip.section" class="fc__chip-section">{{ chip.section }}:</span>
            <span class="fc__chip-label">{{ chip.label }}</span>
            <i class="fas fa-xmark fc__chip-x" />
        </button>
        <button
            v-if="chips.length > 1"
            type="button"
            class="fc__clear"
            @click="emit('clear')"
        >
            Clear all
        </button>
    </div>
</template>

<script setup lang="ts">
/**
 * Visible active-filter chips. Each chip is a removable pill above the list,
 * so users see *what* they've filtered without opening the filter modal.
 * Pages assemble the `chips` array from their filter state and translate
 * the `remove` event back into a filter mutation.
 */

export interface FilterChip {
    /** Unique identifier the page uses to dispatch the remove. */
    key: string;
    /** Section title shown before the value (optional). */
    section?: string;
    /** Human-readable value being filtered on. */
    label: string;
}

defineProps<{
    chips: readonly FilterChip[];
}>();

const emit = defineEmits<{
    remove: [key: string];
    clear: [];
}>();
</script>

<style scoped>
.fc {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}
.fc__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) var(--space-2);
    font: inherit;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-primary);
    background: rgba(var(--color-primary-rgb), 0.08);
    border: 1px solid rgba(var(--color-primary-rgb), 0.18);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast);
}
.fc__chip:hover {
    background: rgba(var(--color-primary-rgb), 0.14);
    border-color: rgba(var(--color-primary-rgb), 0.3);
}
.fc__chip-section {
    color: var(--color-text-tertiary);
    font-weight: var(--font-medium);
}
.fc__chip-label {
    color: var(--color-text-primary);
}
.fc__chip-x {
    font-size: var(--type-body);
    opacity: 0.7;
}
.fc__clear {
    background: none;
    border: none;
    padding: 0 var(--space-1);
    font: inherit;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.fc__clear:hover {
    color: var(--color-primary);
}
</style>
