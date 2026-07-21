<template>
    <PageTemplate title="Personas" :tabs="tabs" fill>
        <div class="personas-layout">
            <h2 class="sr-only">Personas</h2>

            <div class="personas-panel">
                <div class="personas-panel__head">
                    <div class="search-pill personas-search">
                        <i class="fas fa-search search-pill__icon" />
                        <input
                            v-model.trim="search"
                            type="text"
                            class="search-pill__input"
                            placeholder="Search personas…"
                            aria-label="Search"
                        />
                    </div>
                    <Button
                        v-if="canCreatePersona"
                        type="green"
                        narrow
                        title="New persona"
                        aria-label="New persona"
                        @click="openCreate"
                    >
                        <i class="fas fa-plus" />
                    </Button>
                </div>

                <DataList
                    :rows="filtered"
                    :columns="columns"
                    row-key="id"
                    :loading="store.loading"
                    empty-message="No personas yet."
                >
                    <template #cell-kind="{row}">
                        <span
                            class="persona-kind"
                            :class="row.is_system_managed
                                ? 'persona-kind--system'
                                : 'persona-kind--custom'"
                        >
                            {{ row.is_system_managed ? 'System' : 'Custom' }}
                        </span>
                    </template>
                    <template #cell-statements="{row}">
                        <span class="persona-stmt-count">{{ row.statements.length }}</span>
                    </template>
                    <template #cell-summary="{row}">
                        <span class="persona-summary">
                            {{ summarize(row.statements) }}
                        </span>
                    </template>
                    <template #cell-actions="{row}">
                        <button
                            type="button"
                            v-if="canUpdatePersona"
                            class="persona-action-btn"
                            :title="`Edit ${row.name}`"
                            :disabled="row.is_system_managed"
                            @click="openEdit(row)"
                        >
                            <i class="fas fa-pen" />
                        </button>
                        <button
                            type="button"
                            v-if="canDeletePersona"
                            class="persona-action-btn persona-action-btn--danger"
                            :title="`Delete ${row.name}`"
                            :disabled="row.is_system_managed"
                            @click="confirmDelete(row)"
                        >
                            <i class="fas fa-trash" />
                        </button>
                    </template>
                </DataList>
            </div>
        </div>

        <template #modals>
            <Modal
                :visible="modalVisible"
                @close="closeModal"
            >
                <template #title>
                    {{ editingId ? 'Edit Persona' : 'Create Persona' }}
                </template>

                <form class="persona-form" @submit.prevent="save">
                    <!-- Identity -->
                    <div class="persona-form__grid">
                        <FormField label="Key" :error="errors.key">
                            <Input
                                v-model="form.key"
                                placeholder="lobby-operator"
                                :disabled="!!editingId"
                            />
                        </FormField>
                        <FormField label="Name" :error="errors.name">
                            <Input
                                v-model="form.name"
                                placeholder="Lobby Operator"
                            />
                        </FormField>
                    </div>
                    <FormField label="Description">
                        <Input
                            v-model="form.description"
                            placeholder="What does this persona allow?"
                        />
                    </FormField>

                    <!-- Permissions header -->
                    <div class="persona-stmts">
                        <div class="persona-stmts__head">
                            <h3 class="persona-stmts__title">Permissions</h3>
                            <p class="persona-stmts__hint">
                                Each statement: <code>Effect</code> on
                                <code>actions</code> for
                                <code>resource types</code>. Use
                                <code>*</code> for any.
                            </p>
                        </div>
                        <p v-if="errors.statements" class="persona-error">
                            {{ errors.statements }}
                        </p>

                        <!-- Statement cards -->
                        <div
                            v-for="(s, idx) in statements"
                            :key="idx"
                            class="persona-stmt"
                            :class="{
                                'persona-stmt--deny': s.effect === 'Deny'
                            }"
                        >
                            <!-- Card header: Effect toggle | summary | remove -->
                            <div class="persona-stmt__head">
                                <div
                                    class="persona-stmt__effect"
                                    role="radiogroup"
                                    :aria-label="`Statement ${idx + 1} effect`"
                                >
                                    <button
                                        type="button"
                                        class="persona-effect-pill"
                                        :class="s.effect === 'Allow' && 'persona-effect-pill--on persona-effect-pill--allow'"
                                        :aria-pressed="s.effect === 'Allow'"
                                        @click="s.effect = 'Allow'"
                                    >
                                        <i class="fas fa-check" /> Allow
                                    </button>
                                    <button
                                        type="button"
                                        class="persona-effect-pill"
                                        :class="s.effect === 'Deny' && 'persona-effect-pill--on persona-effect-pill--deny'"
                                        :aria-pressed="s.effect === 'Deny'"
                                        @click="s.effect = 'Deny'"
                                    >
                                        <i class="fas fa-ban" /> Deny
                                    </button>
                                </div>
                                <p class="persona-stmt__summary">
                                    {{ summarizeStatement(s) }}
                                </p>
                                <button
                                    type="button"
                                    class="persona-stmt__remove"
                                    :title="`Remove statement ${idx + 1}`"
                                    @click="removeStatement(idx)"
                                >
                                    <i class="fas fa-times" />
                                </button>
                            </div>

                            <!-- Card body: actions + resources -->
                            <div class="persona-stmt__body">
                                <FormField label="Actions">
                                    <ChipInput
                                        v-model="s.actions"
                                        :suggestions="AUTHZ_ACTION_SUGGESTIONS"
                                        placeholder="device:read, group:* …"
                                    />
                                </FormField>
                                <FormField label="Resource types">
                                    <ChipInput
                                        v-model="s.resource_types"
                                        :suggestions="AUTHZ_RESOURCE_SUGGESTIONS"
                                        placeholder="device, location …"
                                    />
                                </FormField>
                            </div>

                            <!-- Card footer: advanced collapse -->
                            <div class="persona-stmt__advanced">
                                <Collapse title="Advanced (exceptions, conditions)">
                                    <div class="persona-stmt__advanced-body">
                                        <FormField label="NotActions (deny exceptions)">
                                            <ChipInput
                                                :model-value="s.not_actions ?? []"
                                                :suggestions="AUTHZ_ACTION_SUGGESTIONS"
                                                placeholder="device:delete …"
                                                @update:model-value="
                                                    (v) =>
                                                        (s.not_actions =
                                                            v.length === 0
                                                                ? undefined
                                                                : v)
                                                "
                                            />
                                        </FormField>
                                        <FormField label="NotResourceTypes">
                                            <ChipInput
                                                :model-value="s.not_resource_types ?? []"
                                                :suggestions="AUTHZ_RESOURCE_SUGGESTIONS"
                                                placeholder="dashboard …"
                                                @update:model-value="
                                                    (v) =>
                                                        (s.not_resource_types =
                                                            v.length === 0
                                                                ? undefined
                                                                : v)
                                                "
                                            />
                                        </FormField>
                                        <Checkbox
                                            :model-value="
                                                s.condition?.mfa?.required ===
                                                true
                                            "
                                            label="Require MFA"
                                            hint="Token must include the mfa amr"
                                            @update:model-value="
                                                (v) => setMfaRequiredVal(s, v)
                                            "
                                        />
                                        <FormField label="IP CIDR allowlist">
                                            <ChipInput
                                                :model-value="s.condition?.ip?.cidrs ?? []"
                                                placeholder="10.0.0.0/8 …"
                                                @update:model-value="
                                                    (v) => setIpCidrs(s, v)
                                                "
                                            />
                                        </FormField>
                                        <div class="persona-stmt__time">
                                            <FormField label="Time window start">
                                                <Input
                                                    type="datetime-local"
                                                    :model-value="
                                                        fromIso(
                                                            s.condition?.time
                                                                ?.window?.start
                                                        )
                                                    "
                                                    @update:model-value="
                                                        (v: string | number) =>
                                                            setTimeWindow(
                                                                s,
                                                                'start',
                                                                String(v)
                                                            )
                                                    "
                                                />
                                            </FormField>
                                            <FormField label="Time window end">
                                                <Input
                                                    type="datetime-local"
                                                    :model-value="
                                                        fromIso(
                                                            s.condition?.time
                                                                ?.window?.end
                                                        )
                                                    "
                                                    @update:model-value="
                                                        (v: string | number) =>
                                                            setTimeWindow(
                                                                s,
                                                                'end',
                                                                String(v)
                                                            )
                                                    "
                                                />
                                            </FormField>
                                        </div>
                                    </div>
                                </Collapse>
                            </div>
                        </div>

                        <Button
                            type="white"
                            narrow
                            @click="addStatement"
                        >
                            Add statement
                        </Button>
                    </div>
                </form>

                <template #footer>
                    <div class="persona-modal-footer">
                        <Button type="white" @click="closeModal">Cancel</Button>
                        <Button type="blue" :disabled="saving" @click="save">
                            {{ saving ? 'Saving…' : 'Save' }}
                        </Button>
                    </div>
                </template>
            </Modal>

            <ConfirmationModal ref="deleteRef">
                <template #title>
                    <h3>Delete persona "{{ deleteTargetName }}"?</h3>
                </template>
                <template #subText>
                    <p class="persona-form__hint">
                        Refused if any assignment still references it.
                    </p>
                </template>
            </ConfirmationModal>
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    AUTHZ_ACTION_SUGGESTIONS,
    AUTHZ_RESOURCE_SUGGESTIONS,
    AUTHZ_RESOURCE_TYPES,
    AUTHZ_VERBS
} from '@api/authzCatalog';
import {
    type ComponentPublicInstance,
    type ComputedRef,
    computed,
    inject,
    onMounted,
    reactive,
    ref
} from 'vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import ChipInput from '@/components/core/ChipInput.vue';
import Collapse from '@/components/core/Collapse.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {
    type PersonaResponse,
    type PersonaStatement,
    usePersonasStore
} from '@/stores/personas';
import {useToastStore} from '@/stores/toast';
import type {RouteTab} from '@/types/page-template';

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const store = usePersonasStore();
const toast = useToastStore();
const rpc = useRpcPermissions();
const canCreatePersona = computed(() => rpc.canCall('persona.create'));
const canUpdatePersona = computed(() => rpc.canCall('persona.update'));
const canDeletePersona = computed(() => rpc.canCall('persona.delete'));

