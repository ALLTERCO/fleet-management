<template>
    <div class="gmf">
        <!-- Incompatible-fields warning: when the active kind is strict
             (additionalProperties:false) and there are metadata keys it
             doesn't recognize (e.g., after switching kind), make them
             visible AND offer to drop them. Auto-prune would be silent
             data loss. -->
        <div v-if="invisibleFields.length > 0" class="gmf__warn">
            <div class="gmf__warn-hdr">
                <i class="fas fa-triangle-exclamation gmf__warn-icon" aria-hidden="true" />
                <span class="gmf__warn-title">
                    {{ invisibleFields.length }}
                    {{ invisibleFields.length === 1 ? 'field is' : 'fields are' }}
                    not supported by this kind
                </span>
                <button
                    type="button"
                    class="gmf__warn-drop"
                    @click="dropInvisibleFields"
                >
                    Drop them
                </button>
            </div>
            <div class="gmf__warn-list">
                <span
                    v-for="entry in invisibleFields"
                    :key="entry.key"
                    class="gmf__warn-chip"
                    :title="`${entry.key}: ${entry.preview}`"
                >
                    {{ entry.key }} = {{ entry.preview }}
                </span>
            </div>
            <p class="gmf__warn-hint">
                Saving as-is will be rejected by the backend.
                Keep them by switching back to the previous kind, or remove
                them with the button above.
            </p>
        </div>

        <!-- Typed fields from the kind's metadataSchema.properties -->
        <div v-if="typedFields.length > 0" class="gmf__typed">
            <div v-for="field in typedFields" :key="field.key" class="gmf__field">
                <label class="gmf__label">
                    {{ field.label }}
                    <span v-if="field.hint" class="gmf__hint-inline">{{ field.hint }}</span>
                </label>

                <!-- enum → dropdown -->
                <select
                    v-if="field.kind === 'enum'"
                    :value="String(modelValue[field.key] ?? '')"
                    class="gmf__select"
                    @change="setField(field.key, ($event.target as HTMLSelectElement).value || undefined)"
                >
                    <option value="">— none —</option>
                    <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
                </select>

                <!-- boolean → checkbox -->
                <label v-else-if="field.kind === 'boolean'" class="gmf__checkbox">
                    <input
                        type="checkbox"
                        :checked="modelValue[field.key] === true"
                        @change="setField(field.key, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>Yes</span>
                </label>

                <!-- bounded-integer array → toggle group (chips) -->
                <div
                    v-else-if="field.kind === 'array-int-bounded'"
                    class="gmf__chips"
                >
                    <button
                        v-for="opt in field.intOptions"
                        :key="opt.value"
                        type="button"
                        class="gmf__chip"
                        :class="{'gmf__chip--on': isInArray(field, opt.value)}"
                        @click="toggleArrayMember(field, opt.value)"
                    >
                        {{ opt.label }}
                    </button>
                </div>

                <!-- generic array → comma-separated text input -->
                <div v-else-if="field.kind === 'array'" class="gmf__field-stack">
                    <input
                        type="text"
                        class="gmf__input"
                        :value="arrayAsCsv(field)"
                        :placeholder="field.placeholder || 'comma-separated values'"
                        @input="commitArrayCsvField(field, ($event.target as HTMLInputElement).value)"
                    />
                    <span class="gmf__hint-inline">comma-separated</span>
                </div>

                <!-- number / integer → numeric input -->
                <div
                    v-else-if="field.kind === 'number' || field.kind === 'integer'"
                    class="gmf__field-stack"
                >
                    <input
                        type="number"
                        class="gmf__input"
                        :value="modelValue[field.key] ?? ''"
                        :min="field.minimum ?? undefined"
                        :max="field.maximum ?? undefined"
                        :step="field.kind === 'integer' ? 1 : 'any'"
                        :placeholder="field.placeholder"
                        @input="commitNumericField(field, ($event.target as HTMLInputElement).value)"
                    />
                    <p
                        v-if="numericError[field.key]"
                        class="gmf__error"
                    >{{ numericError[field.key] }}</p>
                </div>

                <!-- date / date-time → native picker -->
                <input
                    v-else-if="field.kind === 'date'"
                    type="date"
                    class="gmf__input"
                    :value="String(modelValue[field.key] ?? '')"
                    @input="setField(field.key, ($event.target as HTMLInputElement).value || undefined)"
                />
                <input
                    v-else-if="field.kind === 'datetime'"
                    type="datetime-local"
                    class="gmf__input"
                    :value="String(modelValue[field.key] ?? '')"
                    @input="setField(field.key, ($event.target as HTMLInputElement).value || undefined)"
                />

                <!-- string (default) → text input -->
                <input
                    v-else
                    type="text"
                    class="gmf__input"
                    :value="String(modelValue[field.key] ?? '')"
                    :maxlength="field.maxLength ?? undefined"
                    :pattern="field.pattern ?? undefined"
                    :placeholder="field.placeholder"
                    @input="setField(field.key, ($event.target as HTMLInputElement).value || undefined)"
                />
            </div>
        </div>

        <!-- Extra freeform rows: permissive kinds (manual) or kinds that
             allow additional properties get the key-value editor below the
             typed fields. -->
        <div v-if="allowExtras" class="gmf__extras">
            <div v-if="typedFields.length > 0" class="gmf__extras-hdr">
                Additional fields
            </div>
            <div v-if="extraRows.length > 0" class="gmf__rows">
                <div v-for="(row, idx) in extraRows" :key="idx" class="gmf__row">
                    <input
                        v-model="row.key"
                        type="text"
                        class="gmf__input gmf__input--narrow"
                        placeholder="Key"
                        :maxlength="META_KEY_MAX"
                        @input="syncExtras"
                        @blur="syncExtras"
                    />
                    <input
                        v-model="row.value"
                        type="text"
                        class="gmf__input"
                        placeholder="Value"
                        :maxlength="META_VALUE_MAX"
                        @input="syncExtras"
                        @blur="syncExtras"
                    />
                    <button
                        type="button"
                        class="gmf__row-remove"
                        title="Remove"
                        @click="removeExtra(idx)"
                    >
                        <i class="fas fa-xmark" aria-hidden="true" />
                    </button>
                </div>
            </div>
            <button type="button" class="gmf__add" @click="addExtra">
                <i class="fas fa-plus" aria-hidden="true" /> Add field
            </button>
            <p v-if="duplicateExtraKey" class="gmf__error">
                Key "{{ duplicateExtraKey }}" appears twice — last entry wins.
            </p>
        </div>

        <p v-if="empty" class="gmf__empty">
            This kind has no structured metadata fields.
        </p>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import type {GroupKind} from '@/composables/useGroupKinds';
