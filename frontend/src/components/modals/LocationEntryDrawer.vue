<template>
    <Teleport to="body">
        <Transition name="led-fade">
            <div v-if="visible" class="led-root" role="dialog" aria-modal="true" :aria-label="modeLabel">
                <div class="led-scrim" @click="onBackdropClick" />
                <aside class="led-panel">
                    <header class="led-head">
                        <div class="led-head__row">
                            <h2 class="led-title">{{ modeLabel }}</h2>
                            <button
                                type="button"
                                class="led-close"
                                title="Close"
                                @click="close"
                            >
                                <i class="fas fa-xmark" aria-hidden="true" />
                            </button>
                        </div>
                        <nav class="led-steps" aria-label="Steps">
                            <button
                                v-for="step in visibleSteps"
                                :key="step.id"
                                type="button"
                                class="led-step"
                                :class="{
                                    'led-step--active': step.id === currentStep,
                                    'led-step--done': step.id < currentStep,
                                    'led-step--error': stepHasError(step.id)
                                }"
                                :disabled="!canEnterStep(step.id)"
                                @click="goToStep(step.id)"
                            >
                                <span class="led-step__num">
                                    <span v-if="stepHasError(step.id)" class="led-step__err-dot" aria-label="Has errors" />
                                    <template v-else>{{ step.id }}</template>
                                </span>
                                <span class="led-step__label">{{ step.label }}</span>
                                <span v-if="step.optional" class="led-step__tag">Optional</span>
                            </button>
                        </nav>
                    </header>

                    <!-- Server-error banner ─────────────────────────────────── -->
                    <div v-if="serverError" class="led-banner" role="alert">
                        <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                        <span class="led-banner__msg">{{ serverError }}</span>
                        <button
                            type="button"
                            class="led-banner__close"
                            title="Dismiss"
                            @click="serverError = null"
                        >
                            <i class="fas fa-xmark" aria-hidden="true" />
                        </button>
                    </div>

                    <div class="led-body">
                        <LocationEntryDrawerStep1
                            v-show="currentStep === 1"
                            v-model:kind="formKind"
                            v-model:name="formName"
                            v-model:parent="formParent"
                            :kind-options="kindOptions"
                            :kind-hint="kindHint"
                            :kind-disabled="props.mode === 'edit'"
                            :parent-required="parentRequired"
                            :exclude-parent-id="props.initial?.id"
                            :name-error="nameError"
                            :parent-error="parentError"
                            @blur-name="applyNameValidation"
                        />

                        <!-- ═══ Step 2 — Place on map ═══ -->
                        <LocationEntryDrawerStep2
                            v-show="currentStep === 2"
                            v-model:geo="geo"
                            v-model:precision="precision"
                            v-model:has-pin="hasPin"
                            v-model:what3words-error="what3wordsError"
                            v-model:manual-error="manualError"
                            :is-active="currentStep === 2 && needsAddressStep"
                            :kind-fields="formKindFields"
                            @set-kind-field="onStep3SetKindField"
                        />

                        <!-- ═══ Step 3 — Details (optional) ═══ -->
                        <LocationEntryDrawerStep3
                            v-show="currentStep === 3"
                            v-model:tag-draft="tagDraft"
                            v-model:notes="notes"
                            :kind-fields="formKindFields"
                            :location-id="props.initial?.id ?? null"
                            :can-show-floor-plan="canShowFloorPlan"
                            :has-operating-hours-field="hasOperatingHoursField"
                            :detail-groups="detailGroups"
                            :option-sets="optionSets"
                            :tags="tags"
                            :tag-error="tagError"
                            :notes-error="notesError"
                            @set-kind-field="onStep3SetKindField"
                            @remove-tag="removeTag"
                            @commit-tag="commitTag"
                            @tag-backspace="onTagBackspace"
                            @clear-tag-error="tagError = ''"
                        />
                    </div>

                    <footer class="led-foot">
                        <Button
                            v-if="currentStep > 1"
                            type="blue-hollow"
                            @click="goBackStep"
                        >Back</Button>
                        <span class="led-foot__spacer" />
                        <Button type="blue-hollow" @click="close">Cancel</Button>
                        <!-- Step 2 — secondary "Save and add details later" -->
                        <Button
                            v-if="currentStep === 2"
                            type="blue-hollow"
                            :loading="saving"
                            :disabled="!canSave"
                            :requires-write="true"
                            @click="handleSave"
                        >
                            Save and add details later
                        </Button>
                        <Button
                            v-if="currentStep < lastStepId"
                            type="blue-hollow"
                            :disabled="!canEnterStep(currentStep + 1)"
                            @click="goForwardStep"
                        >
                            Continue
                        </Button>
                        <!-- Final-step primary save -->
                        <Button
                            v-if="currentStep === lastStepId"
                            type="green"
                            :loading="saving"
                            :disabled="!canSave"
                            :requires-write="true"
                            @click="handleSave"
                        >
                            {{ props.mode === 'create' ? 'Save location' : 'Save changes' }}
                        </Button>
                    </footer>
                </aside>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import type {
    Location as ApiLocation,
    LocationKind,
    LocationKindFields
} from '@api/location';
import {storeToRefs} from 'pinia';
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import type {FloorPlanValue} from '@/components/core/FloorPlanScaleEditor.vue';
import FloorPlanScaleEditor from '@/components/core/FloorPlanScaleEditor.vue';
import Input from '@/components/core/Input.vue';
import LocationFieldRenderer from '@/components/core/LocationFieldRenderer.vue';
import LocationParentPicker from '@/components/core/LocationParentPicker.vue';
import type {OperatingHoursValue} from '@/components/core/OperatingHoursGrid.vue';
import OperatingHoursGrid from '@/components/core/OperatingHoursGrid.vue';
import {
    clampStepForKind,
    type GeoPrecision,
    type GeoState,
    kindRequiresAddress,
    kindRequiresParent,
    MAX_NOTES_LENGTH,
    nameContentErrorMessage,
    notesErrorMessage,
    type TagRejectionReason,
    tagRejectionReason,
    visibleStepsForKind,
    type WizardStep
} from '@/helpers/location-drawer-steps';
import {isPlanFriendlyKind} from '@/helpers/location-kinds';
import {NAME_MAX_LENGTH} from '@/helpers/validation-limits';
import {
    type LocationFieldDescriptor,
    type LocationFieldGroup,
    useLocationsStore
} from '@/stores/locations';
import LocationEntryDrawerStep1 from './LocationEntryDrawerStep1.vue';
import LocationEntryDrawerStep2 from './LocationEntryDrawerStep2.vue';
import LocationEntryDrawerStep3 from './LocationEntryDrawerStep3.vue';

