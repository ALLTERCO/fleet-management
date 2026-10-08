<template>
    <section class="operations-array" :aria-labelledby="headingId">
        <header class="operations-array__header">
            <div>
                <h4 :id="headingId">{{ label }}</h4>
                <p v-if="schema.description">{{ schema.description }}</p>
            </div>
            <Button type="blue-hollow" size="sm" @click="addItem">
                Add {{ itemLabel }}
            </Button>
        </header>

        <p v-if="model.length === 0" class="operations-array__empty">
            No {{ itemLabel }} configured.
        </p>

        <article v-for="(item, index) in model" :key="index" class="operations-array__item">
            <header class="operations-array__item-header">
                <h5>{{ itemLabel }} {{ index + 1 }}</h5>
                <Button type="red" size="sm" @click="removeItem(index)">
                    Remove
                </Button>
            </header>

            <label v-if="variants.length > 0" class="operations-array__variant">
                <span>Type</span>
                <select
                    :value="variantIndex(item)"
                    @change="selectVariantFromEvent(index, $event)"
                >
                    <option v-for="(variant, variantIndex) in variants" :key="variantIndex" :value="variantIndex">
                        {{ variantLabel(variant) }}
                    </option>
                </select>
            </label>

            <PolicyObjectEditor
                v-if="isObjectSchema(activeSchema(item))"
                :model-value="objectItem(item)"
                :schema="activeSchema(item)"
                :catalog="catalog"
                :bindings="bindings"
                :path="path"
                @update:model-value="updateObject(index, $event)"
            />

            <div v-else class="operations-array__scalar">
                <Input
                    :model-value="stringValue(item)"
                    :type="inputType(activeSchema(item))"
                    @update:model-value="updateScalar(index, $event)"
                />
            </div>
        </article>
    </section>
</template>

<script setup lang="ts">
import type {JsonSchema} from '@api/_schema';
import type {OperationalPolicySelectorBinding, OperationalPolicySelectorCatalog} from '@api/operations';
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import PolicyObjectEditor from './PolicyObjectEditor.vue';

type PolicyRecord = Record<string, unknown>;

const model = defineModel<unknown[]>({required: true});

const props = defineProps<{
    schema: JsonSchema;
    label: string;
    catalog?: OperationalPolicySelectorCatalog | null;
    bindings?: readonly OperationalPolicySelectorBinding[];
    path?: string;
}>();

const itemSchema = computed<JsonSchema>(() => props.schema.items ?? {});
const variants = computed(() => itemSchema.value.oneOf ?? []);
const headingId = computed(() => `operations-array-${props.label}`);
const itemLabel = computed(() => singular(props.label));

function isObjectSchema(schema: JsonSchema): boolean {
    return schema.type === 'object';
}

function activeSchema(item: unknown): JsonSchema {
    const index = variantIndex(item);
    return index === null ? itemSchema.value : variants.value[index];
}

function variantIndex(item: unknown): number | null {
    if (variants.value.length === 0) return null;
    const record = objectItem(item);
    const index = variants.value.findIndex((variant) =>
        discriminatorValues(variant).every(({path, values}) => {
            const value = readPath(record, path);
            return values.includes(value);
        })
    );
    return index >= 0 ? index : 0;
}

function selectVariantFromEvent(index: number, event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    const variant = variants.value[value];
    if (!variant) return;
    replace(
        index,
        preserveSharedVariantFields(
            objectItem(model.value[index]),
            objectItem(defaultValue(variant)),
            variant
        )
    );
}

function variantLabel(schema: JsonSchema): string {
    const parts = discriminatorValues(schema).flatMap(({path, values}) =>
        values.map((value) => `${humanize(path)}: ${String(value)}`)
    );
    return parts.length > 0 ? parts.join(' · ') : 'Variant';
}

function discriminatorValues(
    schema: JsonSchema,
    prefix = ''
): Array<{path: string; values: unknown[]}> {
    return Object.entries(schema.properties ?? {}).flatMap(([name, field]) => {
        const path = prefix ? `${prefix}.${name}` : name;
        const values = field.const !== undefined
            ? [field.const]
            : field.enum ? [...field.enum] : [];
        if (values.length > 0) return [{path, values}];
        return field.type === 'object'
            ? discriminatorValues(field, path)
            : [];
    });
}

function readPath(value: PolicyRecord, path: string): unknown {
    return path.split('.').reduce<unknown>((current, part) =>
        isRecord(current) ? current[part] : undefined,
    value);
}