import {isReservedMetadataKey} from '@/helpers/groupMetadataKeys';
import {
    parseCsvArrayInput,
    parseNumericInput
} from '@/helpers/groupMetadataParse';

const META_KEY_MAX = 32;
const META_VALUE_MAX = 128;
// Chip label cap for the invisible-fields warning. Long enough to give
// useful preview, short enough to fit several chips on one row.
const PREVIEW_CHIP_MAX_LEN = 32;
const PREVIEW_CHIP_ELLIPSIS_AT = PREVIEW_CHIP_MAX_LEN - 3;

function truncateForChip(s: string): string {
    return s.length > PREVIEW_CHIP_MAX_LEN
        ? `${s.slice(0, PREVIEW_CHIP_ELLIPSIS_AT)}…`
        : s;
}

// ── Props / model ──

const props = defineProps<{
    /** Selected kind. Null = no kind picked yet (typed fields hidden). */
    kind: GroupKind | null;
}>();

const modelValue = defineModel<Record<string, unknown>>({
    default: () => ({})
});

// Surfaces a single boolean for the parent's Save-button gate. Set whenever
// the form holds state the user must resolve before save can succeed
// (invisible-fields warning, duplicate extras key). Backend would otherwise
// reject the save with a cryptic InvalidParams.
const emit = defineEmits<{
    'update:invalid': [hasInvalid: boolean];
}>();

// ── Schema interpretation ──

type FieldKind =
    | 'string'
    | 'enum'
    | 'date'
    | 'datetime'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'array'
    | 'array-int-bounded';

interface IntOption {
    value: number;
    label: string;
}

interface TypedField {
    key: string;
    label: string;
    kind: FieldKind;
    options?: readonly string[];
    minimum?: number;
    maximum?: number;
    maxLength?: number;
    pattern?: string;
    placeholder?: string;
    hint?: string;
    // array-specific
    itemType?: 'string' | 'integer' | 'number';
    intOptions?: readonly IntOption[];
    maxItems?: number;
}

interface RawProp {
    type?: string;
    enum?: readonly string[];
    format?: string;
    minimum?: number;
    maximum?: number;
    maxLength?: number;
    pattern?: string;
    items?: {type?: string; minimum?: number; maximum?: number};
    maxItems?: number;
}

// Inclusive integer-range threshold for the chip-toggle UX. Above this
// many options the chip layout gets unwieldy — fall back to comma-csv.
const BOUNDED_INT_ARRAY_MAX_RANGE = 10;