interface KindOption {
    value: LocationKind;
    label: string;
    icon: string;
    hint: string;
}

// UI labels for kinds. requiresAddress/requiresParent live in
// location-drawer-steps to keep one home for rule logic.
const KIND_OPTIONS: KindOption[] = [
    {
        value: 'site',
        label: 'Site',
        icon: 'fas fa-map-location-dot',
        hint: 'A campus, facility, or geographic site. Has its own address.'
    },
    {
        value: 'building',
        label: 'Building',
        icon: 'fas fa-building',
        hint: 'A structure with its own address. Can belong to a site.'
    },
    {
        value: 'floor',
        label: 'Floor',
        icon: 'fas fa-layer-group',
        hint: 'A level inside a building. Inherits address from the building.'
    },
    {
        value: 'room',
        label: 'Room',
        icon: 'fas fa-door-open',
        hint: 'A room or zone inside a floor. Inherits address from above.'
    }
];

const GROUP_LABELS: Record<LocationFieldGroup, string> = {
    identity: 'Identity',
    physical: 'Physical',
    contact: 'Contact',
    hours: 'Hours',
    operational: 'Operational',
    compliance: 'Compliance',
    environmental: 'Environmental',
    custom: 'Other'
};
const GROUP_ICONS: Record<LocationFieldGroup, string> = {
    identity: 'fas fa-id-card',
    physical: 'fas fa-cube',
    contact: 'fas fa-address-book',
    hours: 'fas fa-clock',
    operational: 'fas fa-gears',
    compliance: 'fas fa-shield-halved',
    environmental: 'fas fa-leaf',
    custom: 'fas fa-tags'
};

