<template>
    <form @submit.prevent="submit">
        <header>
            <h3>{{ policy ? `Edit ${entry.label}` : `New ${entry.label}` }}</h3>
            <p>{{ entry.description }}</p>
        </header>

        <PolicyObjectEditor
            v-model="draft"
            :schema="entry.policySchema"
            :catalog="selectorCatalog"
            :bindings="entry.selectorBindings"
        />

        <p v-if="policyStore.selectorLoading" class="selector-status">
            Loading Fleet source choices.
        </p>
        <p v-else-if="selectorCatalog && selectorCatalogEmpty" class="selector-status">
            No Fleet source choices are available for this policy context.
        </p>
        <p v-else-if="policyStore.selectorError" role="alert">
            {{ policyStore.selectorError }}
        </p>

        <p v-if="formError" role="alert">{{ formError }}</p>
        <div>
            <Button type="blue-hollow" size="sm" @click="$emit('cancel')">
                Cancel
            </Button>
            <Button
                type="green"
                size="sm"
                submit
                :loading="saving"
                :disabled="!canWrite"
            >
                Save policy
            </Button>
        </div>
    </form>
</template>

<script setup lang="ts">
import type {JsonSchema} from '@api/_schema';
import type {OperationalPolicyRegistryEntry} from '@api/operations';
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import {useOperationalPoliciesStore} from '@/stores/operationalPolicies';
import PolicyObjectEditor from './PolicyObjectEditor.vue';

type PolicyRecord = Record<string, unknown>;

const props = defineProps<{
    entry: OperationalPolicyRegistryEntry;
    policy: PolicyRecord | null;
    saving: boolean;
    canWrite: boolean;
}>();

const emit = defineEmits<{
    cancel: [];
    save: [policy: PolicyRecord];
}>();

const draft = ref<PolicyRecord>({});
const formError = ref<string | null>(null);
const policyStore = useOperationalPoliciesStore();
const selectorCatalog = computed(() =>
    policyStore.selectorCatalog?.family === props.entry.family
        ? policyStore.selectorCatalog
        : null
);
const selectorCatalogEmpty = computed(() => selectorCatalog.value !== null
    && Object.values(selectorCatalog.value).every((choices) =>
        !Array.isArray(choices) || choices.length === 0
    )
);
const rootLocationIdForCatalog = computed(() => {
    const binding = (props.entry.selectorBindings ?? []).find(
        (candidate) => candidate.path === '' && candidate.collection === 'locations'
    );
    const target = binding && Object.entries(binding.apply).find(
        ([, source]) => source === 'id'
    )?.[0];
    const value = target ? draft.value[target] : undefined;
    return typeof value === 'number' && Number.isInteger(value) && value > 0
        ? value
        : undefined;
});

watch(
    () => [props.entry, props.policy] as const,
    () => {
        draft.value = defaultsForSchema(
            props.entry.policySchema,
            props.policy ?? {}
        );
        formError.value = null;
    },
    {immediate: true}
);

watch(
    () => [props.entry.family, rootLocationIdForCatalog.value] as const,
    ([family, locationId]) => {
        void policyStore.fetchSelectorCatalog(family, locationId);
    },
    {immediate: true}
);

function defaultsForSchema(schema: JsonSchema, value: PolicyRecord): PolicyRecord {
    const next: PolicyRecord = {...value};
    for (const [name, field] of Object.entries(schema.properties ?? {})) {
        if (next[name] !== undefined) continue;
        if (field.const !== undefined) next[name] = field.const;
        if (field.type === 'array') next[name] = [];
    }
    return next;
}

function submit(): void {
    const missing = (props.entry.policySchema.required ?? []).find(
        (name) => draft.value[name] === undefined || draft.value[name] === ''
    );
    if (missing) {
        formError.value = `${humanize(missing)} is required.`;
        return;
    }
    const arrayError = arrayLengthError(props.entry.policySchema, draft.value);
    if (arrayError) {
        formError.value = arrayError;
        return;
    }
    formError.value = null;
    emit('save', draft.value);
}

function arrayLengthError(
    schema: JsonSchema,
    value: unknown,
    label = 'Items'
): string | null {
    if (schema.type === 'array' && Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) {
            return `${label} requires at least ${schema.minItems} items.`;
        }
        if (schema.maxItems !== undefined && value.length > schema.maxItems) {
            return `${label} allows at most ${schema.maxItems} items.`;
        }
        return value.map((item) => arrayLengthError(schema.items ?? {}, item, label))
            .find((error): error is string => error !== null) ?? null;
    }
    if (schema.type !== 'object' || value === null || typeof value !== 'object') {
        return null;
    }
    return Object.entries(schema.properties ?? {}).map(([name, field]) => {
        return arrayLengthError(field, (value as PolicyRecord)[name], humanize(name));
    }).find((error): error is string => error !== null) ?? null;
}

function humanize(value: string): string {
    return value
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .trim()
        .replace(/^./, (character) => character.toUpperCase());
}
</script>

<style scoped>
form {
    display: grid;
    gap: var(--space-5);
    padding: var(--space-5);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
}

header h3,
header p,
form > p {
    margin: 0;
}

header {
    display: grid;
    gap: var(--space-1);
}

header p {
    color: var(--color-text-secondary);
}

form > p {
    color: var(--color-danger-text);
}

form > div:last-child {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-3);
}
</style>
