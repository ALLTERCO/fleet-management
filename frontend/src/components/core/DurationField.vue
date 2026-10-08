<template>
    <!-- One cohesive field: number + unit share a single border. -->
    <div class="dur">
        <input
            v-model.number="num"
            type="number"
            :min="0"
            :max="maxInUnit"
            step="any"
            class="dur__num"
            aria-label="Amount"
            @input="pushValue"
        />
        <select
            :value="unit"
            class="dur__unit"
            aria-label="Unit"
            @change="changeUnit"
        >
            <option value="sec">sec</option>
            <option value="min">min</option>
            <option value="hr">hr</option>
        </select>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';

// Stored in seconds, edited as number + unit so people don't type raw seconds.
//
// The dropdown is a lens, not a multiplier. Switching sec → min re-expresses
// the same duration; it does not reinterpret the number. It used to do the
// latter, so clicking through sec → min → hr on "90" walked the value from
// 90 seconds to 90 hours, one silent 60x at a time.
const model = defineModel<number>({default: 0});

const props = defineProps<{
    /** Upper bound in seconds, from the field's schema. */
    max?: number;
}>();

const UNITS = {sec: 1, min: 60, hr: 3600} as const;
type Unit = keyof typeof UNITS;

const num = ref(0);
const unit = ref<Unit>('sec');

// The value we last wrote, so our own echo does not reset the unit the user
// just picked. A boolean latch could stay armed when the emitted value
// happened to equal the current one, and then swallow the next real write.
let lastPushed: number | null = null;

const maxInUnit = computed(() =>
    props.max === undefined ? undefined : props.max / UNITS[unit.value]
);

/** The largest unit that divides cleanly, so 3600 reads "1 hr" not "3600 sec". */
function showSeconds(seconds: number): void {
    if (seconds > 0 && seconds % 3600 === 0) {
        unit.value = 'hr';
        num.value = seconds / 3600;
        return;
    }
    if (seconds > 0 && seconds % 60 === 0) {
        unit.value = 'min';
        num.value = seconds / 60;
        return;
    }
    unit.value = 'sec';
    num.value = seconds;
}

function clamp(seconds: number): number {
    const floored = Math.max(0, seconds);
    return props.max === undefined ? floored : Math.min(floored, props.max);
}

function push(seconds: number): void {
    const next = clamp(seconds);
    lastPushed = next;
    model.value = next;
}

/** Typing sets the duration in whatever unit is showing. */
function pushValue(): void {
    push(Math.round((Number(num.value) || 0) * UNITS[unit.value]));
}

/** Changing the unit keeps the duration and restates it. */
function changeUnit(event: Event): void {
    const next = (event.target as HTMLSelectElement).value as Unit;
    unit.value = next;
    num.value = round4(model.value / UNITS[next]);
}

// Trailing zeros a float division leaves behind read as noise in a text box.
function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}

showSeconds(model.value ?? 0);

watch(model, (value) => {
    const next = value ?? 0;
    if (next === lastPushed) return;
    lastPushed = null;
    showSeconds(next);
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