// Fields that already have dedicated UI elsewhere — skipped by the generic
// step-3 LocationFieldRenderer loop to avoid duplicate inputs.
const STEP2_FIELD_KEYS = new Set(['address', 'geo']);
const STEP3_BESPOKE_FIELD_WIDGETS = new Set([
    'address',
    'geo',
    'floorPlan',
    'operatingHours'
]);

const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    mode: 'create' | 'edit';
    initial?: ApiLocation | null;
    defaultParentId?: number | null;
    /** Pre-select a step on open (1-based). Falls back to 1. */
    defaultStep?: number;
}>();

const emit = defineEmits<{saved: [ApiLocation]}>();

const store = useLocationsStore();
const {kinds, optionSets} = storeToRefs(store);

const formName = ref('');
const formKind = ref<LocationKind>('site');
const formParent = ref<number | null>(null);
const formKindFields = ref<Record<string, unknown>>({});
const nameError = ref('');
const parentError = ref('');
const saving = ref(false);
const currentStep = ref<number>(1);
const serverError = ref<string | null>(null);

// Step 2 state — owned here so the parent can gate save validation on
// what3words / manual-coord errors and round-trip through resetForm().
// Step 2's sub-component reads + writes via v-model bindings.
const geo = ref<GeoState>({lat: 0, lng: 0});
const hasPin = ref(false);
const precision = ref<GeoPrecision>('geocoded');
const what3wordsError = ref('');
const manualError = ref('');

// Step 3 state — tags + notes (with their own per-field error state).
const tags = ref<string[]>([]);
const tagDraft = ref('');
const tagError = ref('');
const notes = ref('');
const notesError = computed(() => notesErrorMessage(notes.value));

// ─────────────────────────────────────────────────────────────────────────
// Derived state
// ─────────────────────────────────────────────────────────────────────────

const modeLabel = computed(() =>
    props.mode === 'create'
        ? 'New location'
        : `Edit "${props.initial?.name ?? ''}"`
);

const kindOptions = KIND_OPTIONS;
const currentKind = computed(
    () => KIND_OPTIONS.find((k) => k.value === formKind.value) ?? KIND_OPTIONS[0]
);
const kindHint = computed(() => currentKind.value.hint);
const parentRequired = computed(() => kindRequiresParent(formKind.value));
const needsAddressStep = computed(() => kindRequiresAddress(formKind.value));

const visibleSteps = computed<WizardStep[]>(() =>
    visibleStepsForKind(formKind.value)
);
const lastStepId = computed(
    () => visibleSteps.value[visibleSteps.value.length - 1]?.id ?? 1
);

// Step 3 — only show groups that exist for this kind AND aren't covered by
// dedicated step-3 components or step 2.
interface DetailGroup {
    key: LocationFieldGroup;
    label: string;
    icon: string;
    fields: LocationFieldDescriptor[];
}
const detailGroups = computed<DetailGroup[]>(() => {
    const descriptor = kinds.value.find((k) => k.kind === formKind.value);
    if (!descriptor) return [];
    const buckets = new Map<LocationFieldGroup, LocationFieldDescriptor[]>();
    for (const f of descriptor.fields) {
        if (STEP2_FIELD_KEYS.has(f.widget)) continue;
        if (STEP3_BESPOKE_FIELD_WIDGETS.has(f.widget)) continue;
        const list = buckets.get(f.group) ?? [];
        list.push(f);
        buckets.set(f.group, list);
    }
    const out: DetailGroup[] = [];
    for (const [key, fields] of buckets) {
        if (fields.length === 0) continue;
        out.push({
            key,
            label: GROUP_LABELS[key] ?? key,
            icon: GROUP_ICONS[key] ?? 'fas fa-circle',
            fields
        });
    }
    return out;
});

