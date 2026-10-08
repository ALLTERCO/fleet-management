<template>
    <section aria-labelledby="operations-settings-title">
        <header>
            <h2 id="operations-settings-title">Operational policies</h2>
            <p>
                Fleet defines the available operations, their data sources, and
                their policy fields. Templates only show the resulting status.
            </p>
        </header>

        <div v-if="loading" aria-live="polite">Loading Fleet operations…</div>

        <div v-else-if="error" role="alert">
            <p>{{ error }}</p>
            <Button type="blue-hollow" size="sm" @click="$emit('retry')">
                Retry
            </Button>
        </div>

        <p v-else-if="operations.length === 0">
            Fleet has not declared any operational policy families for this
            organization.
        </p>

        <div v-else>
            <article v-for="operation in operations" :key="operation.family">
                <h3>{{ operation.label }}</h3>
                <p>{{ operation.description }}</p>

                <dl>
                    <div>
                        <dt>Scope</dt>
                        <dd>{{ operation.scopes.join(', ') }}</dd>
                    </div>
                    <div>
                        <dt>Data source</dt>
                        <dd>{{ operation.sourceSelectors.join(', ') }}</dd>
                    </div>
                    <div>
                        <dt>Checks</dt>
                        <dd>{{ operation.evaluatorBlocks.join(', ') }}</dd>
                    </div>
                    <div>
                        <dt>Result states</dt>
                        <dd>{{ operation.resultStates.join(', ') }}</dd>
                    </div>
                    <div>
                        <dt>Editable fields</dt>
                        <dd>{{ operation.editableFields.join(', ') }}</dd>
                    </div>
                </dl>

                <Button v-if="canWrite" type="green" size="sm" @click="openNew(operation)">
                    Add policy
                </Button>

                <ul v-if="policiesFor(operation).length > 0">
                    <li v-for="policy in policiesFor(operation)" :key="policyKey(operation, policy)">
                        <span>{{ policyKey(operation, policy) }}</span>
                        <Button
                            v-if="canWrite"
                            type="blue-hollow"
                            size="sm"
                            @click="openEdit(operation, policy)"
                        >
                            Edit
                        </Button>
                        <Button
                            v-if="canWrite"
                            type="red"
                            size="sm"
                            :disabled="saving"
                            @click="askRemove(operation, policy)"
                        >
                            Delete
                        </Button>
                    </li>
                </ul>
                <p v-else>No policies configured.</p>
            </article>
        </div>

        <OperationalPolicyEditor
            v-if="selectedEntry"
            :entry="selectedEntry"
            :policy="selectedPolicy"
            :saving="saving"
            :can-write="canWrite"
            @cancel="closeEditor"
            @save="save"
        />
        <ConfirmationModal ref="deleteConfirmRef" />
    </section>
</template>

<script setup lang="ts">
import type {
    OperationalPolicies,
    OperationalPolicyFamily,
    OperationalPolicyRegistryEntry
} from '@api/operations';
import {ref} from 'vue';
import Button from '@/components/core/Button.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import OperationalPolicyEditor from './OperationalPolicyEditor.vue';

type PolicyRecord = Record<string, unknown>;

const props = defineProps<{
    operations: readonly OperationalPolicyRegistryEntry[];
    policies: OperationalPolicies | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
    canWrite: boolean;
}>();

const emit = defineEmits<{
    retry: [];
    save: [family: OperationalPolicyFamily, policy: PolicyRecord];
    remove: [family: OperationalPolicyFamily, policyId: string];
}>();

const selectedEntry = ref<OperationalPolicyRegistryEntry | null>(null);
const selectedPolicy = ref<PolicyRecord | null>(null);
type ConfirmationModalHandle = {
    storeAction(
        action: () => void | Promise<void>,
        options?: {title?: string; message?: string; confirmLabel?: string}
    ): boolean;
};
const deleteConfirmRef = ref<ConfirmationModalHandle | null>(null);

function policiesFor(entry: OperationalPolicyRegistryEntry): PolicyRecord[] {
    return (props.policies?.[entry.family] ?? []).map(toPolicyRecord);
}

function toPolicyRecord(policy: object): PolicyRecord {
    return policy as PolicyRecord;
}

function policyKey(
    entry: OperationalPolicyRegistryEntry,
    policy: PolicyRecord
): string {
    const value = policy[entry.policyIdField];
    return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : 'Unnamed policy';
}

function openNew(entry: OperationalPolicyRegistryEntry): void {
    selectedEntry.value = entry;
    selectedPolicy.value = null;
}

function openEdit(
    entry: OperationalPolicyRegistryEntry,
    policy: PolicyRecord
): void {
    selectedEntry.value = entry;
    selectedPolicy.value = policy;
}

function closeEditor(): void {
    selectedEntry.value = null;
    selectedPolicy.value = null;
}

function save(policy: PolicyRecord): void {
    if (!selectedEntry.value) return;
    emit('save', selectedEntry.value.family, policy);
}

function askRemove(
    entry: OperationalPolicyRegistryEntry,
    policy: PolicyRecord
): void {
    const value = policy[entry.policyIdField];
    if (typeof value !== 'string' && typeof value !== 'number') return;
    const policyId = String(value);
    deleteConfirmRef.value?.storeAction(
        () => emit('remove', entry.family, policyId),
        {
            title: `Delete ${entry.label} policy?`,
            message: `Fleet will remove policy ${policyId}. This cannot be undone.`,
            confirmLabel: 'Delete policy'
        }
    );
}
</script>

<style scoped>
section {
    display: grid;
    gap: var(--space-5);
    max-width: var(--prose-max-width);
}

section > header,
article,
article > ul {
    display: grid;
    gap: var(--space-3);
}

section > header h2,
section > header p,
article h3,
article p,
article dl,
article ul {
    margin: 0;
}

section > header p,
article p,
dt {
    color: var(--color-text-secondary);
}

article {
    padding: var(--space-5);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
}

dl {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--space-3);
}

dl > div {
    display: grid;
    gap: var(--space-1);
}

dt {
    font-size: var(--type-caption);
}

dd {
    margin: 0;
    color: var(--color-text-primary);
}

article > ul {
    padding: 0;
    list-style: none;
}

article li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}

article li span {
    flex: 1;
    min-width: 0;
    color: var(--color-text-primary);
}
</style>
