<template>
    <div class="ohg">
        <div class="ohg__head">
            <label class="ohg__24-7">
                <input
                    type="checkbox"
                    :checked="is24x7"
                    @change="toggle24x7(($event.target as HTMLInputElement).checked)"
                />
                <span>Open 24/7</span>
            </label>
            <span class="ohg__tz" :title="timezone || 'No timezone set'">
                <i class="fas fa-globe" aria-hidden="true" />
                {{ timezone || 'Local time' }}
            </span>
        </div>
        <ul v-if="!is24x7" class="ohg__list" role="list">
            <li v-for="day in DAYS" :key="day.key" class="ohg__row-wrap">
                <div class="ohg__row">
                    <span class="ohg__day">{{ day.label }}</span>
                    <label class="ohg__closed">
                        <input
                            type="checkbox"
                            :checked="isClosed(day.key)"
                            @change="toggleClosed(day.key, ($event.target as HTMLInputElement).checked)"
                        />
                        Closed
                    </label>
                    <template v-if="!isClosed(day.key)">
                        <input
                            type="time"
                            class="ohg__time"
                            :value="dayOpen(day.key)"
                            @change="setTime({day: day.key, field: 'open', time: ($event.target as HTMLInputElement).value})"
                        />
                        <span class="ohg__sep">–</span>
                        <input
                            type="time"
                            class="ohg__time"
                            :value="dayClose(day.key)"
                            @change="setTime({day: day.key, field: 'close', time: ($event.target as HTMLInputElement).value})"
                        />
                    </template>
                    <button
                        v-if="!isClosed(day.key) && copyableFrom(day.key)"
                        type="button"
                        class="ohg__copy"
                        :title="`Copy ${copyableFrom(day.key)?.label} to ${day.label}`"
                        @click="copyFromPrev(day.key)"
                    >
                        <i class="fas fa-arrow-up" aria-hidden="true" />
                    </button>
                </div>
                <p v-if="dayError(day.key)" class="ohg__error">{{ dayError(day.key) }}</p>
                <p v-else-if="dayIsOvernight(day.key)" class="ohg__hint">
                    Crosses midnight
                </p>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {
    clear247,
    closeDay,
    copyPreviousDayHours,
    DAY_ORDER,
    type DayHours,
    type DayKey,
    dayHoursErrorMessage,
    isDayClosed,
    isOvernightShift,
    type OperatingHoursValue,
    openDayWithDefaults,
    previousDay,
    readCloseTime,
    readDayHours,
    readOpenTime,
    setDayTime,
    setOpen247
} from '@/helpers/operating-hours';

export type {DayHours, OperatingHoursValue} from '@/helpers/operating-hours';

const props = defineProps<{
    modelValue: OperatingHoursValue | null | undefined;
    timezone?: string;
}>();
const emit = defineEmits<{
    'update:modelValue': [OperatingHoursValue | null];
}>();

// All template lookups go through the value snapshot — keeps the template
// reactive without each helper reading props directly.
const value = computed<OperatingHoursValue>(() => props.modelValue ?? {});
const is24x7 = computed(() => value.value.twentyFourSeven === true);
const DAYS = DAY_ORDER;

// ── Answer helpers (template reads) ───────────────────────────────────
function isClosed(d: DayKey): boolean {
    return isDayClosed(value.value, d);
}
function dayOpen(d: DayKey): string {
    return readOpenTime(value.value, d);
}
function dayClose(d: DayKey): string {
    return readCloseTime(value.value, d);
}
function copyableFrom(d: DayKey): {key: DayKey; label: string} | null {
    const prev = previousDay(d);
    if (!prev) return null;
    if (!readDayHours(value.value, prev)) return null;
    return DAY_ORDER.find((x) => x.key === prev) ?? null;
}

// Answer — per-day validation message, or '' if the row is fine.
function dayError(d: DayKey): string {
    const hours = readDayHours(value.value, d);
    if (!hours) return '';
    return dayHoursErrorMessage(hours);
}

// Answer — does this day's window cross midnight (close < open)?
function dayIsOvernight(d: DayKey): boolean {
    const hours = readDayHours(value.value, d);
    if (!hours) return false;
    return isOvernightShift(hours);
}

// ── Do helpers (events out) ───────────────────────────────────────────
function toggle24x7(on: boolean): void {
    emit('update:modelValue', on ? setOpen247() : clear247());
}
function toggleClosed(d: DayKey, closed: boolean): void {
    emit(
        'update:modelValue',
        closed ? closeDay(value.value, d) : openDayWithDefaults(value.value, d)
    );
}
function setTime(args: {day: DayKey; field: 'open' | 'close'; time: string}): void {
    emit('update:modelValue', setDayTime(value.value, args));
}
function copyFromPrev(d: DayKey): void {
    emit('update:modelValue', copyPreviousDayHours(value.value, d));
}
</script>

<style scoped>
.ohg {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.ohg__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}
.ohg__24-7 {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
}
.ohg__24-7 input {
    accent-color: var(--color-primary);
}
.ohg__tz {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.ohg__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-radius: var(--radius-lg);
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(0, 0, 0, 0.22);
}
.ohg__row {
    display: grid;
    grid-template-columns: 100px auto 1fr auto 1fr auto;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: rgba(255, 255, 255, 0.02);
}
.ohg__day {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.ohg__closed {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    cursor: pointer;
}
.ohg__closed input {
    accent-color: var(--color-primary);
}
.ohg__time {
    appearance: none;
    background: rgba(0, 0, 0, 0.32);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--type-caption);
    padding: var(--space-1) var(--space-2);
    color-scheme: dark;
}
.ohg__sep {
    color: var(--color-text-tertiary);
}
.ohg__copy {
    appearance: none;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: 4px 8px;
}
.ohg__copy:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--color-text-primary);
}
.ohg__row-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.ohg__error {
    margin: 0;
    padding: 2px var(--space-3) var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-danger-text);
}
.ohg__hint {
    margin: 0;
    padding: 2px var(--space-3) var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
</style>
