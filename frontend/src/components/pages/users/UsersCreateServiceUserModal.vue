<template>
    <Modal :visible="visible" @close="$emit('close')">
        <template #title>
            {{ result ? 'Service user created' : 'Create service user' }}
        </template>

        <template #default>
            <!-- Phase 2 — reveal once -->
            <div v-if="result" class="suc-reveal">
                <div class="suc-reveal__badge">
                    <i class="fas fa-circle-check" aria-hidden="true" />
                </div>
                <h3 class="suc-reveal__title">
                    {{ result.userName }} is ready
                </h3>
                <p class="suc-reveal__sub">
                    This is the only time the API key is shown. Copy it now and
                    store it somewhere safe.
                </p>
                <SecretReveal :token="result.token" @copy="$emit('copy')" />
                <p
                    v-if="result.name || result.expirationDate"
                    class="suc-reveal__meta"
                >
                    <span v-if="result.name">{{ result.name }}</span>
                    <span v-if="result.expirationDate">
                        · Expires
                        {{ new Date(result.expirationDate).toLocaleDateString() }}
                    </span>
                </p>
            </div>

            <!-- Phase 1 — three small steps, one decision per step -->
            <div v-else class="suc-wizard">
                <ol class="suc-steps" aria-label="Create service user steps">
                    <li
                        v-for="(s, i) in steps"
                        :key="s.key"
                        class="suc-steps__item"
                    >
                        <button
                            type="button"
                            class="suc-steps__btn"
                            :class="{
                                'suc-steps__btn--active': step === s.key,
                                'suc-steps__btn--done': s.done,
                                'suc-steps__btn--invalid': s.invalid
                            }"
                            :disabled="!s.reachable"
                            :aria-current="step === s.key ? 'step' : undefined"
                            @click="step = s.key"
                        >
                            <span class="suc-steps__num" aria-hidden="true">
                                <i v-if="s.done" class="fas fa-check" />
                                <template v-else>{{ i + 1 }}</template>
                            </span>
                            {{ s.label }}
                        </button>
                    </li>
                </ol>

                <div class="suc-wizard__panel">
                    <template v-if="step === 'details'">
                        <p class="suc__hint">
                            A service user is for scripts and integrations. It
                            signs in with an API key instead of a password.
                        </p>
                        <FormField label="Name" :error="errors.name">
                            <Input
                                v-model="form.name"
                                placeholder="e.g. CI pipeline"
                            />
                        </FormField>
                        <FormField
                            label="Username"
                            :error="errors.userName"
                            hint="Used in API calls — generated from the name."
                        >
                            <Input
                                :model-value="form.userName"
                                placeholder="ci-pipeline"
                                @update:model-value="onUserNameInput"
                            />
                        </FormField>
                        <FormField label="Description" optional>
                            <Input
                                v-model="form.description"
                                placeholder="What is this user for?"
                            />
                        </FormField>
                    </template>

                    <template v-else-if="step === 'access'">
                        <FormField label="Role">
                            <Dropdown
                                :groups="personaOptions"
                                :default="form.personaId"
                                searchable
                                @selected="
                                    (v: unknown) => (form.personaId = String(v))
                                "
                            />
                        </FormField>
                        <FormField label="What can it access?">
                            <ScopeModeSelector
                                v-model:scope-all="form.scopeAll"
                                v-model:scope="form.scope"
                                :persona-key="personaKey"
                            />
                        </FormField>
                        <template v-if="grantIsHighRisk">
                            <FormField
                                label="Why full access?"
                                hint="Required for full Admin or Manager access — kept in the audit log."
                            >
                                <Input
                                    v-model="form.accessReason"
                                    placeholder="e.g. CI needs to manage all devices"
                                />
                            </FormField>
                            <FormField label="Access expires after">
                                <Dropdown
                                    :groups="GRANT_EXPIRY_GROUPS"
                                    :default="form.accessExpiresDays"
                                    @selected="
                                        (v: unknown) =>
                                            (form.accessExpiresDays = String(v))
                                    "
                                />
                            </FormField>
                        </template>
                        <p class="suc__hint">
                            One role is enough to start. You can add more later
                            under Edit → Assignments.
                        </p>
                    </template>

                    <template v-else>
                        <FormField label="Key expires after">
                            <Dropdown
                                :groups="GRANT_EXPIRY_GROUPS"
                                :default="form.expirationDays"
                                @selected="
                                    (v: unknown) =>
                                        (form.expirationDays = String(v))
                                "
                            />
                        </FormField>
                        <FormField
                            label="Key label"
                            optional
                            hint="Helps you tell keys apart later."
                        >
                            <Input
                                v-model="form.keyName"
                                placeholder="e.g. CI runner"
                            />
                        </FormField>

                        <div class="suc-summary">
                            <span class="suc-summary__title">
                                Ready to create
                            </span>
                            <ul class="suc-summary__list">
                                <li>
                                    <i class="fas fa-robot" aria-hidden="true" />
                                    {{ form.name || 'Unnamed' }}
                                    <code>{{ form.userName }}</code>
                                </li>
                                <li>
                                    <i
                                        class="fas fa-id-badge"
                                        aria-hidden="true"
                                    />
                                    {{ personaLabel }} — {{ scopeSummary }}
                                </li>
                                <li v-if="grantIsHighRisk">
                                    <i
                                        class="fas fa-clipboard-check"
                                        aria-hidden="true"
                                    />
                                    {{ form.accessReason || 'No reason yet' }}
                                    · access expires in
                                    {{ form.accessExpiresDays }} days
                                </li>
                                <li>
                                    <i class="fas fa-key" aria-hidden="true" />
                                    API key shown once, expires in
                                    {{ form.expirationDays }} days
                                </li>
                            </ul>
                        </div>
                    </template>
                </div>
            </div>
        </template>

        <template #footer>
            <div class="suc-footer">
                <template v-if="result">
                    <Button type="blue-hollow" @click="$emit('download')">
                        <i class="fas fa-download" aria-hidden="true" /> Download
                    </Button>
                    <Button type="green" @click="$emit('done')">Done</Button>
                </template>
                <template v-else>
                    <Button type="blue-hollow" @click="$emit('close')">
                        Cancel
                    </Button>
                    <Button
                        v-if="step !== 'details'"
                        type="blue-hollow"
                        @click="goBack"
                    >
                        Back
                    </Button>
                    <Button
                        v-if="step !== 'key'"
                        type="green"
                        :disabled="!canAdvance"
                        @click="goNext"
                    >
                        Next
                    </Button>
                    <Button
                        v-else
                        type="green"
                        :loading="creating"
                        :disabled="!detailsReady || !accessReady"
                        @click="$emit('submit')"
                    >
                        Create &amp; generate key
                    </Button>
                </template>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import ScopeModeSelector from '@/components/core/ScopeModeSelector.vue';
