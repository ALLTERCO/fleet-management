<template>
    <Modal :visible="visible" wide @close="$emit('close')">
        <template #title>
            <h3 class="sd-title">
                <i class="fas fa-share-nodes sd-title__icon" />
                Share {{ resourceLabel }}
            </h3>
        </template>

        <div class="sd-body">
            <div v-if="loadError" class="sd-error">
                <i class="fas fa-exclamation-triangle" /> {{ loadError }}
            </div>

            <div class="sd-field">
                <label class="sd-label" for="sd-subject-search">Subject</label>
                <div class="sd-segmented" role="group" aria-label="Share target type">
                    <button
                        type="button"
                        class="sd-segmented__option"
                        :class="{'sd-segmented__option--active': form.subjectType === 'user'}"
                        @click="setSubjectType('user')"
                    >
                        <i class="fas fa-user" />
                        Person
                    </button>
                    <button
                        type="button"
                        class="sd-segmented__option"
                        :class="{'sd-segmented__option--active': form.subjectType === 'user_group'}"
                        @click="setSubjectType('user_group')"
                    >
                        <i class="fas fa-users" />
                        Group
                    </button>
                </div>
                <Input
                    id="sd-subject-search"
                    v-model="userSearch"
                    :placeholder="subjectSearchPlaceholder"
                />
                <select
                    id="sd-subject"
                    v-model="form.subjectId"
                    class="sd-select sd-select--list"
                    size="6"
                >
                    <option v-if="subjectOptions.length === 0" value="" disabled>
                        {{ subjectLoading ? 'Loading…' : 'No matches' }}
                    </option>
                    <option
                        v-for="option in subjectOptions"
                        :key="`${option.type}:${option.id}`"
                        :value="option.id"
                    >
                        {{ option.label }}
                        <template v-if="option.detail"> — {{ option.detail }}</template>
                    </option>
                </select>
                <p class="sd-hint">
                    Prefer groups for shared access. Use people only for explicit exceptions.
                </p>
            </div>

            <div class="sd-field">
                <label class="sd-label" for="sd-persona">Persona (role)</label>
                <select
                    id="sd-persona"
                    v-model="form.personaId"
                    class="sd-select"
                    :title="selectedPersonaTooltip"
                >
                    <option value="" disabled>Select persona…</option>
                    <optgroup v-if="tenantPersonas.length" label="Your personas">
                        <option
                            v-for="p in tenantPersonas"
                            :key="p.id"
                            :value="p.id"
                            :title="personaTooltip(p)"
                        >{{ p.name }}</option>
                    </optgroup>
                    <optgroup label="System personas">
                        <option
                            v-for="p in systemPersonas"
                            :key="p.id"
                            :value="p.id"
                            :title="personaTooltip(p)"
                        >{{ p.name }}</option>
                    </optgroup>
                </select>
                <p
                    v-if="selectedPersonaDescription"
                    class="sd-persona-doc"
                    aria-live="polite"
                >
                    <i class="fas fa-circle-info" />
                    {{ selectedPersonaDescription }}
                </p>
                <p class="sd-hint">
                    System personas are predefined (admin/manager/editor/viewer/operator/installer).
                    Tenant personas live above and override defaults.
                </p>
            </div>

            <div class="sd-scope">
                <i class="fas fa-circle-info sd-scope__icon" />
                Scope: <strong>{{ scopeSummary }}</strong>
            </div>

            <!-- Shared with — existing assignments on this resource. -->
            <div class="sd-current">
                <div class="sd-current__header">
                    <span class="sd-label">Shared with</span>
                    <span v-if="sharesLoading" class="sd-current__loading">
                        <i class="fas fa-spinner fa-spin" /> loading…
                    </span>
                </div>
                <ul
                    v-if="currentShares.length > 0"
                    class="sd-current__list"
                >
                    <li
                        v-for="row in currentShares"
                        :key="row.id"
                        class="sd-current__row"
                    >
                        <div class="sd-current__who">
                            <i
                                class="fas"
                                :class="
                                    row.subject_type === 'user_group'
                                        ? 'fa-users'
                                        : 'fa-user'
                                "
                            />
                            <span class="sd-current__subject">{{
                                subjectLabel(row)
                            }}</span>
                            <span class="sd-current__persona">{{
                                personaLabel(row)
                            }}</span>
                        </div>
                        <button
                            v-if="canRevokeShare"
                            class="sd-current__revoke"
                            type="button"
                            :disabled="revokingId === row.id"
                            :aria-label="'Revoke ' + subjectLabel(row)"
                            @click="revoke(row.id)"
                        >
                            <i
                                class="fas"
                                :class="
                                    revokingId === row.id
                                        ? 'fa-spinner fa-spin'
                                        : 'fa-trash'
                                "
                            />
                        </button>
                    </li>
                </ul>
                <p
                    v-else-if="sharesError"
                    class="sd-current__error"
                >
                    Couldn't load the share list. Retry the dialog or check
                    backend connectivity.
                </p>
                <p
                    v-else-if="!sharesLoading"
                    class="sd-current__empty"
                >
                    Not shared with anyone yet — fill the form above and click
                    Share.
                </p>
            </div>
        </div>

        <template #footer>
            <Button type="blue-hollow" size="sm" @click="$emit('close')">
                Cancel
            </Button>
            <Button
                type="blue"
                size="sm"
                :disabled="!canSubmit || submitting"
                @click="onSubmit"
            >
                {{ submitting ? 'Sharing…' : 'Share' }}
            </Button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, onMounted, reactive, ref, toRef, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import Modal from '@/components/modals/Modal.vue';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {
    buildShareSubjectOptions,
    type ShareSubjectType
} from '@/helpers/shareSubjectOptions';
import {
    type AssignmentResponse,
    type AssignmentScope,
    type AssignmentSubjectType,
    useAssignmentsStore
} from '@/stores/assignments';
import {
    type PersonaResponse,
    usePersonasStore
} from '@/stores/personas';
import {useUserGroupsStore} from '@/stores/userGroups';
import {useUsersStore} from '@/stores/users';