const search = ref('');
const personas = computed(() => Object.values(store.personas));
const filtered = computed(() => {
    const all = personas.value;
    if (!search.value) return all;
    const q = search.value.toLowerCase();
    return all.filter(
        (p) =>
            p.name.toLowerCase().includes(q) ||
            p.key.toLowerCase().includes(q) ||
            (p.description?.toLowerCase().includes(q) ?? false)
    );
});

const columns: DataColumn<PersonaResponse>[] = [
    {key: 'name', label: 'Name', role: 'primary'},
    {key: 'key', label: 'Key', role: 'meta'},
    {
        key: 'description',
        label: 'Description',
        role: 'secondary',
        accessor: (p) => p.description || '—'
    },
    {key: 'kind', label: 'Kind', role: 'status', align: 'center'},
    {
        key: 'statements',
        label: '#',
        role: 'meta',
        align: 'center'
    },
    {key: 'summary', label: 'Permissions', role: 'secondary'},
    {key: 'actions', label: '', role: 'action', align: 'right'}
];

onMounted(() => {
    store.fetchAll(true);
});

const modalVisible = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const form = reactive({key: '', name: '', description: ''});
const statements = ref<PersonaStatement[]>([]);
const errors = reactive({key: '', name: '', statements: ''});

function defaultStatement(): PersonaStatement {
    return {
        actions: ['device:read'],
        resource_types: ['device'],
        effect: 'Allow'
    };
}

