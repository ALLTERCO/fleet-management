<template>
    <template v-if="catalog">
        <OperationalPolicyIdentitySelector
            v-for="binding in bindingsAtPath"
            :key="`${binding.path}:${binding.collection}`"
            v-model="model"
            :binding="binding"
            :catalog="catalog"
        />
    </template>

    <SchemaForm
        v-if="Object.keys(scalarSchema.properties ?? {}).length > 0"
        v-model="scalarModel"
        :schema="scalarSchema"
    />

    <PolicyObjectEditor
        v-for="field in objectFields"
        :key="field.name"
        :model-value="objectValue(field.name)"
        :schema="field.schema"
        :catalog="catalog"
        :bindings="bindings"
        :path="childPath(field.name)"
        @update:model-value="setObject(field.name, $event)"
    />

    <SchemaArrayEditor
        v-for="field in arrayFields"
        :key="field.name"
        :model-value="arrayValue(field.name)"
        :schema="field.schema"
        :label="field.schema.title ?? humanize(field.name)"
        :catalog="catalog"
        :bindings="bindings"
        :path="`${childPath(field.name)}[]`"
        @update:model-value="setArray(field.name, $event)"
    />
</template>

<script setup lang="ts">
import type {JsonSchema} from '@api/_schema';
import type {
    OperationalPolicySelectorBinding,
    OperationalPolicySelectorCatalog
} from '@api/operations';
import {computed} from 'vue';
import SchemaForm from '@/components/core/SchemaForm.vue';
import OperationalPolicyIdentitySelector from './OperationalPolicyIdentitySelector.vue';
import SchemaArrayEditor from './SchemaArrayEditor.vue';

type PolicyRecord = Record<string, unknown>;

const model = defineModel<PolicyRecord>({required: true});

const props = withDefaults(defineProps<{
    schema: JsonSchema;
    catalog?: OperationalPolicySelectorCatalog | null;
    bindings?: readonly OperationalPolicySelectorBinding[];
    path?: string;
}>(), {
    catalog: null,
    bindings: () => [],
    path: ''
});

const bindingsAtPath = computed(() =>
    props.bindings.filter((binding) => binding.path === props.path)
);
const boundFields = computed(() => new Set(
    bindingsAtPath.value.flatMap((binding) => Object.keys(binding.apply))
));
const scalarSchema = computed<JsonSchema>(() => {
    const properties = Object.fromEntries(
        Object.entries(props.schema.properties ?? {}).filter(([name, field]) =>
            field.type !== 'array'
            && field.type !== 'object'
            && field.const === undefined
            && !boundFields.value.has(name)
        )
    );
    return {
        ...props.schema,
        properties,
        required: (props.schema.required ?? []).filter((name) => name in properties)
    };
});
const objectFields = computed(() => Object.entries(props.schema.properties ?? {})
    .filter(([, field]) => field.type === 'object')
    .map(([name, schema]) => ({name, schema}))
);
const arrayFields = computed(() => Object.entries(props.schema.properties ?? {})
    .filter(([, field]) => field.type === 'array')
    .map(([name, schema]) => ({name, schema}))
);
const scalarModel = computed<PolicyRecord>({
    get: () => model.value,
    set: (value) => {
        model.value = {...model.value, ...value};
    }
});

function objectValue(name: string): PolicyRecord {
    const value = model.value[name];
    return isRecord(value) ? value : {};
}

function arrayValue(name: string): unknown[] {
    const value = model.value[name];
    return Array.isArray(value) ? value : [];
}

function setObject(name: string, value: PolicyRecord): void {
    model.value = {...model.value, [name]: value};
}

function setArray(name: string, value: unknown[]): void {
    model.value = {...model.value, [name]: value};
}

function childPath(name: string): string {
    return props.path ? `${props.path}.${name}` : name;
}

function humanize(value: string): string {
    return value
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim()
        .replace(/^./, (character) => character.toUpperCase());
}

function isRecord(value: unknown): value is PolicyRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
</script>
