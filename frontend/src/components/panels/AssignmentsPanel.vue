<template>
    <div class="ap-root">
        <div v-if="loading" class="ap-loading">Loading…</div>
        <template v-else>
            <div class="ap-head">
                <label v-if="allItems.length" class="ap-filter">
                    <input v-model="showUnusedOnly" type="checkbox" />
                    <span>
                        Show only unused ({{ AUTHZ_UNUSED_THRESHOLD_DAYS }}d+) —
                        {{ unusedCount }} of {{ allItems.length }}
                    </span>
                </label>
                <span v-else />
                <Button v-if="canCreate" type="green" narrow @click="openAdd">
                    <i class="fas fa-plus" aria-hidden="true" /> Add role
                </Button>
            </div>

            <ul v-if="items.length" class="ap-list">
                <li v-for="a in items" :key="a.id" class="ap-row">
                    <div class="ap-row__main">
                        <div class="ap-row__persona">
                            <i class="fas fa-id-badge" />
                            <span class="ap-row__name">
                                {{ personaLabel(a.persona_id) }}
                            </span>
                        </div>
                        <div class="ap-row__scope ap-mono">
                            {{ serviceUserScopeLabel(a.scope) }}
                        </div>
                        <div
                            class="ap-row__usage"
                            :class="usageClass(a.last_used_at)"
                            :title="usageTooltip(a.last_used_at)"
                        >
                            {{ usageLabel(a.last_used_at) }}
                        </div>
                        <!-- An expired grant used to look identical to a live
                             one, so access could lapse with no sign of why. -->
                        <div
                            v-if="a.expires_at"
                            class="ap-row__expiry"
                            :class="{
                                'ap-row__expiry--gone': hasExpired(a.expires_at)
                            }"
                        >
                            {{ expiryLabel(a.expires_at) }}
                        </div>
                    </div>
                    <!-- The create flow makes this mandatory; showing it back
                         is what makes it an audit trail rather than a form. -->
                    <p v-if="a.reason" class="ap-row__reason">
                        {{ a.reason }}
                    </p>
                    <button
                        v-if="canDelete"
                        type="button"
                        class="ap-action-btn ap-action-btn--danger"
                        :title="`Remove ${personaLabel(a.persona_id)}`"
                        :aria-label="`Remove ${personaLabel(a.persona_id)}`"
                        @click="detach(a)"
                    >
                        <i class="fas fa-trash" />
                    </button>
                </li>
            </ul>
            <p v-else-if="loadError" class="ap-empty ap-empty--error">
                {{ loadError }}
            </p>
            <p v-else class="ap-empty">No roles yet — add one to grant access.</p>
        </template>

        <Modal :visible="addVisible" @close="closeAdd">
            <template #title>Add role</template>
            <div class="ap-add">
                <FormField
                    label="Role"
                    :hint="
                        availablePersonas.length
                            ? undefined
                            : 'No roles are available to add. Every role this subject can hold is already assigned, or none are defined yet.'
                    "
                >
                    <select
                        v-model="form.personaId"
                        class="ap-select"
                        :disabled="!availablePersonas.length"
                    >
                        <option value="" disabled>Select a role…</option>
                        <option
                            v-for="p in availablePersonas"
                            :key="p.id"
                            :value="p.id"
                        >
                            {{ p.name }}
                        </option>
                    </select>
                </FormField>
                <FormField label="What can it access?">
                    <ScopeModeSelector
                        v-model:scope-all="form.scopeAll"
                        v-model:scope="form.scope"
                        :persona-key="selectedPersonaKey"
                    />
                </FormField>
                <template v-if="grantIsHighRisk">
                    <FormField
                        label="Why full access?"
                        hint="Required for full Admin or Manager access — kept in the audit log."
                    >
                        <Input
                            v-model="form.reason"
                            placeholder="e.g. takes over device management"
                        />
                    </FormField>
                    <FormField
                        v-if="subjectIsServiceUser"
                        label="Access expires after"
                    >
                        <Dropdown
                            :groups="GRANT_EXPIRY_GROUPS"
                            :default="form.expiresDays"
                            @selected="
                                (v: unknown) => (form.expiresDays = String(v))
                            "
                        />
                    </FormField>
                </template>
            </div>
            <template #footer>
                <div class="ap-add-footer">
                    <Button type="blue-hollow" @click="closeAdd">Cancel</Button>
                    <Button
                        type="green"
                        :disabled="!canAttach || attaching"
                        @click="attach"
                    >
                        {{ attaching ? 'Adding…' : 'Add role' }}
                    </Button>
                </div>
            </template>
        </Modal>
    </div>
    <ConfirmationModal ref="detachRef">
        <template #title><h3>Remove this role?</h3></template>
        <template #subText>
            <p class="ap-confirm">
                {{
                    detachTarget
                        ? personaLabel(detachTarget.persona_id)
                        : 'This role'
                }}
                will lose the access it grants, right away. This cannot be
                undone.
            </p>
        </template>
    </ConfirmationModal>