const canShowFloorPlan = computed(() => isPlanFriendlyKind(formKind.value));

const hasOperatingHoursField = computed(() => {
    const descriptor = kinds.value.find((k) => k.kind === formKind.value);
    return !!descriptor?.fields.some((f) => f.widget === 'operatingHours');
});

function canEnterStep(id: number): boolean {
    if (id <= currentStep.value) return true;
    if (nameErrorMessage(formName.value)) return false;
    if (parentErrorMessage(formKind.value, formParent.value)) return false;
    return true;
}

function stepHasError(id: number): boolean {
    if (id === 1) return !!nameError.value || !!parentError.value;
    if (id === 2) return !!what3wordsError.value || !!manualError.value;
    return false;
}

function goToStep(id: number): void {
    if (!canEnterStep(id)) return;
    if (id === 2 && !needsAddressStep.value) {
        currentStep.value = 3;
        return;
    }
    currentStep.value = id;
}

function goForwardStep(): void {
    goToStep(currentStep.value + 1);
}
function goBackStep(): void {
    if (currentStep.value === 3 && !needsAddressStep.value) {
        currentStep.value = 1;
        return;
    }
    if (currentStep.value > 1) currentStep.value -= 1;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation — pure Answer functions; Do functions apply them to refs.
// ─────────────────────────────────────────────────────────────────────────

// Answer — message describing why a name is invalid, or '' for valid.
function nameErrorMessage(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return 'Name is required';
    if (trimmed.length > NAME_MAX_LENGTH)
        return `Max ${NAME_MAX_LENGTH} characters`;
    const contentIssue = nameContentErrorMessage(name);
    if (contentIssue) return contentIssue;
    return '';
}

// Answer — message describing why parent is invalid, or '' for valid.
function parentErrorMessage(kind: LocationKind, parentId: number | null): string {
    if (kindRequiresParent(kind) && parentId == null) {
        return 'A parent is required for this kind';
    }
    return '';
}

// Do — apply name validation to the ref. Returns valid bool for caller flow.
function applyNameValidation(): boolean {
    nameError.value = nameErrorMessage(formName.value);
    return nameError.value === '';
}

// Do — apply parent validation to the ref. Returns valid bool for caller flow.
function applyParentValidation(): boolean {
    parentError.value = parentErrorMessage(formKind.value, formParent.value);
    return parentError.value === '';
}

const canSave = computed(() => {
    if (saving.value) return false;
    if (nameErrorMessage(formName.value)) return false;
    if (parentErrorMessage(formKind.value, formParent.value)) return false;
    if (what3wordsError.value) return false;
    if (notesError.value) return false;
    return true;
});

// ─────────────────────────────────────────────────────────────────────────
// Form state helpers
// ─────────────────────────────────────────────────────────────────────────

function setKindField(key: string, v: unknown): void {
    const next = {...formKindFields.value};
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
        delete next[key];
    } else {
        next[key] = v;
    }
    formKindFields.value = next;
}

// Step 3 emits {key, value} bundles — keep setKindField positional and
// adapt at the boundary so the existing call sites stay untouched.
function onStep3SetKindField(args: {key: string; value: unknown}): void {
    setKindField(args.key, args.value);
}

function close(): void {
    visible.value = false;
}
function onBackdropClick(): void {
    close();
}

