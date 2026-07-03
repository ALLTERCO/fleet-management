<template>
    <div class="ov-hours" role="list">
        <div
            v-for="d in days"
            :key="d.key"
            role="listitem"
            class="ov-hours__day"
            :class="{'ov-hours__day--closed': d.closed}"
            :title="d.tooltip"
        >
            <span class="ov-hours__abbr">{{ d.abbr }}</span>
            <span class="ov-hours__range">{{ d.range }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

interface WeekdayWindow {
    open?: string;
    close?: string;
    closed?: boolean;
}

const props = defineProps<{
    hours: Readonly<Record<string, unknown>> | null | undefined;
}>();

const DAY_ORDER: ReadonlyArray<{key: string; abbr: string; label: string}> = [
    {key: 'monday', abbr: 'Mon', label: 'Monday'},
    {key: 'tuesday', abbr: 'Tue', label: 'Tuesday'},
    {key: 'wednesday', abbr: 'Wed', label: 'Wednesday'},
    {key: 'thursday', abbr: 'Thu', label: 'Thursday'},
    {key: 'friday', abbr: 'Fri', label: 'Friday'},
    {key: 'saturday', abbr: 'Sat', label: 'Saturday'},
    {key: 'sunday', abbr: 'Sun', label: 'Sunday'}
];

function readWindow(raw: unknown): WeekdayWindow | null {
    if (!raw || typeof raw !== 'object') return null;
    return raw as WeekdayWindow;
}

const days = computed(() =>
    DAY_ORDER.map((d) => {
        const w = readWindow(props.hours?.[d.key]);
        const closed = w?.closed === true || !w?.open || !w?.close;
        const range = closed ? '—' : `${w.open}–${w.close}`;
        const tooltip = closed ? `${d.label}: closed` : `${d.label}: ${range}`;
        return {key: d.key, abbr: d.abbr, range, closed, tooltip};
    })
);
</script>

<style scoped>
.ov-hours {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: var(--space-1);
}

.ov-hours__day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-0-5);
    padding: var(--space-2) var(--space-1);
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
    min-width: 0;
}

.ov-hours__abbr {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    letter-spacing: 0.03em;
    text-transform: uppercase;
}

.ov-hours__range {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
}

.ov-hours__day--closed .ov-hours__range {
    color: var(--color-text-quaternary);
}
</style>
