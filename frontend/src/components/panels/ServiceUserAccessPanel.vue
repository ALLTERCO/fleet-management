<template>
    <section class="suap">
        <div v-if="showGroups" class="suap__block">
            <div class="suap__head">
                <h3>User groups</h3>
                <span>{{ selectedGroupIds.length }} selected</span>
            </div>
            <div v-if="userGroups.length" class="suap__choices">
                <Checkbox
                    v-for="group in userGroups"
                    :key="group.id"
                    :model-value="selectedGroupIds.includes(group.id)"
                    :label="group.name"
                    :hint="group.description ?? undefined"
                    @update:model-value="toggleGroup(group.id)"
                />
            </div>
            <p v-else class="suap__hint">No user groups available.</p>
        </div>

        <div class="suap__block">
            <div class="suap__head">
                <h3>Roles</h3>
                <span>{{ assignments.length }} granted</span>
            </div>

            <!-- Granted roles — the primary list (one row per persona grant). -->
            <ul v-if="assignmentRows.length" class="suap__roles">
                <li
                    v-for="(row, index) in assignmentRows"
                    :key="`${row.persona}:${index}`"
                    class="suap__role"
                >
                    <span class="suap__role-persona">{{ row.persona }}</span>
                    <span class="suap__role-scope">{{ row.scope }}</span>
                    <span v-if="row.reason" class="suap__role-reason">
                        {{ row.reason }}
                    </span>
                    <button
                        type="button"
                        class="suap__remove"
                        title="Remove role"
                        @click="removeAssignment(index)"
                    >
                        <i class="fas fa-xmark" />
                    </button>
                </li>
            </ul>
            <p v-else class="suap__hint">No roles yet — add one below.</p>

            <!-- Add a role: pick a persona, optionally narrow its scope, add. -->
            <div class="suap__add">
                <FormField label="Persona">
                    <select v-model="draft.personaId" class="suap__select">
                        <option value="">Select persona...</option>
                        <option
                            v-for="persona in personas"
                            :key="persona.id"
                            :value="persona.id"
                        >
                            {{ persona.name }}
                        </option>
                    </select>
                </FormField>

                <template v-if="draft.personaId">
                    <FormField label="What can it access?">
                        <ScopeModeSelector
                            v-model:scope-all="draft.scopeAll"
                            v-model:scope="draft.scope"
                            :persona-key="draftPersonaKey"
                        />
                    </FormField>
                    <FormField
                        label="Reason"
                        :optional="!draftIsHighRisk"
                        :hint="
                            draftIsHighRisk
                                ? 'Required for full Admin or Manager access — kept in the audit log.'
                                : undefined
                        "
                    >
                        <Input
                            v-model="draft.reason"
                            placeholder="e.g. dashboard automation"
                        />
                    </FormField>
                    <p v-if="draftError" class="suap__error">{{ draftError }}</p>
                </template>

                <Button
                    type="blue-hollow"
                    narrow
                    :disabled="!draft.personaId"
                    @click="addAssignment"
                >
                    <i class="fas fa-plus" aria-hidden="true" /> Add role
                </Button>
            </div>
        </div>

        <div class="suap__summary">
            <h3>Access preview</h3>
            <p v-if="hasAccessPlan">
                The {{ subjectLabel }} will inherit
                <b>{{ selectedGroupIds.length }}</b> group(s) and
                <b>{{ assignments.length }}</b> role(s).
            </p>
            <ul v-if="previewRows.length" class="suap__preview-list">
                <li
                    v-for="row in previewRows"
                    :key="row"
                    class="suap__preview-row"
                >
                    <span>{{ row }}</span>
                </li>
            </ul>
            <p v-else>
                No access will be granted yet. The {{ subjectLabel }} can exist
                without access until a group, persona, or role is assigned.
            </p>
            <p v-if="showPatNote" class="suap__hint">
                PAT creation stays separate. Tokens can only use the service
                user's effective access, and scoped tokens can narrow it.
            </p>
        </div>
    </section>
</template>