function resetForm(): void {
    const t = props.initial;
    formName.value = t?.name ?? '';
    formKind.value = t?.kind ?? 'site';
    formParent.value = t?.parentLocationId ?? props.defaultParentId ?? null;
    formKindFields.value = {...(t?.kindFields ?? {})};
    nameError.value = '';
    parentError.value = '';
    what3wordsError.value = '';
    manualError.value = '';
    serverError.value = null;
    tagError.value = '';
    tags.value = [];
    tagDraft.value = '';
    notes.value = '';
    currentStep.value = clampStepForKind(
        props.defaultStep ?? 1,
        formKind.value
    );
    const priorGeo = (t?.kindFields as Record<string, unknown> | undefined)
        ?.geo as {lat?: number; lng?: number; precision?: GeoPrecision} | undefined;
    if (priorGeo?.lat != null && priorGeo?.lng != null) {
        geo.value = {lat: priorGeo.lat, lng: priorGeo.lng};
        precision.value = priorGeo.precision ?? 'geocoded';
        hasPin.value = true;
    } else {
        hasPin.value = false;
        precision.value = 'geocoded';
    }
    const priorNotes = (t?.kindFields as Record<string, unknown> | undefined)
        ?.notes;
    if (typeof priorNotes === 'string') notes.value = priorNotes;
    const priorTags = (t?.kindFields as Record<string, unknown> | undefined)
        ?.tags;
    if (Array.isArray(priorTags)) {
        tags.value = priorTags.filter((x): x is string => typeof x === 'string');
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Tag chip input
// ─────────────────────────────────────────────────────────────────────────

function commitTag(): void {
    const t = tagDraft.value.trim().toLowerCase();
    if (!t) return;
    const reason = tagRejectionReason({candidate: t, existing: tags.value});
    if (reason) {
        tagError.value = tagRejectionMessage(reason);
        return;
    }
    tags.value = [...tags.value, t];
    tagDraft.value = '';
    tagError.value = '';
}

// Answer — user-facing reason text for a tag-rejection code.
function tagRejectionMessage(reason: TagRejectionReason): string {
    switch (reason) {
        case 'empty':
            return 'Tags cannot be empty.';
        case 'length':
            return 'Tag is too long.';
        case 'format':
            return 'Tags must start with a letter or number; only letters, numbers, dot, dash, and underscore are allowed.';
        case 'duplicate':
            return 'That tag is already in the list.';
        case 'count':
            return 'You have reached the maximum number of tags.';
    }
}

function removeTag(i: number): void {
    const next = [...tags.value];
    next.splice(i, 1);
    tags.value = next;
}

function onTagBackspace(): void {
    if (tagDraft.value.length === 0 && tags.value.length > 0) {
        const next = [...tags.value];
        next.pop();
        tags.value = next;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────

watch(visible, (open) => {
    if (open) {
        resetForm();
        void store.fetchKinds();
    }
    // Map instance lifecycle (mount/remove) is owned by the Step 2
    // sub-component; nothing to clean up here.
});

watch(formKind, () => {
    if (!parentRequired.value) parentError.value = '';
});

// ─────────────────────────────────────────────────────────────────────────
// Save — high-level orchestration kept slim; error handling separated from
// the business logic that builds + sends the payload.
// ─────────────────────────────────────────────────────────────────────────

async function handleSave(): Promise<void> {
    if (!isSaveAllowed()) return;
    saving.value = true;
    serverError.value = null;
    try {
        const saved = await persistLocation();
        if (!saved) {
            serverError.value = saveRejectedMessage();
            return;
        }
        emit('saved', saved);
        close();
    } catch (err: unknown) {
        serverError.value = readSaveErrorMessage(err);
    } finally {
        saving.value = false;
    }
}

// Answer — all validation passed and we can submit.
function isSaveAllowed(): boolean {
    const nameOk = applyNameValidation();
    const parentOk = applyParentValidation();
    if (!nameOk || !parentOk) return false;
    if (what3wordsError.value) return false;
    return true;
}

// Answer — kindFields payload assembled from current form state. Backend
// kindSchemas accept geo.precision, tags, and notes on every kind.
function buildKindFieldsPayload(): LocationKindFields {
    const out: Record<string, unknown> = {...formKindFields.value};
    if (hasPin.value) {
        out.geo = {
            lat: geo.value.lat,
            lng: geo.value.lng,
            precision: precision.value
        };
    }
    if (tags.value.length > 0) {
        out.tags = [...tags.value];
    } else {
        delete out.tags;
    }
    const trimmedNotes = notes.value.trim();
    if (trimmedNotes) {
        out.notes = trimmedNotes;
    } else {
        delete out.notes;
    }
    return out as LocationKindFields;
}

// Do — dispatch create or update against the store, returning the saved row.
async function persistLocation(): Promise<ApiLocation | null> {
    const name = formName.value.trim();
    const kindFields = buildKindFieldsPayload();
    if (props.mode === 'create') {
        return store.createLocation({
            name,
            kind: formKind.value,
            parentLocationId: formParent.value,
            kindFields,
            customFields: {}
        });
    }
    if (!props.initial) return null;
    return store.updateLocation(props.initial.id, {
        name,
        parentLocationId: formParent.value,
        kindFields,
        customFields: props.initial.customFields ?? {}
    });
}

// Answer — copy shown when the server returns null (rejection without throw).
function saveRejectedMessage(): string {
    return props.mode === 'create'
        ? 'Save failed — the server rejected the location. Check the highlighted fields and try again.'
        : 'Update failed — the server rejected the change. Check the highlighted fields and try again.';
}

// Answer — best human-readable message for a thrown save error.
function readSaveErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return 'Save failed unexpectedly.';
}
</script>

<style scoped>
/* ── Root + scrim ─────────────────────────────────────────────────────── */
.led-root {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    justify-content: flex-end;
}
.led-scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
}

/* ── Drawer panel ─────────────────────────────────────────────────────── */
.led-panel {
    position: relative;
    width: min(720px, 100vw);
    height: 100%;
    display: flex;
    flex-direction: column;
    background: rgba(28, 30, 34, 0.92);
    backdrop-filter: blur(28px) saturate(180%);
    -webkit-backdrop-filter: blur(28px) saturate(180%);
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.08),
        -16px 0 48px rgba(0, 0, 0, 0.45);
    color: var(--color-text-primary);
}

/* ── Header ───────────────────────────────────────────────────────────── */
.led-head {
    padding: var(--space-5) var(--space-5) var(--space-3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.led-head__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}
.led-title {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    letter-spacing: var(--tracking-tight);
}
.led-close {
    appearance: none;
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.78);
    cursor: pointer;
    transition: background var(--motion-state), color var(--motion-state);
}
.led-close:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--color-text-primary);
}