function classify(prop: RawProp): FieldKind {
    if (Array.isArray(prop.enum) && prop.enum.length > 0) return 'enum';
    switch (prop.type) {
        case 'boolean':
            return 'boolean';
        case 'integer':
            return 'integer';
        case 'number':
            return 'number';
        case 'array': {
            const items = prop.items;
            if (
                items?.type === 'integer' &&
                typeof items.minimum === 'number' &&
                typeof items.maximum === 'number' &&
                items.maximum - items.minimum < BOUNDED_INT_ARRAY_MAX_RANGE
            ) {
                return 'array-int-bounded';
            }
            return 'array';
        }
        case 'string':
            if (prop.format === 'date') return 'date';
            if (prop.format === 'date-time') return 'datetime';
            return 'string';
        default:
            return 'string';
    }
}

// kebab/snake_case → "Kebab Case" for human-friendly labels.
function labelFor(key: string): string {
    return key
        .split(/[_-]/)
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
        .join(' ');
}

function hintFor(prop: RawProp): string {
    const parts: string[] = [];
    if (prop.minimum != null) parts.push(`min ${prop.minimum}`);
    if (prop.maximum != null) parts.push(`max ${prop.maximum}`);
    if (prop.maxLength != null) parts.push(`≤${prop.maxLength} chars`);
    if (prop.pattern) parts.push(`pattern: ${prop.pattern}`);
    if (prop.maxItems != null) parts.push(`max ${prop.maxItems} items`);
    return parts.join(' · ');
}

// Build the chip-toggle options for bounded integer arrays. Special-cases
// `days_of_week` (0..6) into Mon-Sun labels; falls back to numeric labels.
function buildIntOptions(key: string, prop: RawProp): IntOption[] {
    const items = prop.items;
    if (!items || items.minimum == null || items.maximum == null) return [];
    const min = items.minimum;
    const max = items.maximum;
    const isDaysOfWeek = key === 'days_of_week' && min === 0 && max === 6;
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const out: IntOption[] = [];
    for (let i = min; i <= max; i++) {
        const label = isDaysOfWeek ? dayLabels[i] : String(i);
        out.push({value: i, label});
    }
    return out;
}

function placeholderFor(prop: RawProp, kind: FieldKind): string {
    if (kind === 'integer' || kind === 'number') {
        return prop.minimum != null ? `≥ ${prop.minimum}` : '';
    }
    if (kind === 'string' && prop.pattern) return prop.pattern;
    return '';
}

const typedFields = computed<TypedField[]>(() => {
    const schema = props.kind?.metadataSchema as {
        properties?: Record<string, RawProp>;
    } | undefined;
    const props_ = schema?.properties ?? {};
    return Object.entries(props_).map(([key, prop]): TypedField => {
        const kind = classify(prop);
        const field: TypedField = {
            key,
            label: labelFor(key),
            kind,
            options: prop.enum,
            minimum: prop.minimum,
            maximum: prop.maximum,
            maxLength: prop.maxLength,
            pattern: prop.pattern,
            placeholder: placeholderFor(prop, kind),
            hint: hintFor(prop)
        };
        if (kind === 'array-int-bounded') {
            field.intOptions = buildIntOptions(key, prop);
            field.maxItems = prop.maxItems;
            field.itemType = 'integer';
        } else if (kind === 'array') {
            const t = prop.items?.type;
            field.itemType =
                t === 'integer' || t === 'number' ? t : 'string';
            field.maxItems = prop.maxItems;
        }
        return field;
    });
});

const allowExtras = computed<boolean>(() => {
    const schema = props.kind?.metadataSchema as
        | {additionalProperties?: boolean}
        | undefined;
    return schema?.additionalProperties !== false;
});

const empty = computed(
    () => typedFields.value.length === 0 && !allowExtras.value
);

// ── Setters: keep modelValue.policy / configProfile pass-through ──

// ── DO functions: mutate state. Pair with the ANSWER parsers above. ──

function setField(key: string, value: unknown): void {
    const next = {...modelValue.value};
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    modelValue.value = next;
}

// Per-field inline error map for numeric inputs that fail validation.
const numericError = ref<Record<string, string>>({});

function setNumericError(key: string, msg: string): void {
    const next = {...numericError.value};
    if (msg) next[key] = msg;
    else delete next[key];
    numericError.value = next;
}