function resetForm() {
    form.key = '';
    form.name = '';
    form.description = '';
    statements.value = [defaultStatement()];
    errors.key = '';
    errors.name = '';
    errors.statements = '';
}

function openCreate() {
    resetForm();
    editingId.value = null;
    modalVisible.value = true;
}

function openEdit(p: PersonaResponse) {
    resetForm();
    editingId.value = p.id;
    form.key = p.key;
    form.name = p.name;
    form.description = p.description ?? '';
    // Deep clone so edits don't mutate the store's cached row before save.
    statements.value = JSON.parse(
        JSON.stringify(p.statements)
    ) as PersonaStatement[];
    if (statements.value.length === 0) {
        statements.value = [defaultStatement()];
    }
    modalVisible.value = true;
}

function closeModal() {
    modalVisible.value = false;
    editingId.value = null;
}

function addStatement() {
    statements.value.push(defaultStatement());
}

function removeStatement(idx: number) {
    statements.value.splice(idx, 1);
    if (statements.value.length === 0) {
        statements.value.push(defaultStatement());
    }
}

function setMfaRequiredVal(s: PersonaStatement, checked: boolean) {
    if (!checked) {
        if (s.condition) {
            delete s.condition.mfa;
            if (
                !s.condition.ip?.cidrs?.length &&
                !s.condition.time?.window
            ) {
                delete s.condition;
            }
        }
        return;
    }
    s.condition = {...(s.condition ?? {}), mfa: {required: true}};
}