/* Step rail */
.led-steps {
    display: flex;
    gap: var(--space-1);
    padding: 4px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.32);
    border: 1px solid rgba(255, 255, 255, 0.06);
}
.led-step {
    appearance: none;
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-3);
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.62);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background var(--motion-state), color var(--motion-state);
}
.led-step:hover:not(:disabled) {
    color: rgba(255, 255, 255, 0.92);
    background: rgba(255, 255, 255, 0.05);
}
.led-step--active {
    background: rgba(255, 255, 255, 0.14);
    color: var(--color-text-primary);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.led-step:disabled {
    opacity: 0.42;
    cursor: not-allowed;
}
.led-step__num {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
}
.led-step--active .led-step__num {
    background: rgba(255, 255, 255, 0.28);
}
.led-step__label {
    line-height: 1;
}
.led-step__tag {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: rgba(235, 235, 245, 0.5);
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.led-step__err-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-danger-text);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4);
}
.led-step--error {
    color: rgba(255, 88, 88, 0.92);
}
.led-step--error .led-step__num {
    background: rgba(255, 88, 88, 0.2);
}

/* Server-error banner */
.led-banner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2-5) var(--space-5);
    background: rgba(255, 88, 88, 0.14);
    border-bottom: 1px solid rgba(255, 88, 88, 0.3);
    color: rgba(255, 200, 200, 0.96);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
}
.led-banner__msg {
    flex: 1;
    min-width: 0;
}
.led-banner__close {
    appearance: none;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
}
.led-banner__close:hover {
    opacity: 1;
}