// Numeric field: route raw input through parseNumericInput, then store
// the parsed number OR surface the inline error. `field` is the owner
// (carries key + numeric kind), `raw` is the input value.
function commitNumericField(field: TypedField, raw: string): void {
    if (raw === '') {
        setNumericError(field.key, '');
        setField(field.key, undefined);
        return;
    }
    const numericKind = field.kind === 'integer' ? 'integer' : 'number';
    const result = parseNumericInput(raw, numericKind);
    if (!result.ok) {
        setNumericError(field.key, result.error);
        setField(field.key, undefined);
        return;
    }
    setNumericError(field.key, '');
    setField(field.key, result.value);
}

// ── Array fields ──

function arrayValue(field: TypedField): unknown[] {
    const v = modelValue.value[field.key];
    return Array.isArray(v) ? v : [];
}

function isInArray(field: TypedField, value: unknown): boolean {
    return arrayValue(field).includes(value);
}

// Toggle a single value into / out of an array field. Respects field.maxItems
// (silently no-ops the add at the cap; the hint shows the limit).
function toggleArrayMember(field: TypedField, value: unknown): void {
    const current = arrayValue(field);
    const idx = current.indexOf(value);
    if (idx >= 0) {
        const next = current.slice();
        next.splice(idx, 1);
        setField(field.key, next.length === 0 ? undefined : next);
        return;
    }
    if (field.maxItems != null && current.length >= field.maxItems) return;
    setField(field.key, [...current, value].sort((a, b) => Number(a) - Number(b)));
}

function arrayAsCsv(field: TypedField): string {
    return arrayValue(field).join(', ');
}

function commitArrayCsvField(field: TypedField, raw: string): void {
    const result = parseCsvArrayInput(raw, field.itemType ?? 'string');
    if (!result.ok) return; // parser only returns ok today; future-proofed
    setField(field.key, result.value.length === 0 ? undefined : result.value);
}

// ── Invisible fields: warn instead of silently saving rejectable state ──

interface InvisibleField {
    key: string;
    preview: string;
}

const invisibleFields = computed<InvisibleField[]>(() => {
    if (allowExtras.value) return [];
    const typedKeys = new Set(typedFields.value.map((f) => f.key));
    const out: InvisibleField[] = [];
    for (const [k, v] of Object.entries(modelValue.value)) {
        if (typedKeys.has(k)) continue;
        if (isReservedMetadataKey(k)) continue;
        const preview = previewValue(v);
        out.push({key: k, preview});
    }
    return out;
});

function previewValue(v: unknown): string {
    if (v == null) return 'null';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return truncateForChip(s);
}

function dropInvisibleFields(): void {
    const next = {...modelValue.value};
    for (const entry of invisibleFields.value) {
        delete next[entry.key];
    }
    modelValue.value = next;
}

// ── Extras: key-value rows for permissive kinds ──

interface ExtraRow {
    key: string;
    value: string;
}
const extraRows = ref<ExtraRow[]>([]);

// First duplicate key across non-empty extras rows; null if none.
// syncExtras silently last-write-wins on duplicates, so surface a
// visible warning so the user knows the earlier value will be dropped.
const duplicateExtraKey = computed<string | null>(() => {
    const seen = new Set<string>();
    for (const row of extraRows.value) {
        const k = row.key.trim();
        if (!k) continue;
        if (seen.has(k)) return k;
        seen.add(k);
    }
    return null;
});

// Aggregate validity for the parent Save button. invisibleFields would
// be rejected by the backend; duplicateExtraKey silently loses data.
// Both are surfaced inline in the form — also exposed via update:invalid
// so EditGroupModal disables Save until the user resolves them.
const hasInvalidState = computed<boolean>(
    () => invisibleFields.value.length > 0 || duplicateExtraKey.value !== null
);

watch(
    hasInvalidState,
    (value) => emit('update:invalid', value),
    {immediate: true}
);

// Sync extras from modelValue when kind / model changes externally.
watch(
    [() => props.kind?.id, () => modelValue.value],
    () => {
        const typedKeys = new Set(typedFields.value.map((f) => f.key));
        const fromModel: ExtraRow[] = [];
        for (const [k, v] of Object.entries(modelValue.value)) {
            if (typedKeys.has(k)) continue;
            if (isReservedMetadataKey(k)) continue;
            fromModel.push({key: k, value: v == null ? '' : String(v)});
        }
        // Preserve any in-flight blank rows the user just added so they
        // don't disappear when typing the key but not yet the value.
        const trailing = extraRows.value.filter(
            (r) => !r.key && !r.value
        );
        extraRows.value = [...fromModel, ...trailing];
    },
    {immediate: true, deep: true}
);

function addExtra(): void {
    extraRows.value.push({key: '', value: ''});
}

function removeExtra(idx: number): void {
    extraRows.value.splice(idx, 1);
    syncExtras();
}