</template>

<script setup lang="ts">
import {authzGrantIsHighRisk} from '@api/authzCatalog';
import {computed, onMounted, reactive, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import ScopeModeSelector from '@/components/core/ScopeModeSelector.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import {AUTHZ_UNUSED_THRESHOLD_DAYS} from '@/constants';
import {formatRpcError} from '@/helpers/domainErrors';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {buildScope, type ScopeSelection} from '@/helpers/scopeDimensions';
import {serviceUserScopeLabel} from '@/helpers/serviceUserAccessPlan';
import {
    GRANT_EXPIRY_OPTIONS,
    grantExpiryIso
} from '@/helpers/serviceUserCreate';
import {
    type AssignmentResponse,
    type AssignmentSubjectType,
    useAssignmentsStore
} from '@/stores/assignments';
import {usePersonasStore} from '@/stores/personas';
import {useToastStore} from '@/stores/toast';

const props = defineProps<{
    subjectType: AssignmentSubjectType;
    subjectId: string;
    // Machine credentials must expire on high-risk grants; humans don't.
    subjectIsServiceUser?: boolean;
}>();

const personasStore = usePersonasStore();
const assignmentsStore = useAssignmentsStore();
const toast = useToastStore();
const rpc = useRpcPermissions();
const canCreate = computed(() => rpc.canCall('assignment.create'));
const canDelete = computed(() => rpc.canCall('assignment.delete'));

const loading = ref(false);
const attaching = ref(false);
const addVisible = ref(false);
const showUnusedOnly = ref(false);
const subjectKey = computed(() => `${props.subjectType}:${props.subjectId}`);
const allItems = computed<AssignmentResponse[]>(
    () => assignmentsStore.bySubject[subjectKey.value] ?? []
);

function isUnused(a: AssignmentResponse): boolean {
    const cutoff = Date.now() - AUTHZ_UNUSED_THRESHOLD_DAYS * 86_400_000;
    return !a.last_used_at || new Date(a.last_used_at).getTime() < cutoff;
}

const items = computed(() =>
    showUnusedOnly.value ? allItems.value.filter(isUnused) : allItems.value
);
const unusedCount = computed(() => allItems.value.filter(isUnused).length);

const availablePersonas = computed(() =>
    Object.values(personasStore.personas).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);

function hasExpired(iso: string): boolean {
    const at = Date.parse(iso);
    return Number.isFinite(at) && at <= Date.now();
}

// Local calendar date as a day count, so DST-length days still differ by 1.
function localDayNumber(ms: number): number {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
}

function expiryLabel(iso: string): string {
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return '';
    const now = Date.now();
    if (at <= now) return 'Expired';
    const days = localDayNumber(at) - localDayNumber(now);
    if (days <= 0) return 'Expires today';
    if (days === 1) return 'Expires tomorrow';
    return `Expires in ${days} days`;
}

function personaLabel(id: string): string {
    return personasStore.personas[id]?.name ?? id;
}

const GRANT_EXPIRY_GROUPS = [{label: '', items: [...GRANT_EXPIRY_OPTIONS]}];

const form = reactive<{
    personaId: string;
    scopeAll: boolean;
    scope: ScopeSelection;
    reason: string;
    expiresDays: string;
}>({
    personaId: '',
    scopeAll: true,
    scope: {},
    reason: '',
    expiresDays: '365'
});

const selectedPersonaKey = computed(
    () => personasStore.personas[form.personaId]?.key
);

const grantIsHighRisk = computed(() =>
    authzGrantIsHighRisk(selectedPersonaKey.value ?? '', form.scopeAll)
);

const canAttach = computed(() => {
    if (!form.personaId) return false;
    if (buildScope(form.scopeAll, form.scope) === null) return false;
    return !grantIsHighRisk.value || form.reason.trim() !== '';
});

function usageLabel(lastUsedAt: string | null): string {
    if (!lastUsedAt) return 'Never used';
    const days = Math.floor(
        (Date.now() - new Date(lastUsedAt).getTime()) / 86_400_000
    );
    if (days <= 0) return 'Used today';
    if (days === 1) return 'Used 1 day ago';
    return `Used ${days} days ago`;
}

function usageClass(lastUsedAt: string | null): string {
    if (!lastUsedAt) return 'ap-row__usage--stale';
    const days = Math.floor(
        (Date.now() - new Date(lastUsedAt).getTime()) / 86_400_000
    );
    if (days >= AUTHZ_UNUSED_THRESHOLD_DAYS) return 'ap-row__usage--stale';
    if (days >= AUTHZ_UNUSED_THRESHOLD_DAYS / 3) return 'ap-row__usage--warn';
    return 'ap-row__usage--fresh';
}

function usageTooltip(lastUsedAt: string | null): string {
    if (!lastUsedAt) {
        return 'No permission check has matched this assignment yet';
    }
    return `Last matched: ${new Date(lastUsedAt).toLocaleString()}`;
}

function openAdd(): void {
    form.personaId = '';
    form.scopeAll = true;
    form.scope = {};
    form.reason = '';
    form.expiresDays = '365';
    addVisible.value = true;
}

function closeAdd(): void {
    addVisible.value = false;
}

// The throwing loaders keep a failed load distinct from "no roles yet".
const loadError = ref('');

async function refresh() {
    loading.value = true;
    loadError.value = '';
    try {
        await Promise.all([
            personasStore.loadAll(true),
            assignmentsStore.loadForSubject(props.subjectType, props.subjectId)
        ]);
    } catch (e: unknown) {
        loadError.value = `Could not load roles. ${formatRpcError(e)}`;
    } finally {
        loading.value = false;
    }
}

async function attach() {
    const scope = buildScope(form.scopeAll, form.scope);
    if (!scope || !canAttach.value || !canCreate.value) return;
    attaching.value = true;
    try {
        const created = await assignmentsStore.create({
            subjectType: props.subjectType,
            subjectId: props.subjectId,
            personaId: form.personaId,
            scope,
            ...(grantIsHighRisk.value ? {reason: form.reason.trim()} : {}),
            ...(grantIsHighRisk.value && props.subjectIsServiceUser
                ? {expiresAt: grantExpiryIso(form.expiresDays)}
                : {})
        });
        if (created) {
            toast.success('Role added');
            closeAdd();
        }
    } finally {
        attaching.value = false;
    }
}

// Revoking access is destructive and has no undo, so it asks first — the same
// bar every other irreversible action on this page already meets.
const detachRef = ref<InstanceType<typeof ConfirmationModal>>();
const detachTarget = ref<AssignmentResponse | null>(null);

function detach(a: AssignmentResponse) {
    if (!canDelete.value) return;
    detachTarget.value = a;
    detachRef.value?.storeAction(async () => {
        const ok = await assignmentsStore.remove(a.id);
        if (ok) toast.success('Role removed');
    });
}

onMounted(() => {
    void refresh();
});
watch(
    () => `${props.subjectType}:${props.subjectId}`,
    () => {
        void refresh();
    }
);
</script>

<style scoped>
.ap-root {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}
.ap-loading,
.ap-empty {
    padding: var(--gap-md) 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    text-align: center;
}
.ap-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
}
.ap-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    margin: 0;
    padding: 0;
    list-style: none;
}
.ap-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-1);
}
.ap-row__main {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}
.ap-row__persona {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    color: var(--color-text-primary);
    font-weight: var(--font-medium);
}
.ap-row__name {
    font-size: var(--type-body);
}
.ap-row__scope {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.ap-row__usage {
    margin-top: var(--space-0-5);
    font-size: var(--type-caption);
}
.ap-filter {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    cursor: pointer;
    user-select: none;
}
.ap-row__usage--fresh {
    color: var(--color-success-text);
}
.ap-row__usage--warn {
    color: var(--color-status-warn);
}
.ap-row__usage--stale {
    color: var(--color-status-off);
}
.ap-mono {
    font-family: var(--font-mono);
}
.ap-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--gap-lg);
    height: var(--gap-lg);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-primary-text);
    cursor: pointer;
}
.ap-action-btn--danger {
    color: var(--color-danger-text);
}
.ap-action-btn--danger:hover {
    background-color: var(--color-danger-subtle);
}
.ap-add {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}
.ap-add-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-sm);
}
.ap-select {
    width: 100%;
    min-width: 0;
    padding: var(--gap-xs) var(--gap-sm);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-3);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.ap-select:focus {
    outline: none;
    border-color: var(--color-primary);
}
.ap-row__expiry {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.ap-row__expiry--gone {
    color: var(--color-danger-text);
    font-weight: var(--font-semibold);
}
.ap-row__reason {
    margin: var(--gap-2xs) 0 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.ap-confirm {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
/* A select whose only focus cue is a 1px border is not a focus cue. */
.ap-select:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}
.ap-empty--error {
    color: var(--color-danger-text);
}
</style>