/* ── Body + sections ─────────────────────────────────────────────────── */
.led-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-5);
    min-height: 0;
}
.led-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.led-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
}
.led-label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: rgba(235, 235, 245, 0.86);
    letter-spacing: var(--tracking-wide);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}
.led-label__optional {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: rgba(235, 235, 245, 0.5);
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.led-required {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: rgba(255, 88, 88, 0.92);
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(255, 88, 88, 0.12);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.led-hint {
    margin: 0;
    font-size: var(--type-caption);
    color: rgba(235, 235, 245, 0.55);
}
.led-hint code {
    background: rgba(255, 255, 255, 0.08);
    padding: 0 4px;
    border-radius: 4px;
    font-size: var(--type-caption);
}
.led-error {
    margin: 0;
    font-size: var(--type-caption);
    color: rgba(255, 88, 88, 0.92);
}

/* Kind segmented control */
.led-segmented {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-1);
    padding: 4px;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.06);
}
.led-seg {
    appearance: none;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: var(--space-3) var(--space-2);
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(235, 235, 245, 0.72);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background var(--motion-state), color var(--motion-state);
}
.led-seg:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05);
    color: var(--color-text-primary);
}
.led-seg:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.led-seg--on {
    background: rgba(255, 255, 255, 0.14);
    color: var(--color-text-primary);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.led-seg i {
    font-size: var(--type-body);
}

/* Resolved address card */
.led-card {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.22);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.led-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
}
.led-card__title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: rgba(235, 235, 245, 0.92);
}
.led-card__edit {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(235, 235, 245, 0.86);
    cursor: pointer;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.led-card__edit:hover {
    background: rgba(255, 255, 255, 0.12);
}
.led-card__list {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1-5) var(--space-3);
}
.led-card__row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.led-card__row dt {
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: rgba(235, 235, 245, 0.5);
}
.led-card__row dd {
    margin: 0;
    font-size: var(--type-caption);
    color: rgba(235, 235, 245, 0.92);
    word-break: break-word;
}
.led-card__form {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
}
.led-card__label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--type-caption);
    color: rgba(235, 235, 245, 0.7);
}

/* Mini map */
.led-map {
    position: relative;
    width: 100%;
    height: 320px;
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.4);
}
.led-map__empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: rgba(235, 235, 245, 0.45);
    text-align: center;
    pointer-events: none;
    z-index: 1;
}
.led-map__empty i {
    font-size: var(--type-subheading);
}
.led-map__empty p {
    margin: 0;
    font-size: var(--type-caption);
}
.led-map__meta {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
}
.led-map__coords {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1-5) var(--space-3);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.32);
    border: 1px solid rgba(255, 255, 255, 0.06);
    font-size: var(--type-caption);
    color: rgba(235, 235, 245, 0.86);
}
.led-map__coord {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-variant-numeric: tabular-nums;
}
.led-map__coord-label {
    color: rgba(235, 235, 245, 0.55);
    letter-spacing: var(--tracking-wide);
}
.led-map__coord-val {
    font-weight: var(--font-semibold);
}
.led-map__precision {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.led-map__precision--geocoded {
    background: rgba(232, 157, 34, 0.18);
    color: rgba(255, 211, 110, 0.92);
}
.led-map__precision--confirmed {
    background: rgba(77, 157, 138, 0.22);
    color: rgba(140, 220, 196, 0.96);
}
.led-map__precision--manual {
    background: rgba(110, 130, 160, 0.18);
    color: rgba(200, 210, 230, 0.92);
}
.led-map__reset {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-3);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(235, 235, 245, 0.86);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background var(--motion-state);
}
.led-map__reset:hover {
    background: rgba(255, 255, 255, 0.12);
}

