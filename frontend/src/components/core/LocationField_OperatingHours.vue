<template>
    <div class="lfh">
        <div v-for="day in WEEKDAYS" :key="day.key" class="lfh__day">
            <label class="lfh__day-label">{{ day.label }}</label>
            <label class="lfh__closed">
                <input type="checkbox" :checked="isClosed(day.key)"
                    @change="setClosed(day.key, ($event.target as HTMLInputElement).checked)" />
                Closed
            </label>
            <template v-if="!isClosed(day.key)">
                <Input :model-value="openOf(day.key)" placeholder="09:00"
                    @update:model-value="setWindow(day.key, 'open', String($event))" />
                <span class="lfh__sep">–</span>
                <Input :model-value="closeOf(day.key)" placeholder="18:00"
                    @update:model-value="setWindow(day.key, 'close', String($event))" />
            </template>
        </div>
        <div class="lfh__tz">
            <label class="lfh__day-label">Time zone (optional)</label>
            <Input :model-value="value.timezone ?? ''" placeholder="Europe/Sofia"
                @update:model-value="updateTimezone(String($event))" />
            <p class="lfh__tz-hint">
                Leave empty to use the location's time zone. Set a value here
                only when these hours follow a different zone (e.g. seasonal
                or remote-office schedule).
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Input from '@/components/core/Input.vue';

export type LocationWeekday =
    | 'monday'
    | 'tuesday'
    | 'wednesday'
    | 'thursday'
    | 'friday'
    | 'saturday'
    | 'sunday';

export interface LocationHoursWindow {
    open?: string;
    close?: string;
    closed?: boolean;
}
export type LocationOperatingHoursValue = Partial<
    Record<LocationWeekday, LocationHoursWindow>
> & {timezone?: string};

const WEEKDAYS: {key: LocationWeekday; label: string}[] = [
    {key: 'monday', label: 'Mon'},
    {key: 'tuesday', label: 'Tue'},
    {key: 'wednesday', label: 'Wed'},
    {key: 'thursday', label: 'Thu'},
    {key: 'friday', label: 'Fri'},
    {key: 'saturday', label: 'Sat'},
    {key: 'sunday', label: 'Sun'}
];

const props = defineProps<{
    modelValue: LocationOperatingHoursValue | null | undefined;
}>();
const emit = defineEmits<{
    'update:modelValue': [LocationOperatingHoursValue | null];
}>();

const value = computed<LocationOperatingHoursValue>(
    () => props.modelValue ?? {}
);

function windowOf(day: LocationWeekday): LocationHoursWindow {
    return value.value[day] ?? {};
}
function isClosed(day: LocationWeekday): boolean {
    return !!windowOf(day).closed;
}
function openOf(day: LocationWeekday): string {
    return windowOf(day).open ?? '';
}
function closeOf(day: LocationWeekday): string {
    return windowOf(day).close ?? '';
}

function setClosed(day: LocationWeekday, closed: boolean) {
    const next: LocationOperatingHoursValue = {...value.value};
    if (closed) next[day] = {closed: true};
    else delete next[day];
    emitNormalized(next);
}

function setWindow(day: LocationWeekday, field: 'open' | 'close', raw: string) {
    const next: LocationOperatingHoursValue = {...value.value};
    const current = {...(next[day] ?? {})};
    if (raw) current[field] = raw;
    else delete current[field];
    delete current.closed;
    if (Object.keys(current).length > 0) next[day] = current;
    else delete next[day];
    emitNormalized(next);
}

function updateTimezone(raw: string) {
    const next: LocationOperatingHoursValue = {...value.value};
    if (raw) next.timezone = raw;
    else delete next.timezone;
    emitNormalized(next);
}

function emitNormalized(next: LocationOperatingHoursValue) {
    const hasAny = Object.keys(next).length > 0;
    emit('update:modelValue', hasAny ? next : null);
}
</script>

<style scoped>
.lfh { display: flex; flex-direction: column; gap: var(--space-2); }
.lfh__day {
    display: grid;
    grid-template-columns: 60px auto 1fr auto 1fr;
    align-items: center;
    gap: var(--space-2);
}
.lfh__day-label { font-size: var(--type-body); font-weight: 600; color: var(--color-text-primary); }
.lfh__closed {
    display: inline-flex; align-items: center; gap: var(--space-1);
    font-size: var(--type-body); color: var(--color-text-secondary); cursor: pointer;
}
.lfh__sep { color: var(--color-text-tertiary); text-align: center; }
.lfh__tz { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-2); }
.lfh__tz-hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
@media (max-width: 640px) {
    .lfh__day { grid-template-columns: 60px 1fr; grid-auto-rows: auto; }
    .lfh__sep { display: none; }
}
</style>
