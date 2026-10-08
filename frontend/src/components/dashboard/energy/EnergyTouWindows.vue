<template>
    <div class="etw">
        <div class="etw-head">
            <span>Label</span><span>From</span><span>To</span><span>Rate</span><span></span>
        </div>
        <div v-for="(w, i) in modelValue" :key="i" class="etw-row">
            <input
                class="etw-in core-input border text-base rounded-lg block w-full p-2"
                :value="w.label"
                maxlength="32"
                placeholder="Peak"
                @input="patch(i, {label: value($event)})"
            />
            <input
                class="etw-in core-input border text-base rounded-lg block w-full p-2"
                :value="w.from"
                type="time"
                @input="patch(i, {from: value($event)})"
            />
            <input
                class="etw-in core-input border text-base rounded-lg block w-full p-2"
                :value="w.to"
                type="time"
                @input="patch(i, {to: value($event)})"
            />
            <input
                class="etw-in core-input border text-base rounded-lg block w-full p-2"
                :value="w.rate"
                type="number"
                step="0.01"
                min="0"
                @input="patch(i, {rate: num($event)})"
            />
            <button type="button" class="etw-del" aria-label="Remove window" @click="remove(i)">
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </div>
        <p v-if="!modelValue.length" class="etw-empty">No windows yet. Add one for each price band across the day.</p>
        <button type="button" class="etw-add" :disabled="modelValue.length >= 8" @click="add">+ Add window</button>
    </div>
</template>

<script setup lang="ts">
import type {TouWindow} from '@/types/dashboard';

const props = defineProps<{modelValue: TouWindow[]}>();
const emit = defineEmits<{'update:modelValue': [TouWindow[]]}>();

const value = (e: Event) => (e.target as HTMLInputElement).value;
const num = (e: Event) => Number((e.target as HTMLInputElement).value);

function patch(i: number, part: Partial<TouWindow>) {
    const next = props.modelValue.map((w, j) => (j === i ? {...w, ...part} : w));
    emit('update:modelValue', next);
}
function add() {
    if (props.modelValue.length >= 8) return;
    emit('update:modelValue', [...props.modelValue, {label: 'Peak', from: '07:00', to: '22:00', rate: 0}]);
}
function remove(i: number) {
    emit('update:modelValue', props.modelValue.filter((_, j) => j !== i));
}
</script>

<style scoped>
.etw-head,
.etw-row {
    display: grid;
    grid-template-columns: 1.4fr 1fr 1fr 0.9fr var(--space-7);
    gap: var(--space-1-5);
    align-items: center;
}
.etw-head {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--color-text-tertiary);
    padding: 0 var(--space-0-5) var(--space-1-5);
}
.etw-row {
    margin-bottom: var(--space-1-5);
}
.etw-del {
    width: var(--space-7);
    height: var(--space-7);
    border-radius: var(--radius-md);
    background: transparent;
    border: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: var(--type-caption);
}
.etw-del:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-3);
}
.etw-empty {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    padding: var(--space-1) var(--space-0-5) var(--space-2);
}
.etw-add {
    background: transparent;
    color: var(--color-primary-text);
    border: 1px dashed color-mix(in srgb, var(--color-primary) 50%, transparent);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
}
.etw-add:hover:not(:disabled) {
    border-color: var(--color-primary);
}
.etw-add:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
}
</style>