/* MapLibre HTML marker (un-scoped so the custom-element rule reaches it). */
:global(.led-marker) {
    position: relative;
    width: 28px;
    height: 36px;
    cursor: grab;
}
:global(.led-marker:active) {
    cursor: grabbing;
}
:global(.led-marker__pin) {
    position: absolute;
    left: 50%;
    top: 0;
    transform: translateX(-50%);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--color-primary);
    border: 2.5px solid #ffffff;
    box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.4),
        0 6px 14px rgba(0, 0, 0, 0.3);
}
:global(.led-marker__shadow) {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: 12px;
    height: 4px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    filter: blur(2px);
}

/* Manual-coords disclosure */
.led-disclose {
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.18);
    overflow: hidden;
}
.led-disclose__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    list-style: none;
    color: rgba(235, 235, 245, 0.72);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.led-disclose__head::-webkit-details-marker {
    display: none;
}
.led-disclose[open] .led-disclose__head {
    color: var(--color-text-primary);
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.led-disclose__body {
    padding: var(--space-3);
}
.led-manual {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
}
.led-manual label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--type-caption);
    color: rgba(235, 235, 245, 0.7);
}
.led-manual__input {
    appearance: none;
    background: rgba(0, 0, 0, 0.32);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-primary);
    font: inherit;
    font-variant-numeric: tabular-nums;
}

/* Step 3 accordions */
.led-accordion {
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.18);
    overflow: hidden;
}
.led-accordion + .led-accordion {
    margin-top: var(--space-2);
}
.led-accordion__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    list-style: none;
    user-select: none;
}
.led-accordion__head::-webkit-details-marker {
    display: none;
}
.led-accordion__head:hover {
    background: rgba(255, 255, 255, 0.03);
}
.led-accordion__icon {
    color: rgba(235, 235, 245, 0.6);
}
.led-accordion__label {
    flex: 1;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: rgba(235, 235, 245, 0.92);
}
.led-accordion__tag {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: rgba(235, 235, 245, 0.5);
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.led-accordion__chev {
    color: rgba(255, 255, 255, 0.45);
    transition: transform var(--motion-state);
}
.led-accordion[open] .led-accordion__chev {
    transform: rotate(180deg);
}
.led-accordion__body {
    padding: var(--space-2) var(--space-4) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border-top: 1px solid rgba(255, 255, 255, 0.04);
}

/* Tag chips */
.led-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-2);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.08);
    min-height: 44px;
}
.led-tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(68, 149, 209, 0.22);
    color: rgba(170, 225, 250, 0.96);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.led-tag__x {
    appearance: none;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    opacity: 0.7;
}
.led-tag__x:hover {
    opacity: 1;
}
.led-tag__input {
    flex: 1;
    min-width: 120px;
    background: transparent;
    border: none;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    outline: none;
}
.led-tag__input::placeholder {
    color: rgba(235, 235, 245, 0.4);
}

.led-textarea {
    width: 100%;
    padding: var(--space-2-5) var(--space-3);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--type-body);
    line-height: 1.4;
    resize: vertical;
    outline: none;
}
.led-textarea:focus {
    border-color: rgba(68, 149, 209, 0.5);
}

/* ── Footer ──────────────────────────────────────────────────────────── */
.led-foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(0, 0, 0, 0.18);
}
.led-foot__spacer {
    flex: 1;
}

/* ── Open/close transition ──────────────────────────────────────────── */
.led-fade-enter-active,
.led-fade-leave-active {
    transition: opacity var(--motion-state);
}
.led-fade-enter-active .led-panel,
.led-fade-leave-active .led-panel {
    transition: transform var(--motion-state);
}
.led-fade-enter-from,
.led-fade-leave-to {
    opacity: 0;
}
.led-fade-enter-from .led-panel,
.led-fade-leave-to .led-panel {
    transform: translateX(20px);
}
</style>
