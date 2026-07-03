<template>
    <!-- One cohesive field: number + unit share a single border. -->
    <div class="dur">
        <input
            v-model.number="num"
            type="number"
            min="0"
            class="dur__num"
            aria-label="Amount"
        />
        <select v-model="unit" class="dur__unit" aria-label="Unit">
            <option value="sec">sec</option>
            <option value="min">min</option>
            <option value="hr">hr</option>
        </select>
    </div>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue';

// Stored in seconds, edited as number + unit so people don't type raw seconds.
const model = defineModel<number>({default: 0});

const UNITS = {sec: 1, min: 60, hr: 3600} as const;
type Unit = keyof typeof UNITS;

const num = ref(0);
const unit = ref<Unit>('sec');

// Guard so emitting our own value doesn't bounce back and reset the unit.
let emitting = false;

function fromSeconds(sec: number): void {
    if (sec > 0 && sec % 3600 === 0) {
        unit.value = 'hr';
        num.value = sec / 3600;
    } else if (sec > 0 && sec % 60 === 0) {
        unit.value = 'min';
        num.value = sec / 60;
    } else {
        unit.value = 'sec';
        num.value = sec;
    }
}

fromSeconds(model.value ?? 0);

watch(model, (v) => {
    if (emitting) {
        emitting = false;
        return;
    }
    fromSeconds(v ?? 0);
});

watch([num, unit], () => {
    emitting = true;
    model.value = Math.max(
        0,
        Math.round((Number(num.value) || 0) * UNITS[unit.value])
    );
});
</script>

<style scoped>
.dur {
    display: inline-flex;
    align-items: center;
    background-color: var(--input-bg, var(--color-surface-1));
    border: 1px solid var(--input-border, var(--color-border-strong));
    border-radius: var(--radius-lg);
    min-height: var(--touch-target-min);
    overflow: hidden;
    transition:
        border-color var(--motion-hover),
        box-shadow var(--motion-state);
}
.dur:focus-within {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent);
}
.dur__num {
    width: var(--space-12);
    border: none;
    background: transparent;
    outline: none;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    padding: 0 var(--space-2);
    text-align: right;
}
.dur__num::-webkit-inner-spin-button,
.dur__num::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.dur__unit {
    height: 100%;
    border: none;
    border-left: 1px solid var(--input-border, var(--color-border-strong));
    background: transparent;
    outline: none;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    padding: 0 var(--space-2);
    cursor: pointer;
}
</style>