function objectItem(value: unknown): PolicyRecord {
    return isRecord(value) ? value : {};
}

function addItem(): void {
    model.value = [...model.value, defaultValue(itemSchema.value)];
}

function removeItem(index: number): void {
    model.value = model.value.filter((_, candidate) => candidate !== index);
}

function updateObject(index: number, value: PolicyRecord): void {
    replace(
        index,
        mergeEditedObject(
            objectItem(model.value[index]),
            value,
            activeSchema(model.value[index])
        )
    );
}

function updateScalar(index: number, value: string | number): void {
    replace(index, valueForSchema(value, itemSchema.value));
}

function replace(index: number, value: unknown): void {
    model.value = model.value.map((item, candidate) =>
        candidate === index ? value : item
    );
}

function defaultValue(schema: JsonSchema): unknown {
    if (schema.default !== undefined) return schema.default;
    if (schema.oneOf && schema.oneOf.length > 0) {
        return defaultValue(schema.oneOf[0]);
    }
    if (schema.const !== undefined) return schema.const;
    if (schema.enum && schema.enum.length > 0) return schema.enum[0];
    if (schema.type === 'array') return [];
    if (schema.type === 'object') {
        return Object.fromEntries(
            Object.entries(schema.properties ?? {}).flatMap(([name, field]) => {
                const value = defaultValue(field);
                return value === undefined ? [] : [[name, value]];
            })
        );
    }
    if (schema.type === 'boolean') return false;
    return '';
}

function mergeEditedObject(
    current: PolicyRecord,
    edited: PolicyRecord,
    schema: JsonSchema
): PolicyRecord {
    const next: PolicyRecord = {...current};
    for (const [name, field] of Object.entries(schema.properties ?? {})) {
        if (field.const !== undefined) {
            next[name] = current[name] ?? field.const;
            continue;
        }
        if (!(name in edited)) continue;
        const value = edited[name];
        next[name] =
            field.type === 'object' && isRecord(value)
                ? mergeEditedObject(objectItem(current[name]), value, field)
                : value;
    }
    return next;
}

function preserveSharedVariantFields(
    current: PolicyRecord,
    defaults: PolicyRecord,
    schema: JsonSchema
): PolicyRecord {
    const next: PolicyRecord = {...defaults};
    for (const [name, field] of Object.entries(schema.properties ?? {})) {
        if (!(name in current) || field.const !== undefined) continue;
        const currentValue = current[name];
        if (field.type === 'object' && isRecord(currentValue)) {
            next[name] = preserveSharedVariantFields(
                currentValue,
                objectItem(defaults[name]),
                field
            );
            continue;
        }
        if (matchesSchemaValue(currentValue, field)) {
            next[name] = currentValue;
        }
    }
    return next;
}

function matchesSchemaValue(value: unknown, schema: JsonSchema): boolean {
    if (schema.enum && !schema.enum.includes(value)) return false;
    if (schema.type === 'string') return typeof value === 'string';
    if (schema.type === 'boolean') return typeof value === 'boolean';
    if (schema.type === 'number' || schema.type === 'integer') {
        return typeof value === 'number';
    }
    if (schema.type === 'array') return Array.isArray(value);
    if (schema.type === 'object') return isRecord(value);
    return value !== undefined;
}

function valueForSchema(value: string | number, schema: JsonSchema): unknown {
    if (schema.type === 'number' || schema.type === 'integer') {
        return Number(value);
    }
    return value;
}

function inputType(schema: JsonSchema): 'number' | 'text' {
    return schema.type === 'number' || schema.type === 'integer'
        ? 'number'
        : 'text';
}

function stringValue(value: unknown): string {
    return value === undefined || value === null ? '' : String(value);
}

function humanize(value: string): string {
    return value
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim()
        .replace(/^./, (character) => character.toUpperCase());
}

function singular(value: string): string {
    return value.endsWith('s') ? value.slice(0, -1) : value;
}

function isRecord(value: unknown): value is PolicyRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
</script>

<style scoped>
.operations-array {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}

.operations-array__header,
.operations-array__item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}

.operations-array__header h4,
.operations-array__item-header h5,
.operations-array__header p,
.operations-array__empty {
    margin: 0;
}

.operations-array__header p,
.operations-array__empty {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.operations-array__item {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}

.operations-array__variant {
    display: grid;
    gap: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

.operations-array__variant select {
    min-height: var(--touch-target-min);
    padding: var(--space-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
}
</style>