function setIpCidrs(s: PersonaStatement, cidrs: string[]) {
    if (cidrs.length === 0) {
        if (s.condition?.ip) {
            delete s.condition.ip;
            if (
                !s.condition.mfa?.required &&
                !s.condition.time?.window
            ) {
                delete s.condition;
            }
        }
        return;
    }
    s.condition = {...(s.condition ?? {}), ip: {cidrs}};
}

function setTimeWindow(
    s: PersonaStatement,
    field: 'start' | 'end',
    value: string
) {
    const iso = value ? new Date(value).toISOString() : '';
    const existing = s.condition?.time?.window ?? {start: '', end: ''};
    const next = {...existing, [field]: iso};
    if (!next.start && !next.end) {
        if (s.condition?.time) {
            delete s.condition.time;
            if (
                !s.condition.mfa?.required &&
                !s.condition.ip?.cidrs?.length
            ) {
                delete s.condition;
            }
        }
        return;
    }
    s.condition = {...(s.condition ?? {}), time: {window: next}};
}

function fromIso(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const tzOffset = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

function isValidAction(a: string): boolean {
    if (a === '*') return true;
    const colonIdx = a.indexOf(':');
    if (colonIdx <= 0) return false;
    const resource = a.slice(0, colonIdx);
    const verb = a.slice(colonIdx + 1);
    const resourceOk = resource === '*' ||
        (AUTHZ_RESOURCE_TYPES as readonly string[]).includes(resource);
    const verbOk = (AUTHZ_VERBS as readonly string[]).includes(verb);
    return resourceOk && verbOk;
}

function isValidResourceType(r: string): boolean {
    return r === '*' ||
        (AUTHZ_RESOURCE_TYPES as readonly string[]).includes(r);
}

function validate(): PersonaStatement[] | null {
    errors.statements = '';
    if (statements.value.length === 0) {
        errors.statements = 'Add at least one statement.';
        return null;
    }
    for (let i = 0; i < statements.value.length; i++) {
        const s = statements.value[i];
        if (!s.actions || s.actions.length === 0) {
            errors.statements = `Statement ${i + 1}: pick at least one action.`;
            return null;
        }
        const badAction = s.actions.find((a) => !isValidAction(a));
        if (badAction !== undefined) {
            errors.statements = `Statement ${i + 1}: unknown action "${badAction}". Use resource:verb from the suggestions.`;
            return null;
        }
        if (!s.resource_types || s.resource_types.length === 0) {
            errors.statements = `Statement ${i + 1}: pick at least one resource type.`;
            return null;
        }
        const badResource = s.resource_types.find((r) => !isValidResourceType(r));
        if (badResource !== undefined) {
            errors.statements = `Statement ${i + 1}: unknown resource type "${badResource}".`;
            return null;
        }
        if (s.effect !== 'Allow' && s.effect !== 'Deny') {
            errors.statements = `Statement ${i + 1}: effect must be Allow or Deny.`;
            return null;
        }
        const win = s.condition?.time?.window;
        if (win && (!win.start || !win.end)) {
            errors.statements = `Statement ${i + 1}: time window needs both start and end.`;
            return null;
        }
    }
    return statements.value.map((s) => normalize(s));
}

// Drop empty optional fields so the saved statements stay tidy.
function normalize(s: PersonaStatement): PersonaStatement {
    const out: PersonaStatement = {
        actions: [...s.actions],
        resource_types: [...s.resource_types],
        effect: s.effect
    };
    if (s.not_actions?.length) out.not_actions = [...s.not_actions];
    if (s.not_resource_types?.length)
        out.not_resource_types = [...s.not_resource_types];
    if (s.condition) {
        const cond: PersonaStatement['condition'] = {};
        if (s.condition.mfa?.required) cond.mfa = {required: true};
        if (s.condition.ip?.cidrs?.length)
            cond.ip = {cidrs: [...s.condition.ip.cidrs]};
        if (s.condition.time?.window?.start && s.condition.time.window.end) {
            cond.time = {
                window: {
                    start: s.condition.time.window.start,
                    end: s.condition.time.window.end
                }
            };
        }
        if (Object.keys(cond).length > 0) out.condition = cond;
    }
    return out;
}

async function save() {
    errors.key = form.key.trim() ? '' : 'Key is required';
    errors.name = form.name.trim() ? '' : 'Name is required';
    const validated = validate();
    if (errors.key || errors.name || !validated) return;

    saving.value = true;
    try {
        if (editingId.value) {
            const ok = await store.update({
                id: editingId.value,
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                statements: validated
            });
            if (ok) {
                toast.success('Persona updated');
                closeModal();
            }
        } else {
            const created = await store.create({
                key: form.key.trim(),
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                statements: validated
            });
            if (created) {
                toast.success('Persona created');
                closeModal();
            }
        }
    } finally {
        saving.value = false;
    }
}

type ConfirmationModalHandle = ComponentPublicInstance & {
    storeAction: (action: () => Promise<unknown>) => void;
};
const deleteRef = ref<ConfirmationModalHandle | null>(null);
const deleteTargetName = ref('');

function confirmDelete(p: PersonaResponse) {
    deleteTargetName.value = p.name;
    deleteRef.value?.storeAction(async () => {
        const ok = await store.remove(p.id);
        if (ok) toast.success('Persona deleted');
    });
}

function summarizeStatement(s: PersonaStatement): string {
    const verb = s.effect === 'Allow' ? 'Allow' : 'Deny';
    const acts = s.actions.join(', ') || '(none)';
    const res = s.resource_types.join(', ') || '(none)';
    let out = `${verb} ${acts} on ${res}`;
    if (s.not_actions?.length) out += ` except actions ${s.not_actions.join(', ')}`;
    if (s.not_resource_types?.length)
        out += ` except resources ${s.not_resource_types.join(', ')}`;
    const conds: string[] = [];
    if (s.condition?.mfa?.required) conds.push('MFA');
    if (s.condition?.ip?.cidrs?.length)
        conds.push(`IP ${s.condition.ip.cidrs.join('/')}`);
    if (s.condition?.time?.window) conds.push('time-window');
    if (conds.length) out += ` (when: ${conds.join(', ')})`;
    return out;
}

function summarize(stmts: PersonaStatement[]): string {
    if (!stmts || stmts.length === 0) return '—';
    if (stmts.length === 1) return summarizeStatement(stmts[0]);
    return `${summarizeStatement(stmts[0])} (+${stmts.length - 1} more)`;
}
</script>

<style scoped>
.personas-layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-3);
}
/* Same panel language as the Users page — head row with the search
   centered and the action on the right, no title header. */