function syncExtras(): void {
    const next = {...modelValue.value};
    const typedKeys = new Set(typedFields.value.map((f) => f.key));
    // Remove existing extras (anything that's neither typed nor reserved)
    // before re-applying from the current row state.
    for (const k of Object.keys(next)) {
        if (typedKeys.has(k)) continue;
        if (isReservedMetadataKey(k)) continue;
        delete next[k];
    }
    for (const row of extraRows.value) {
        const k = row.key.trim();
        const v = row.value.trim();
        if (!k) continue;
        next[k] = v;
    }
    modelValue.value = next;
}
</script>

<style scoped>
.gmf { display: flex; flex-direction: column; gap: var(--space-4); }

/* ── Incompatible-fields warning ── */
.gmf__warn {
    display: flex; flex-direction: column; gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-status-warn) 40%, transparent);
    background: color-mix(in srgb, var(--color-status-warn) 8%, transparent);
}
.gmf__warn-hdr {
    display: flex; align-items: center; gap: var(--space-2);
}
.gmf__warn-icon { color: var(--color-status-warn); }
.gmf__warn-title {
    flex: 1; font-size: var(--type-body); font-weight: 700;
    color: var(--color-text-primary);
}
.gmf__warn-drop {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-caption); font-weight: 600;
    cursor: pointer;
}
.gmf__warn-drop:hover {
    border-color: var(--color-danger-text);
    color: var(--color-danger-text);
}
.gmf__warn-list { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.gmf__warn-chip {
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    font-size: var(--type-caption); font-weight: 600;
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    white-space: nowrap;
}
.gmf__warn-hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.gmf__typed { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3) var(--space-4); }
.gmf__field { display: flex; flex-direction: column; gap: var(--space-1); }
.gmf__field-stack { display: flex; flex-direction: column; gap: var(--space-1); }

.gmf__label {
    font-size: var(--type-body); font-weight: 600;
    color: var(--color-text-primary);
    display: flex; align-items: baseline; gap: var(--space-2);
}
.gmf__hint-inline {
    font-size: var(--type-caption); font-weight: 400;
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}

.gmf__input, .gmf__select {
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    width: 100%;
}
.gmf__input:focus, .gmf__select:focus { outline: none; border-color: var(--color-primary); }
.gmf__input--narrow { width: 33%; flex: 0 0 33%; }

.gmf__checkbox {
    display: inline-flex; align-items: center; gap: var(--space-2);
    color: var(--color-text-primary); cursor: pointer;
}

/* ── Array fields ── */
.gmf__chips {
    display: flex; flex-wrap: wrap; gap: var(--space-1);
}
.gmf__chip {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: var(--type-body); font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
}
.gmf__chip:hover { color: var(--color-text-primary); border-color: var(--color-primary); }
.gmf__chip--on {
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
    color: var(--color-primary);
    border-color: var(--color-primary);
}

/* ── Inline error (numeric field, duplicate-key warning) ── */
.gmf__error {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-status-red, var(--color-danger-text));
}

/* ── Extras ── */
.gmf__extras { display: flex; flex-direction: column; gap: var(--space-2); }
.gmf__extras-hdr {
    font-size: var(--type-caption); font-weight: 700;
    color: var(--color-text-tertiary);
    text-transform: uppercase; letter-spacing: var(--tracking-wide);
    padding-top: var(--space-2);
    border-top: 1px solid var(--divider-hairline);
}
.gmf__rows { display: flex; flex-direction: column; gap: var(--space-2); }
.gmf__row { display: flex; gap: var(--space-2); align-items: center; }

.gmf__row-remove {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; flex-shrink: 0;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-medium);
    background: var(--color-surface-1);
    color: var(--color-text-disabled);
    cursor: pointer;
    transition: color var(--duration-fast), border-color var(--duration-fast);
}
.gmf__row-remove:hover {
    color: var(--color-danger-text);
    border-color: color-mix(in srgb, var(--color-danger-text) 30%, transparent);
}

.gmf__add {
    align-self: flex-start;
    display: inline-flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px dashed var(--color-border-medium);
    background: transparent;
    color: var(--color-text-disabled);
    font-size: var(--type-body); font-weight: 600;
    cursor: pointer;
    transition: color var(--duration-fast), border-color var(--duration-fast), background var(--duration-fast);
}
.gmf__add:hover {
    color: var(--color-primary); border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 4%, transparent);
}

.gmf__empty {
    padding: var(--space-3); text-align: center;
    color: var(--color-text-disabled);
    font-size: var(--type-body);
}

@media (max-width: 640px) {
    .gmf__typed { grid-template-columns: 1fr; }
}
</style>