// Fallback copy when a system persona ships without a description.
const SYSTEM_PERSONA_BLURB: Record<string, string> = {
    admin: 'Full access — manage resources, settings, members.',
    manager: 'Manage resources and members; cannot change tenant settings.',
    editor: 'Create, edit, and configure resources.',
    operator: 'Run runtime actions (toggle, restart) but no config changes.',
    viewer: 'Read-only access — view resources and telemetry.',
    installer: 'Add new devices and assign them to locations / groups.',
    auditor: 'Read-only access to authz state and audit history.'
};

// Resource-scoped Share dialog. Wraps assignment.create with the
// boilerplate already used elsewhere in the app — picks a subject,
// picks a persona, derives the scope from the page context.
type ShareResourceType = 'dashboard' | 'location' | 'group' | 'device';

const props = defineProps<{
    visible: boolean;
    resourceType: ShareResourceType;
    // string for device shellyID, number id for the rest.
    resourceId: string | number;
    resourceLabel?: string;
}>();

const emit = defineEmits<{close: []; shared: []}>();

const usersStore = useUsersStore();
const userGroupsStore = useUserGroupsStore();
const personasStore = usePersonasStore();
const assignmentsStore = useAssignmentsStore();
const rpc = useRpcPermissions();
const canCreateShare = computed(() => rpc.canCall('assignment.create'));
const canRevokeShare = computed(() => rpc.canCall('assignment.delete'));

const userSearch = ref('');
const submitting = ref(false);
const loadError = ref('');
const currentShares = ref<AssignmentResponse[]>([]);
const sharesError = ref(false);
const sharesLoading = ref(false);
const revokingId = ref<string | null>(null);

const form = reactive<{
    subjectType: ShareSubjectType;
    subjectId: string;
    personaId: string;
}>({
    subjectType: 'user_group',
    subjectId: '',
    personaId: ''
});

async function refreshShares() {
    sharesLoading.value = true;
    sharesError.value = false;
    try {
        const items = await assignmentsStore.listForResource(
            props.resourceType,
            props.resourceId
        );
        if (items === null) {
            sharesError.value = true;
            currentShares.value = [];
        } else {
            currentShares.value = items;
        }
    } finally {
        sharesLoading.value = false;
    }
}

async function revoke(id: string) {
    if (!canRevokeShare.value) return;
    revokingId.value = id;
    try {
        const ok = await assignmentsStore.remove(id);
        if (ok) currentShares.value = currentShares.value.filter((r) => r.id !== id);
    } finally {
        revokingId.value = null;
    }
}

function subjectLabel(row: AssignmentResponse): string {
    if (row.subject_type === 'user_group') {
        return userGroupsStore.groups[row.subject_id]?.name ?? row.subject_id;
    }
    const u = usersStore.users.find((x) => x.userId === row.subject_id);
    if (u) return u.displayName || u.userName || u.email || u.userId;
    return row.subject_id;
}

function personaLabel(row: AssignmentResponse): string {
    const p = personasStore.personas[row.persona_id];
    return p?.name ?? '(unknown persona)';
}

// Reset state each time the dialog opens so a previous share doesn't
// linger in the form.
watch(toRef(props, 'visible'), (open) => {
    if (!open) return;
    form.subjectType = 'user_group';
    form.subjectId = '';
    form.personaId = '';
    userSearch.value = '';
    loadError.value = '';
    void Promise.all([
        usersStore.fetchUsers(),
        userGroupsStore.fetchAll(),
        personasStore.fetchAll(),
        refreshShares()
    ]).catch((e) => {
        loadError.value = e instanceof Error ? e.message : String(e);
    });
});

const subjectOptions = computed(() =>
    buildShareSubjectOptions({
        users: usersStore.users,
        groups: Object.values(userGroupsStore.groups),
        selectedType: form.subjectType,
        query: userSearch.value
    })
);

