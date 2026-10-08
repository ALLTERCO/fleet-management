<template>
    <div class="lfc">
        <div v-if="rows.length === 0" class="lfc__empty">
            No custom settings on this location.
        </div>

        <div v-for="(row, index) in rows" :key="row.id" class="lfc__row">
            <div class="lfc__cell">
                <Input
                    :model-value="row.key"
                    label="Setting name"
                    label-hidden
                    placeholder="poolPhMin"
                    :error="keyError(index)"
                    @update:model-value="setKey(index, String($event))"
                />
            </div>
            <div class="lfc__cell">
                <Input
                    :model-value="row.value"
                    label="Value"
                    label-hidden
                    placeholder="7.2"
                    @update:model-value="setValue(index, String($event))"
                />
            </div>
            <button
                type="button"
                class="lfc__remove"
                :aria-label="`Remove ${row.key || 'setting'}`"
                @click="removeRow(index)"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </div>

        <p v-for="warning in pairWarnings" :key="warning" class="lfc__warning">
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            <span>{{ warning }}</span>
        </p>

        <div class="lfc__foot">
            <Button
                type="blue-hollow"
                size="sm"
                :disabled="atCeiling"
                @click="addRow"
            >
                Add setting
            </Button>
            <span v-if="max !== undefined" class="lfc__count">
                {{ rows.length }} of {{ max }}
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';

/** What the location schema accepts for a custom setting. */
export type LocationCustomFieldValue = string | number | boolean | null;
export type LocationCustomFieldsValue = Record<string, LocationCustomFieldValue>;

interface Row {
    /** Stable across reorders so an input does not lose focus mid-edit. */
    id: number;
    key: string;
    value: string;
}

const props = defineProps<{
    modelValue: LocationCustomFieldsValue | null | undefined;
    /** Ceiling from the field descriptor, so the form and the schema that
     * rejects the save agree without either restating the number. */
    max?: number;
}>();
const emit = defineEmits<{
    'update:modelValue': [LocationCustomFieldsValue | null];
}>();

let nextId = 0;
const rows = ref<Row[]>([]);

const atCeiling = computed(
    () => props.max !== undefined && rows.value.length >= props.max
);

// Rows are the edit state; the map is derived. Editing a map directly loses a
// half-typed key the moment it is blank, and reorders as keys change.
watch(
    () => props.modelValue,
    (incoming) => {
        if (sameAsRows(incoming)) return;
        rows.value = Object.entries(incoming ?? {}).map(([key, value]) => ({
            id: nextId++,
            key,
            value: value === null ? '' : String(value)
        }));
    },
    {immediate: true}
);

function sameAsRows(
    incoming: LocationCustomFieldsValue | null | undefined
): boolean {
    return JSON.stringify(incoming ?? {}) === JSON.stringify(toMap());
}

/**
 * Text to stored value, by exact round trip: a value is a number only when
 * printing that number gives back what was typed. So `7.5` is stored as a
 * number and a leading-zero code like `01234` stays the text it was, instead
 * of being quietly renumbered.
 */
function parseValue(raw: string): LocationCustomFieldValue {
    const text = raw.trim();
    if (text === '') return null;
    if (text === 'true') return true;
    if (text === 'false') return false;
    const asNumber = Number(text);
    return Number.isFinite(asNumber) && String(asNumber) === text
        ? asNumber
        : text;
}

function toMap(): LocationCustomFieldsValue {
    const map: LocationCustomFieldsValue = {};
    rows.value.forEach((row, index) => {
        const key = row.key.trim();
        // A blank key is a row still being typed, and a duplicate is flagged
        // on its own row — neither may overwrite a setting that is already
        // there, so both stay out of the saved map.
        if (!key || keyError(index)) return;
        map[key] = parseValue(row.value);
    });
    return map;
}

function publish(): void {
    const map = toMap();
    emit('update:modelValue', Object.keys(map).length > 0 ? map : null);
}

function keyError(index: number): string | undefined {
    const key = rows.value[index].key.trim();
    if (!key) return undefined;
    const firstIndex = rows.value.findIndex(
        (row) => row.key.trim() === key
    );
    return firstIndex === index ? undefined : 'Already used above.';
}

function setKey(index: number, key: string): void {
    rows.value[index].key = key;
    publish();
}

function setValue(index: number, value: string): void {
    rows.value[index].value = value;
    publish();
}

function addRow(): void {
    if (atCeiling.value) return;
    rows.value.push({id: nextId++, key: '', value: ''});
}

function removeRow(index: number): void {
    rows.value.splice(index, 1);
    publish();
}

/**
 * A limit with only one end is not a band. `{min: absent, max: 7.5}` passes
 * every reading below 7.5, and for something like pool pH the missing lower
 * end is the dangerous one, so the gap is named rather than left to be noticed.
 */
const pairWarnings = computed<string[]>(() => {
    const filled = new Set(
        rows.value
            .filter((row) => row.key.trim() && row.value.trim())
            .map((row) => row.key.trim())
    );
    const warnings: string[] = [];
    for (const key of filled) {
        const partner = key.endsWith('Min')
            ? `${key.slice(0, -3)}Max`
            : key.endsWith('Max')
              ? `${key.slice(0, -3)}Min`
              : null;
        if (partner && !filled.has(partner) && !warnings.includes(partner)) {
            warnings.push(partner);
        }
    }
    return warnings.map(
        (partner) => `${partner} is not set, so this range has only one end.`
    );
});
</script>

<style scoped>
.lfc {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.lfc__empty {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
}
/* Name and value carry equal weight; the remove control is sized to the touch
   target so it never becomes the smallest thing in the row. */
.lfc__row {
    display: grid;
    grid-template-columns: 1fr 1fr var(--touch-target-min);
    align-items: start;
    gap: var(--space-2);
}
.lfc__cell {
    min-width: 0;
}
.lfc__remove {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-md);
    background: transparent;
    border: 1px solid var(--color-border-subtle);
    color: var(--color-danger-text);
    cursor: pointer;
    font-size: var(--type-caption);
    transition: background-color var(--duration-quick) var(--ease-default);
}
.lfc__remove:hover {
    background-color: var(--color-surface-2);
}
.lfc__remove:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.lfc__remove:active {
    transform: scale(var(--press-scale));
}
.lfc__remove:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
}
.lfc__warning {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-warning-text);
}
.lfc__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}
.lfc__count {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}
@media (max-width: 640px) {
    .lfc__row {
        grid-template-columns: 1fr var(--touch-target-min);
    }
}
</style>
