<template>
    <div class="etw">
        <div class="etw-head">
            <span>Label</span><span>From</span><span>To</span><span>Rate</span><span></span>
        </div>
        <div v-for="(w, i) in modelValue" :key="i" class="etw-row">
            <input class="etw-in" :value="w.label" maxlength="32" placeholder="Peak" @input="patch(i, {label: value($event)})" />
            <input class="etw-in" :value="w.from" type="time" @input="patch(i, {from: value($event)})" />
            <input class="etw-in" :value="w.to" type="time" @input="patch(i, {to: value($event)})" />
            <input class="etw-in" :value="w.rate" type="number" step="0.01" min="0" @input="patch(i, {rate: num($event)})" />
            <button type="button" class="etw-del" aria-label="Remove window" @click="remove(i)">✕</button>
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
    grid-template-columns: 1.4fr 1fr 1fr 0.9fr 28px;
    gap: 6px;
    align-items: center;
}
.etw-head {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #5d646f;
    padding: 0 2px 6px;
}
.etw-row {
    margin-bottom: 6px;
}
.etw-in {
    width: 100%;
    background: #0e1116;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 9px;
    padding: 8px 9px;
    color: #f5f6f8;
    font: 500 12.5px 'Inter', system-ui, sans-serif;
}
.etw-del {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #9aa1ac;
    cursor: pointer;
}
.etw-del:hover {
    color: #f5f6f8;
    background: #181c23;
}
.etw-empty {
    font-size: 11.5px;
    color: #5d646f;
    padding: 4px 2px 8px;
}
.etw-add {
    background: transparent;
    color: #4495d1;
    border: 1px dashed rgba(68, 149, 209, 0.5);
    border-radius: 10px;
    padding: 8px 14px;
    font: 600 12.5px 'Inter', system-ui, sans-serif;
    cursor: pointer;
}
.etw-add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
</style>
