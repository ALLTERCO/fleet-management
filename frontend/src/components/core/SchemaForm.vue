<template>
    <div class="sf" :class="{'sf--inline': inline}" :title="inline ? inlineHint : undefined">
        <div
            v-for="field in fields"
            :key="field.key"
            class="sf__field"
            :class="{'sf__field--wide': field.isObject}"
        >
            <label v-if="!field.isBoolean" class="sf__label">
                {{ field.label }}
                <span v-if="field.required" class="sf__req" aria-label="required">*</span>
            </label>

            <!-- Boolean -->
            <Checkbox
                v-if="field.isBoolean"
                :model-value="readValue(field.key) as boolean ?? false"
                :label="`${field.label}${field.required ? ' *' : ''}`"
                @update:model-value="setValue(field.key, $event)"
            />

            <!-- Enum → Dropdown -->
            <Dropdown
                v-else-if="field.enumOptions"
                :options="field.enumOptions"
                :default="String(readValue(field.key) ?? field.enumOptions[0])"
                @selected="setValue(field.key, $event)"
            />

            <!-- Secret → SecretField (string w/ 'Secret field' in description) -->
            <SecretField
                v-else-if="field.isSecret"
                :model-value="(readValue(field.key) as string) ?? ''"
                :has-secret="hasSecretFor(field.key)"
                :placeholder="field.placeholder"
                @update:model-value="setValue(field.key, $event)"
            />

            <!-- Duration (seconds) → number + unit -->
            <DurationField
                v-else-if="field.isDuration"
                :model-value="Number(readValue(field.key) ?? 0)"
                :max="field.max"
                @update:model-value="setValue(field.key, $event)"
            />

            <!-- Integer / number -->
            <Input
                v-else-if="field.isNumeric"
                :model-value="String(readValue(field.key) ?? '')"
                type="number"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                :placeholder="field.placeholder"
                @update:model-value="setNumeric(field.key, $event)"
            />

            <!-- Nested object — recurse -->
            <div v-else-if="field.isObject" class="sf__nested">
                <SchemaForm
                    :model-value="(readValue(field.key) as Record<string, unknown>) ?? {}"
                    :schema="field.schema"
                    :has-secret-for="(k) => hasSecretFor(`${field.key}.${k}`)"
                    @update:model-value="setValue(field.key, $event)"
                />
            </div>

            <!-- Default → string Input -->
            <Input
                v-else
                :model-value="(readValue(field.key) as string) ?? ''"
                type="text"
                :placeholder="field.placeholder"
                @update:model-value="setValue(field.key, $event)"
            />

            <p
                v-if="cleanDescription(field) && !field.isBoolean && !inline"
                class="sf__hint"
            >
                {{ cleanDescription(field) }}
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {JsonSchema} from '@api/_schema';
import {computed} from 'vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import DurationField from '@/components/core/DurationField.vue';
import Input from '@/components/core/Input.vue';
import SecretField from '@/components/core/SecretField.vue';

const model = defineModel<Record<string, unknown>>({required: true});

const props = defineProps<{
    schema: JsonSchema;
    hasSecretFor?: (fieldPath: string) => boolean;
}>();

interface FieldDescriptor {
    key: string;
    label: string;
    description?: string;
    required: boolean;
    enumOptions?: string[];
    isBoolean: boolean;
    isNumeric: boolean;
    isDuration: boolean;
    isSecret: boolean;
    isObject: boolean;
    schema: JsonSchema;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number | 'any';
}

function humanize(key: string): string {
    // camelCase/snake_case → Title Case
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, (c) => c.toUpperCase());
}

function isObjectType(t: string | string[] | undefined): boolean {
    if (!t) return false;
    return Array.isArray(t) ? t.includes('object') : t === 'object';
}

function isNumericType(t: string | string[] | undefined): boolean {
    if (!t) return false;
    const arr = Array.isArray(t) ? t : [t];
    return arr.some((x) => x === 'integer' || x === 'number');
}

function numericStep(t: string | string[] | undefined): number | 'any' {
    const types = Array.isArray(t) ? t : [t];
    return types.includes('number') ? 'any' : 1;
}