import SecretReveal from '@/components/core/SecretReveal.vue';
import Modal from '@/components/modals/Modal.vue';
import {buildScope, type ScopeSelection} from '@/helpers/scopeDimensions';
import {serviceUserScopeLabel} from '@/helpers/serviceUserAccessPlan';
import {
    deriveServiceUsername,
    GRANT_EXPIRY_OPTIONS,
    serviceUserAccessReady,
    serviceUserGrantIsHighRisk
} from '@/helpers/serviceUserCreate';

export interface ServiceRoleGroup {
    label: string;
    items: {value: string; label: string}[];
}

export interface ServiceUserCreateForm {
    userName: string;
    name: string;
    description: string;
    personaId: string;
    scopeAll: boolean;
    scope: ScopeSelection;
    accessReason: string;
    accessExpiresDays: string;
    keyName: string;
    expirationDays: string;
}

export interface ServiceUserCreateErrors {
    userName: string;
    name: string;
}

// The minted key, surfaced once on the reveal screen.
export interface ServiceUserCreatedKey {
    userName: string;
    token: string;
    name?: string;
    expirationDate?: string;
}

type WizardStep = 'details' | 'access' | 'key';
const STEP_ORDER: WizardStep[] = ['details', 'access', 'key'];

// One duration list for both the key lifetime and the grant expiry.
const GRANT_EXPIRY_GROUPS: ServiceRoleGroup[] = [
    {label: '', items: [...GRANT_EXPIRY_OPTIONS]}
];

const props = defineProps<{
    visible: boolean;
    creating: boolean;
    form: ServiceUserCreateForm;
    errors: ServiceUserCreateErrors;
    personaOptions: ServiceRoleGroup[];
    // System-role key of the picked role; narrows offered scope kinds.
    personaKey?: string;
    result: ServiceUserCreatedKey | null;
}>();

defineEmits<{
    close: [];
    submit: [];
    copy: [];
    download: [];
    done: [];
}>();

const step = ref<WizardStep>('details');
const usernameTouched = ref(false);

watch(
    () => props.visible,
    (open) => {
        if (!open) return;
        step.value = 'details';
        usernameTouched.value = false;
    }
);

// The username follows the friendly name until the user edits it directly.
watch(
    () => props.form.name,
    (name) => {
        if (usernameTouched.value) return;
        props.form.userName = deriveServiceUsername(name);
    }
);