.personas-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
}
.personas-panel__head {
    display: flex;
    align-items: center;
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.personas-search {
    margin: 0 auto;
    max-width: 240px;
    min-width: 140px;
}
.persona-kind {
    display: inline-block;
    padding: var(--space-px) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.persona-kind--system {
    color: var(--color-info-text);
    background-color: var(--color-info-subtle);
}
.persona-kind--custom {
    color: var(--color-success-text);
    background-color: var(--color-success-subtle);
}
.persona-stmt-count {
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
}
.persona-summary {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.persona-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--btn-h-sm);
    height: var(--btn-h-sm);
    border: none;
    border-radius: var(--radius-md);
    color: var(--color-primary-text);
    background: transparent;
    cursor: pointer;
    transition: background-color var(--duration-fast);
}
.persona-action-btn:hover:not(:disabled) {
    background-color: var(--color-primary-subtle);
}
.persona-action-btn:disabled {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
}
.persona-action-btn--danger {
    color: var(--color-danger-text);
}
.persona-action-btn--danger:hover:not(:disabled) {
    background-color: var(--color-danger-subtle);
}

/* ── Persona modal ── */
.persona-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}
.persona-form__grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
}
@media (min-width: 768px) {
    .persona-form__grid {
        grid-template-columns: 1fr 1fr;
    }
}
.persona-error {
    color: var(--color-danger-text);
    font-size: var(--type-body);
}