const subjectLoading = computed(() =>
    form.subjectType === 'user' ? usersStore.loading : userGroupsStore.loading
);

const subjectSearchPlaceholder = computed(() =>
    form.subjectType === 'user'
        ? 'Search people by name or email…'
        : 'Search groups by name or purpose…'
);

function setSubjectType(subjectType: ShareSubjectType): void {
    if (form.subjectType === subjectType) return;
    form.subjectType = subjectType;
    form.subjectId = '';
    userSearch.value = '';
}

const tenantPersonas = computed(() =>
    Object.values(personasStore.personas).filter((p) => !p.is_system_managed)
);
const systemPersonas = computed(() =>
    Object.values(personasStore.personas).filter((p) => p.is_system_managed)
);

function personaDescription(p: PersonaResponse): string {
    if (p.description) return p.description;
    if (p.is_system_managed) return SYSTEM_PERSONA_BLURB[p.key] ?? '';
    return '';
}

function personaTooltip(p: PersonaResponse): string {
    const blurb = personaDescription(p);
    return blurb ? `${p.name} — ${blurb}` : p.name;
}

const selectedPersona = computed<PersonaResponse | undefined>(() =>
    form.personaId ? personasStore.personas[form.personaId] : undefined
);
const selectedPersonaDescription = computed(() =>
    selectedPersona.value ? personaDescription(selectedPersona.value) : ''
);
const selectedPersonaTooltip = computed(() =>
    selectedPersona.value ? personaTooltip(selectedPersona.value) : ''
);

const scope = computed<AssignmentScope>(() => {
    switch (props.resourceType) {
        case 'dashboard':
            return {dashboard_ids: [Number(props.resourceId)]};
        case 'location':
            return {location_ids: [Number(props.resourceId)]};
        case 'group':
            return {device_group_ids: [Number(props.resourceId)]};
        case 'device':
            return {device_ids: [String(props.resourceId)]};
    }
});

const scopeSummary = computed(() =>
    `${props.resourceType} #${props.resourceId}${props.resourceLabel ? ` (${props.resourceLabel})` : ''}`
);

const resourceLabel = computed(
    () => props.resourceLabel || `this ${props.resourceType}`
);

const canSubmit = computed(
    () => canCreateShare.value && !!form.subjectId && !!form.personaId && !submitting.value
);

async function onSubmit() {
    if (!canSubmit.value) return;
    submitting.value = true;
    try {
        const res = await assignmentsStore.create({
            subjectType: form.subjectType as AssignmentSubjectType,
            subjectId: form.subjectId,
            personaId: form.personaId,
            scope: scope.value
        });
        if (res) {
            currentShares.value = [res, ...currentShares.value];
            emit('shared');
            form.subjectId = '';
            form.personaId = '';
        }
    } finally {
        submitting.value = false;
    }
}

// Pre-warm on mount when already open (e.g., direct deep-link). Visible-watch
// only fires on transition, so a deep-linked open also needs the share list.
onMounted(() => {
    if (props.visible) {
        void usersStore.fetchUsers();
        void userGroupsStore.fetchAll();
        void personasStore.fetchAll();
        void refreshShares();
    }
});
</script>

<style scoped>
.sd-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
}
.sd-title__icon {
    color: var(--color-primary);
}
.sd-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) 0;
}
.sd-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.sd-label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.sd-segmented {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}
.sd-segmented__option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    min-height: 2.25rem;
    border: 0;
    border-radius: calc(var(--radius-md) - 2px);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
}
.sd-segmented__option--active {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-sm);
}
.sd-select {
    padding: var(--space-1-5) var(--space-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
.sd-select--list {
    padding: 0;
}
.sd-hint {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.sd-persona-doc {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface-1));
    border: 1px solid color-mix(in srgb, var(--color-primary) 28%, transparent);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    line-height: 1.4;
}
.sd-persona-doc i {
    margin-top: var(--space-0-5);
    color: var(--color-primary);
}
.sd-scope {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface-1));
    border: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}
.sd-scope__icon {
    color: var(--color-primary);
}
.sd-error {
    color: var(--color-status-red);
    font-size: var(--type-caption);
}
.sd-current {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-default);
}
.sd-current__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
}
.sd-current__loading {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.sd-current__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.sd-current__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    min-height: var(--touch-target-min);
}
.sd-current__who {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
}
.sd-current__who i {
    color: var(--color-text-tertiary);
    width: 1em;
    text-align: center;
}
.sd-current__subject {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sd-current__persona {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    white-space: nowrap;
}
.sd-current__revoke {
    min-width: var(--touch-target-min);
    min-height: var(--touch-target-min);
    border: none;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-md);
}
.sd-current__revoke:hover:not(:disabled) {
    color: var(--color-status-red);
    background: color-mix(in srgb, var(--color-status-red) 8%, transparent);
}
.sd-current__revoke:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
.sd-current__empty {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-style: italic;
}
.sd-current__error {
    margin: 0;
    color: var(--color-danger, var(--color-text-tertiary));
    font-size: var(--type-caption);
}
</style>