function isBooleanType(t: string | string[] | undefined): boolean {
    if (!t) return false;
    return Array.isArray(t) ? t.includes('boolean') : t === 'boolean';
}

// One setting reads as a row; more than one needs its column back.
const inline = computed(() => fields.value.length === 1);

// The hint would wrap and undo the row, so it moves to the control's tooltip.
const inlineHint = computed(() =>
    inline.value ? (cleanDescription(fields.value[0]) ?? '') : ''
);

const fields = computed<FieldDescriptor[]>(() => {
    const required = new Set(props.schema.required ?? []);
    const props_ = props.schema.properties ?? {};
    return Object.entries(props_).map(([key, field]) => {
        const description = field.description;
        const isSecret = !!description?.toLowerCase().includes('secret field');
        const enumOpts = field.enum?.map(String);
        const isObject = isObjectType(field.type) && !!field.properties;
        // Numeric fields named "...Sec" are durations (seconds) — show a
        // number + unit control and drop the "Sec" from the label.
        const isDuration =
            isNumericType(field.type) && !enumOpts && /Sec$/.test(key);
        const placeholder =
            field.default != null && !isObject
                ? String(field.default)
                : undefined;
        return {
            key,
            label: humanize(isDuration ? key.replace(/Sec$/, '') : key),
            description,
            required: required.has(key),
            enumOptions: enumOpts,
            isBoolean: isBooleanType(field.type),
            isNumeric: isNumericType(field.type),
            isDuration,
            isSecret,
            isObject,
            schema: field,
            placeholder,
            min: field.minimum,
            max: field.maximum,
            step: numericStep(field.type)
        };
    });
});

function readValue(key: string): unknown {
    return model.value[key];
}

function setValue(key: string, val: unknown) {
    model.value = {...model.value, [key]: val};
}

function setNumeric(key: string, raw: string | number) {
    if (typeof raw === 'number') {
        if (Number.isFinite(raw)) setValue(key, raw);
        return;
    }
    const t = raw.trim();
    if (!t) {
        const next = {...model.value};
        delete next[key];
        model.value = next;
        return;
    }
    const n = Number(t);
    if (Number.isFinite(n)) setValue(key, n);
}

function hasSecretFor(path: string): boolean {
    return props.hasSecretFor ? props.hasSecretFor(path) : false;
}

// Backend tags secret fields with "Secret field" anywhere in the
// description — prefix ("Secret field - ...") or suffix ("...  Secret
// field."). The masked input already conveys secrecy; strip the marker
// so the hint shows only the meaningful copy.
function cleanDescription(field: FieldDescriptor): string | undefined {
    const raw = field.description;
    if (!raw) return undefined;
    const stripped = raw
        .replace(/\s*Secret\s+field\b\s*[.:;\-–—]*\s*/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    return stripped.length > 0 ? stripped : undefined;
}
</script>

<style scoped>
/* Auto-fit grid — handles schemas with any number of fields cleanly.
   Columns pack at a 16rem minimum; wide fields (objects, nested) span the row.

   Columns are capped rather than 1fr: with auto-fit, a one-field schema took
   the entire grid, so a "3 min" duration stretched the full width of a wide
   modal. A control should be as wide as the value it holds. */
.sf {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 24rem));
    gap: var(--space-3) var(--space-4);
    justify-content: start;
}

.sf__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

/* A lone setting reads better as one row than as a stacked label, control and
   hint. Research favours labels above fields for multi-field forms, where the
   eye scans a column; a single control has no column to scan. */
.sf--inline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
}

.sf--inline .sf__field {
    flex-direction: row;
    align-items: center;
    gap: var(--space-3);
}

.sf--inline .sf__label {
    margin: 0;
    white-space: nowrap;
}

.sf__field--wide {
    grid-column: 1 / -1;
}

.sf__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    line-height: 1.2;
}

.sf__req {
    color: var(--color-danger-text);
    margin-left: var(--space-0-5);
}

.sf__hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    line-height: 1.45;
}

.sf__nested {
    padding: var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}

@media (max-width: 640px) {
    .sf {
        grid-template-columns: 1fr;
    }
}
</style>
