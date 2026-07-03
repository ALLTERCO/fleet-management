<template>
    <div class="qhs">
        <button
            v-if="!open"
            type="button"
            class="qhs__chip"
            :class="empty ? 'qhs__chip--empty' : 'qhs__chip--filled'"
            @click="expand"
        >
            <i
                class="fa-solid"
                :class="empty ? 'fa-circle-plus' : 'fa-moon'"
                aria-hidden="true"
            />
            <span>{{ chipLabel }}</span>
            <i
                v-if="!empty"
                class="fa-solid fa-chevron-right qhs__chip-chevron"
                aria-hidden="true"
            />
        </button>

        <div v-else class="qhs__form">
            <div class="qhs__form-row">
                <label class="qhs__field">
                    <span class="qhs__label">Start hour</span>
                    <input
                        :value="form.start"
                        type="number"
                        min="0"
                        max="23"
                        autocomplete="off"
                        class="qhs__input"
                        @input="onStart"
                    />
                </label>
                <label class="qhs__field">
                    <span class="qhs__label">End hour</span>
                    <input
                        :value="form.end"
                        type="number"
                        min="0"
                        max="23"
                        autocomplete="off"
                        class="qhs__input"
                        @input="onEnd"
                    />
                </label>
                <label class="qhs__field qhs__field--wide">
                    <span class="qhs__label">Timezone</span>
                    <input
                        :value="form.timezone"
                        type="text"
                        placeholder="Europe/Sofia"
                        autocomplete="off"
                        class="qhs__input"
                        @input="onTimezone"
                    />
                </label>
            </div>
            <div class="qhs__actions">
                <button
                    v-if="!empty"
                    type="button"
                    class="qhs__clear"
                    @click="clearAll"
                >
                    Clear
                </button>
                <button type="button" class="qhs__collapse" @click="collapse">
                    Done
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';

export interface QuietHoursForm {
    start: string;
    end: string;
    timezone: string;
}

const form = defineModel<QuietHoursForm>({
    default: () => ({start: '', end: '', timezone: ''})
});

const open = ref(false);

const empty = computed(() =>
    isEmptyForm(form.value)
);

const chipLabel = computed(() =>
    empty.value ? 'Add quiet hours' : describeForm(form.value)
);

function isEmptyForm(value: QuietHoursForm): boolean {
    return (
        value.start.trim() === '' &&
        value.end.trim() === '' &&
        value.timezone.trim() === ''
    );
}

function describeForm(value: QuietHoursForm): string {
    const start = formatHour(value.start);
    const end = formatHour(value.end);
    const tz = value.timezone.trim() || 'UTC';
    if (!start || !end) return `Quiet hours · ${tz}`;
    return `Quiet ${start}–${end} · ${tz}`;
}

function formatHour(raw: string): string {
    const hour = Number(raw);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '';
    return `${String(hour).padStart(2, '0')}:00`;
}

function patchForm(patch: Partial<QuietHoursForm>): void {
    form.value = {...form.value, ...patch};
}

function onStart(event: Event): void {
    patchForm({start: readInput(event)});
}

function onEnd(event: Event): void {
    patchForm({end: readInput(event)});
}

function onTimezone(event: Event): void {
    patchForm({timezone: readInput(event)});
}

function readInput(event: Event): string {
    return (event.target as HTMLInputElement).value;
}

function clearAll(): void {
    form.value = {start: '', end: '', timezone: ''};
}

function expand(): void {
    open.value = true;
}

function collapse(): void {
    open.value = false;
}
</script>

<style scoped>
.qhs {
    width: 100%;
}

.qhs__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-surface-2);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-out-expo);
}

.qhs__chip:hover {
    border-color: var(--color-primary);
    color: var(--color-text-primary);
}

.qhs__chip--filled {
    border-style: solid;
    background-color: color-mix(in srgb, var(--color-primary) 8%, transparent);
    color: var(--color-text-primary);
}

.qhs__chip-chevron {
    margin-left: var(--space-2);
    font-size: 0.7em;
    opacity: 0.6;
}

.qhs__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
}

.qhs__form-row {
    display: grid;
    grid-template-columns: 1fr 1fr 2fr;
    gap: var(--space-3);
}

.qhs__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.qhs__label {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}

.qhs__input {
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}

.qhs__input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent);
}

.qhs__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}

.qhs__clear,
.qhs__collapse {
    padding: var(--space-1-5) var(--space-3);
    background: transparent;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    cursor: pointer;
}

.qhs__collapse {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-on-primary);
}

@media (max-width: 480px) {
    .qhs__form-row {
        grid-template-columns: 1fr 1fr;
    }

    .qhs__field--wide {
        grid-column: span 2;
    }
}
</style>