<script setup lang="ts">
import {authzGrantIsHighRisk} from '@api/authzCatalog';
import {computed, onMounted, reactive, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import ScopeModeSelector from '@/components/core/ScopeModeSelector.vue';
import {
    buildServiceUserAccessAssignment,
    type ServiceUserAccessAssignment,
    type ServiceUserAssignmentDraft,
    serviceUserAccessPreviewRows,
    serviceUserAssignmentLabel,
    serviceUserScopeLabel
} from '@/helpers/serviceUserAccessPlan';
import {usePersonasStore} from '@/stores/personas';
import {useUserGroupsStore} from '@/stores/userGroups';

const props = withDefaults(
    defineProps<{
        groupIds: string[];
        assignments: ServiceUserAccessAssignment[];
        // Deprecated built-in role; access is granted via persona assignments.
        role?: string;
        // Copy is reused for human users too; default keeps service-user wording.
        subjectLabel?: string;
        showPatNote?: boolean;
        // Include built-in/system personas in the list (they are attachable).
        includeSystem?: boolean;
        // Hide the group block when groups are chosen elsewhere (e.g. a simple
        // checklist in the create-user modal).
        showGroups?: boolean;
    }>(),
    {
        subjectLabel: 'service user',
        showPatNote: true,
        includeSystem: false,
        showGroups: true,
        role: ''
    }
);

const emit = defineEmits<{
    'update:groupIds': [value: string[]];
    'update:assignments': [value: ServiceUserAccessAssignment[]];
}>();

const userGroupsStore = useUserGroupsStore();
const personasStore = usePersonasStore();
const draftError = ref('');
const draft = reactive<ServiceUserAssignmentDraft>({
    personaId: '',
    scopeAll: true,
    scope: {},
    reason: ''
});

const draftPersonaKey = computed(
    () => personasStore.personas[draft.personaId]?.key
);

const draftIsHighRisk = computed(() =>
    authzGrantIsHighRisk(draftPersonaKey.value ?? '', draft.scopeAll)
);

const userGroups = computed(() =>
    Object.values(userGroupsStore.groups).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);
const personas = computed(() =>
    Object.values(personasStore.personas).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);
const selectedGroupIds = computed(() => props.groupIds);
const assignments = computed(() => props.assignments);
const selectedGroupNames = computed(() =>
    selectedGroupIds.value.map(
        (id) => userGroupsStore.groups[id]?.name ?? id
    )
);
const hasAccessPlan = computed(
    () => selectedGroupIds.value.length > 0 || assignments.value.length > 0
);
// Structured rows for the granted-roles list (persona, scope badge, reason).
const assignmentRows = computed(() =>
    assignments.value.map((assignment) => ({
        persona:
            personasStore.personas[assignment.personaId]?.name ??
            assignment.personaId,
        scope: serviceUserScopeLabel(assignment.scope),
        reason: assignment.reason ?? ''
    }))
);
const assignmentLabels = computed(() =>
    assignments.value.map((assignment) =>
        serviceUserAssignmentLabel(
            assignment,
            personasStore.personas[assignment.personaId]?.name ??
                assignment.personaId
        )
    )
);
const previewRows = computed(() =>
    serviceUserAccessPreviewRows({
        role: props.role,
        groupNames: selectedGroupNames.value,
        assignmentLabels: assignmentLabels.value
    })
);

function toggleGroup(groupId: string): void {
    const current = selectedGroupIds.value;
    const next = current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId];
    emit('update:groupIds', next);
}

function addAssignment(): void {
    const assignment = buildServiceUserAccessAssignment(
        draft,
        draftPersonaKey.value
    );
    if (!assignment) {
        draftError.value = draftIsHighRisk.value
            ? 'Full Admin or Manager access needs a reason.'
            : 'Pick at least one resource, or use full persona access.';
        return;
    }
    draftError.value = '';
    emit('update:assignments', [...assignments.value, assignment]);
    resetDraft();
}

function removeAssignment(index: number): void {
    emit(
        'update:assignments',
        assignments.value.filter((_, currentIndex) => currentIndex !== index)
    );
}

function resetDraft(): void {
    draft.personaId = '';
    draft.scopeAll = true;
    draft.scope = {};
    draft.reason = '';
}

onMounted(async () => {
    await Promise.all([
        userGroupsStore.fetchAll(),
        personasStore.fetchAll(props.includeSystem)
    ]);
});
</script>

<style scoped>
.suap {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}
.suap__block,
.suap__summary {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-sm);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}
.suap__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
}
/* The "add a role" builder, separated from the granted-roles list above it. */
.suap__add {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding-top: var(--gap-sm);
    border-top: 1px solid var(--color-border-subtle);
}
.suap__roles {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    list-style: none;
    margin: 0;
    padding: 0;
}
.suap__role {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}
.suap__role-persona {
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.suap__role-scope {
    padding: var(--space-0-5) var(--gap-xs);
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    white-space: nowrap;
}
.suap__role-reason {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.suap__head h3,
.suap__summary h3 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
.suap__head span,
.suap__hint {
    color: var(--color-text-tertiary);
    font-size: var(--type-card-footer);
}
.suap__choices,
.suap__preview-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
}
.suap__preview-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-xs);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
}
.suap__select {
    width: 100%;
    min-width: 0;
    padding: var(--gap-xs) var(--gap-sm);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
}
.suap__remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--gap-lg);
    height: var(--gap-lg);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-danger-text);
    cursor: pointer;
}
.suap__remove:hover {
    background: var(--color-danger-subtle);
}
.suap__role .suap__remove {
    margin-left: auto;
}
.suap__error {
    color: var(--color-danger-text);
    font-size: var(--type-card-footer);
}
</style>