// A rejected submit flags identity fields — walk back to the step that owns
// them instead of leaving the user stranded on the key step.
watch(
    () => [props.errors.name, props.errors.userName],
    (errors) => {
        if (errors.some(Boolean)) step.value = 'details';
    }
);

function onUserNameInput(value: string | number): void {
    const text = String(value);
    props.form.userName = text;
    // Clearing the field is "give me the generated name back" — auto-derive
    // resumes; any other edit pins the username.
    usernameTouched.value = text !== '';
}

const detailsReady = computed(
    () => props.form.name.trim() !== '' && props.form.userName.trim() !== ''
);
const grantIsHighRisk = computed(() =>
    serviceUserGrantIsHighRisk(props.form, props.personaKey)
);
const accessReady = computed(() =>
    serviceUserAccessReady(props.form, props.personaKey)
);

const canAdvance = computed(() =>
    step.value === 'details' ? detailsReady.value : accessReady.value
);

function goNext(): void {
    const index = STEP_ORDER.indexOf(step.value);
    const next = STEP_ORDER[index + 1];
    if (next) step.value = next;
}

function goBack(): void {
    const index = STEP_ORDER.indexOf(step.value);
    const previous = STEP_ORDER[index - 1];
    if (previous) step.value = previous;
}

interface WizardStepItem {
    key: WizardStep;
    label: string;
    done: boolean;
    // A step opens only once every step before it is complete.
    reachable: boolean;
    invalid: boolean;
}

const steps = computed<WizardStepItem[]>(() => [
    {
        key: 'details',
        label: 'Details',
        done: detailsReady.value,
        reachable: true,
        invalid: !!(props.errors.name || props.errors.userName)
    },
    {
        key: 'access',
        label: 'Access',
        done: accessReady.value,
        reachable: detailsReady.value,
        invalid: false
    },
    {
        key: 'key',
        label: 'API key',
        done: false,
        reachable: detailsReady.value && accessReady.value,
        invalid: false
    }
]);

const personaLabel = computed(() => {
    for (const group of props.personaOptions) {
        const match = group.items.find(
            (item) => item.value === props.form.personaId
        );
        if (match) return match.label;
    }
    return 'No role picked';
});

const scopeSummary = computed(() => {
    const scope = buildScope(props.form.scopeAll, props.form.scope);
    return scope ? serviceUserScopeLabel(scope) : 'no resources picked yet';
});
</script>

<style scoped>
.suc-wizard {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
}
.suc-wizard__panel {
    display: grid;
    gap: var(--gap-md);
}

.suc-steps {
    display: flex;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
.suc-steps__item {
    flex: 1;
    display: flex;
}
.suc-steps__btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    box-shadow: inset 0 -2px 0 transparent;
    transition:
        background var(--motion-hover),
        color var(--motion-hover),
        box-shadow var(--motion-state);
}
.suc-steps__btn:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.suc-steps__btn:disabled {
    cursor: not-allowed;
    opacity: var(--opacity-disabled);
}
.suc-steps__btn--invalid {
    box-shadow: inset 0 -2px 0 var(--color-danger-text);
}
.suc-steps__btn--active {
    background: color-mix(
        in srgb,
        var(--color-primary) 12%,
        var(--color-surface-2)
    );
    color: var(--color-text-primary);
    box-shadow: inset 0 -2px 0 var(--color-primary);
}
.suc-steps__num {
    display: inline-grid;
    place-items: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.suc-steps__btn--active .suc-steps__num {
    background: var(--color-primary);
    color: var(--color-text-on-primary);
}
.suc-steps__btn--done .suc-steps__num {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
}
.suc__hint {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    line-height: var(--leading-snug);
}
.suc-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--gap-sm);
}

.suc-summary {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}
.suc-summary__title {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.suc-summary__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--type-body);
    color: var(--color-text-primary);
}
.suc-summary__list i {
    width: var(--space-5);
    color: var(--color-text-tertiary);
}
.suc-summary__list code {
    margin-left: var(--space-1);
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
}

/* Reveal — a distinct, centered success state, not a field tacked onto a form. */
.suc-reveal {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gap-sm);
    text-align: center;
    padding: var(--gap-sm) 0;
}
.suc-reveal__badge {
    width: var(--space-16);
    height: var(--space-16);
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    background: var(--color-success-subtle);
    color: var(--color-success-text);
    font-size: var(--icon-size-lg);
}
.suc-reveal__title {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.suc-reveal__sub {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    line-height: var(--leading-snug);
}
.suc-reveal__meta {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>
