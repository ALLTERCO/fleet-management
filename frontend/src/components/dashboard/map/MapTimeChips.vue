<template>
    <div class="time-chips" role="group" aria-label="Time range">
        <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            class="time-chip"
            :class="{'time-chip--active': opt.value === modelValue}"
            @click="select(opt.value)"
        >
            <span v-if="opt.live" class="time-chip__live" aria-hidden="true" />
            {{ opt.label }}
        </button>
    </div>
</template>

<script setup lang="ts">
export interface TimeChipOption {
    value: string;
    label: string;
    live?: boolean;
}

defineProps<{
    modelValue: string;
    options: readonly TimeChipOption[];
}>();
const emit = defineEmits<{'update:modelValue': [value: string]}>();

function select(value: string): void {
    emit('update:modelValue', value);
}
</script>

<style scoped>
.time-chips {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 44px;
    padding: var(--space-1) var(--space-1-5);
    border-radius: 22px;
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    border: 1px solid var(--glass-border);
    box-shadow: var(--shadow-lg);
}
.time-chip {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 var(--space-3-5, 14px);
    background: transparent;
    border: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    border-radius: 14px;
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease-out-expo);
}
.time-chip:hover { color: var(--color-text-primary); }
.time-chip--active {
    background: rgba(var(--color-primary-rgb), 0.18);
    color: var(--color-text-primary);
}
.time-chip__live {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-status-on);
    box-shadow: 0 0 6px var(--color-status-on);
    margin-right: var(--space-1-5);
    animation: blink-err 1.5s infinite;
}
@media (prefers-reduced-motion: reduce) {
    .time-chip__live { animation: none; }
}
</style>