.persona-stmts {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.persona-stmts__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.persona-stmts__title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.persona-stmts__hint {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.persona-stmts__hint code {
    font-family: var(--font-mono);
    color: var(--color-text-secondary);
}

/* Statement card */
.persona-stmt {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-2);
    transition: border-color var(--duration-fast);
}
.persona-stmt--deny {
    border-color: color-mix(
        in srgb,
        var(--color-danger-text) 35%,
        transparent
    );
    background-color: var(--color-danger-subtle);
}

.persona-stmt__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.persona-stmt__effect {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    padding: var(--space-px);
    background-color: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
}
.persona-effect-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition:
        background-color var(--duration-fast),
        color var(--duration-fast);
}
.persona-effect-pill:hover {
    color: var(--color-text-primary);
}
.persona-effect-pill--on {
    color: var(--color-text-primary);
}
.persona-effect-pill--allow.persona-effect-pill--on {
    background-color: var(--color-success-subtle);
    color: var(--color-success-text);
}
.persona-effect-pill--deny.persona-effect-pill--on {
    background-color: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
.persona-stmt__summary {
    margin: 0;
    flex: 1;
    min-width: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.persona-stmt__remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--btn-h-sm);
    height: var(--btn-h-sm);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition:
        color var(--duration-fast),
        background-color var(--duration-fast);
}
.persona-stmt__remove:hover {
    background-color: var(--color-danger-subtle);
    color: var(--color-danger-text);
}

.persona-stmt__body {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
}
@media (min-width: 768px) {
    .persona-stmt__body {
        grid-template-columns: 1fr 1fr;
    }
}
.persona-stmt__advanced {
    margin: 0 calc(-1 * var(--space-2));
}
.persona-stmt__advanced-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.persona-stmt__time {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
}
@media (min-width: 768px) {
    .persona-stmt__time {
        grid-template-columns: 1fr 1fr;
    }
}

.persona-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}
</style>
