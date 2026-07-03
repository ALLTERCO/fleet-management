<template>
    <Modal :visible="visible" wide @close="close">
        <template #title>{{ modeLabel }}</template>

        <template #default>
            <div class="lf-section">
                <div v-if="serverError" class="lfm-banner lf-error" role="alert">
                    <i class="fas fa-triangle-exclamation" aria-hidden="true" />
                    <span>{{ serverError }}</span>
                </div>

                <!-- Type — every kind the backend defines, grouped by tier. -->
                <div class="lf-field">
                    <label class="lf-label" for="lf-kind">Type</label>
                    <div class="lf-select-wrap">
                        <select
                            id="lf-kind"
                            v-model="formKind"
                            class="lf-select"
                            :disabled="mode === 'edit'"
                        >
                            <optgroup
                                v-for="group in kindGroups"
                                :key="group.label"
                                :label="group.label"
                            >
                                <option
                                    v-for="k in group.kinds"
                                    :key="k.kind"
                                    :value="k.kind"
                                >
                                    {{ k.label }}
                                </option>
                            </optgroup>
                        </select>
                        <i
                            class="fas fa-chevron-down lf-select-chev"
                            aria-hidden="true"
                        />
                    </div>
                    <p v-if="kindHint" class="lf-hint">{{ kindHint }}</p>
                </div>

                <!-- Name -->
                <div class="lf-field">
                    <label class="lf-label" for="lf-name">Name</label>
                    <Input
                        id="lf-name"
                        v-model="formName"
                        placeholder="e.g. Paris HQ"
                        @blur="applyNameValidation"
                    />
                    <p v-if="nameError" class="lf-error">{{ nameError }}</p>
                </div>

                <!-- Parent — shown whenever this kind can have one. -->
                <div v-if="showParent" class="lf-field">
                    <label class="lf-label">
                        Parent
                        <span v-if="parentRequired" class="lf-required">
                            Required
                        </span>
                    </label>
                    <LocationParentPicker
                        v-model="formParent"
                        :exclude-id="initial?.id"
                    />
                    <p v-if="parentError" class="lf-error">{{ parentError }}</p>
                </div>

                <!-- Place on map — only kinds that carry a geo field. -->
                <LocationEntryDrawerStep2
                    v-if="needsAddress"
                    v-model:geo="geo"
                    v-model:precision="precision"
                    v-model:has-pin="hasPin"
                    v-model:what3words-error="what3wordsError"
                    v-model:manual-error="manualError"
                    :is-active="visible && needsAddress"
                    :kind-fields="formKindFields"
                    @set-kind-field="onSetKindField"
                />

                <!-- More details — optional accordions (tags, hours, plan, …). -->
                <LocationEntryDrawerStep3
                    v-model:tag-draft="tagDraft"
                    v-model:notes="notes"
                    :kind-fields="formKindFields"
                    :location-id="initial?.id ?? null"
                    :can-show-floor-plan="canShowFloorPlan"
                    :has-operating-hours-field="hasOperatingHoursField"
                    :detail-groups="detailGroups"
                    :option-sets="optionSets"
                    :tags="tags"
                    :tag-error="tagError"
                    :notes-error="notesError"
                    @set-kind-field="onSetKindField"
                    @remove-tag="removeTag"
                    @commit-tag="commitTag"
                    @tag-backspace="onTagBackspace"
                    @clear-tag-error="tagError = ''"
                />
            </div>
        </template>

        <template #footer>
            <div class="lfm-footer">
                <Button type="blue-hollow" @click="close">Cancel</Button>
                <span class="lfm-footer__spacer" />
                <Button
                    type="green"
                    :loading="saving"
                    :disabled="!canSave"
                    :requires-write="true"
                    @click="handleSave"
                >
                    {{ mode === 'create' ? 'Save location' : 'Save changes' }}
                </Button>
            </div>
        </template>
    </Modal>
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
import Input from '@/components/core/Input.vue';
import LocationParentPicker from '@/components/core/LocationParentPicker.vue';
import Modal from '@/components/modals/Modal.vue';
import {
    type GeoPrecision,
    type GeoState,
    nameContentErrorMessage,
    notesErrorMessage,
    type TagRejectionReason,
    tagRejectionReason
} from '@/helpers/location-drawer-steps';
import {inheritKindFieldsFromParent} from '@/helpers/location-inheritance';
import {isPlanFriendlyKind} from '@/helpers/location-kinds';
import {NAME_MAX_LENGTH} from '@/helpers/validation-limits';
import {
    type LocationFieldDescriptor,
    type LocationFieldGroup,
    type LocationKindDescriptor,
    useLocationsStore
} from '@/stores/locations';
import LocationEntryDrawerStep2 from './LocationEntryDrawerStep2.vue';
import LocationEntryDrawerStep3, {
    type DetailGroup
} from './LocationEntryDrawerStep3.vue';

// Tier buckets for the <optgroup> grouping. Membership only — labels and
// order still come from the backend descriptors.
const GEO_KINDS = new Set<LocationKind>([
    'continent',
    'country',
    'region',
    'county',
    'city',
    'neighborhood'
]);
const LOGICAL_KINDS = new Set<LocationKind>(['zone']);

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

// Fields with dedicated UI (map section) — skipped by the generic detail loop.
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
    /** Create a child under this parent (tree "+"). Drives inheritance. */
    defaultParentId?: number | null;
    /** Pre-select the kind (tree "+" passes the sensible child kind). */
    defaultKind?: LocationKind;
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
const serverError = ref<string | null>(null);

const geo = ref<GeoState>({lat: 0, lng: 0});
const hasPin = ref(false);
const precision = ref<GeoPrecision>('geocoded');
const what3wordsError = ref('');
const manualError = ref('');

const tags = ref<string[]>([]);
const tagDraft = ref('');
const tagError = ref('');
const notes = ref('');
const notesError = computed(() => notesErrorMessage(notes.value));

const modeLabel = computed(() =>
    props.mode === 'create'
        ? 'New location'
        : `Edit "${props.initial?.name ?? ''}"`
);

const sortedKinds = computed<LocationKindDescriptor[]>(() =>
    [...kinds.value].sort((a, b) => a.sortRank - b.sortRank)
);

const kindGroups = computed(() => {
    const groups = [
        {label: 'Geographic', kinds: pickKinds((k) => GEO_KINDS.has(k.kind))},
        {
            label: 'Physical',
            kinds: pickKinds(
                (k) => !GEO_KINDS.has(k.kind) && !LOGICAL_KINDS.has(k.kind)
            )
        },
        {label: 'Logical', kinds: pickKinds((k) => LOGICAL_KINDS.has(k.kind))}
    ];
    return groups.filter((g) => g.kinds.length > 0);
});

function pickKinds(
    predicate: (k: LocationKindDescriptor) => boolean
): LocationKindDescriptor[] {
    return sortedKinds.value.filter(predicate);
}

const currentDescriptor = computed<LocationKindDescriptor | null>(
    () => kinds.value.find((k) => k.kind === formKind.value) ?? null
);

// Parent rules come straight from the descriptor — no hardcoded kind sets.
const parentRequired = computed(() => currentDescriptor.value?.allowRoot === false);
const showParent = computed(
    () => (currentDescriptor.value?.allowedParents.length ?? 0) > 0
);

// A kind gets the address + map section iff it carries a geo/address field.
const needsAddress = computed(
    () =>
        currentDescriptor.value?.fields.some(
            (f) => f.widget === 'geo' || f.widget === 'address'
        ) ?? false
);

const kindHint = computed(() => {
    const d = currentDescriptor.value;
    if (!d) return '';
    const parents = d.allowedParents
        .map((p) => labelForKind(p))
        .filter(Boolean);
    if (d.allowRoot && parents.length === 0) return 'Sits at the top level.';
    if (d.allowRoot) return `Top level, or under ${parents.join(' / ')}.`;
    return `Goes under ${parents.join(' / ')}.`;
});

function labelForKind(kind: LocationKind): string {
    return kinds.value.find((k) => k.kind === kind)?.label ?? kind;
}

const canShowFloorPlan = computed(() => isPlanFriendlyKind(formKind.value));
const hasOperatingHoursField = computed(
    () =>
        currentDescriptor.value?.fields.some(
            (f) => f.widget === 'operatingHours'
        ) ?? false
);

const detailGroups = computed<DetailGroup[]>(() => {
    const descriptor = currentDescriptor.value;
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

// ── Validation — pure Answer functions; Do functions apply them to refs ──

function nameErrorMessage(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return 'Name is required';
    if (trimmed.length > NAME_MAX_LENGTH) return `Max ${NAME_MAX_LENGTH} characters`;
    const contentIssue = nameContentErrorMessage(name);
    if (contentIssue) return contentIssue;
    return '';
}

function parentErrorMessage(): string {
    if (parentRequired.value && formParent.value == null) {
        return 'A parent is required for this kind';
    }
    return '';
}

function applyNameValidation(): boolean {
    nameError.value = nameErrorMessage(formName.value);
    return nameError.value === '';
}

function applyParentValidation(): boolean {
    parentError.value = parentErrorMessage();
    return parentError.value === '';
}

const canSave = computed(() => {
    if (saving.value) return false;
    if (nameErrorMessage(formName.value)) return false;
    if (parentErrorMessage()) return false;
    if (what3wordsError.value) return false;
    if (notesError.value) return false;
    return true;
});

// ── Form state helpers ──

function onSetKindField(args: {key: string; value: unknown}): void {
    const next = {...formKindFields.value};
    const v = args.value;
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
        delete next[args.key];
    } else {
        next[args.key] = v;
    }
    formKindFields.value = next;
}

function close(): void {
    visible.value = false;
}


// ── Tag chip input ──

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

// ── Open / reset ──

// Do — seed kindFields for a new child from its parent's inheritable fields.
function seededFieldsForNewChild(): Record<string, unknown> {
    if (props.mode !== 'create' || props.defaultParentId == null) return {};
    const parent = store.locations[props.defaultParentId];
    const childDescriptor = kinds.value.find((k) => k.kind === formKind.value);
    if (!parent || !childDescriptor) return {};
    return inheritKindFieldsFromParent({
        parentKindFields: parent.kindFields as Record<string, unknown>,
        childInheritableFields: childDescriptor.inheritableFields
    });
}

function resetForm(): void {
    const t = props.initial;
    formKind.value = t?.kind ?? props.defaultKind ?? 'site';
    formName.value = t?.name ?? '';
    formParent.value = t?.parentLocationId ?? props.defaultParentId ?? null;
    formKindFields.value = {
        ...seededFieldsForNewChild(),
        ...(t?.kindFields ?? {})
    };
    nameError.value = '';
    parentError.value = '';
    what3wordsError.value = '';
    manualError.value = '';
    serverError.value = null;
    tagError.value = '';
    tags.value = [];
    tagDraft.value = '';
    notes.value = '';

    const priorGeo = (t?.kindFields as Record<string, unknown> | undefined)
        ?.geo as
        | {lat?: number; lng?: number; precision?: GeoPrecision}
        | undefined;
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

// Inheritance + detail groups need the kind descriptors. Reset immediately
// when cached; otherwise fetch first, then seed.
watch(visible, (open) => {
    if (!open) return;
    if (kinds.value.length > 0) resetForm();
    else void store.fetchKinds().then(resetForm);
});

watch(formKind, () => {
    if (!parentRequired.value) parentError.value = '';
});

// ── Save ──

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

function isSaveAllowed(): boolean {
    const nameOk = applyNameValidation();
    const parentOk = applyParentValidation();
    if (!nameOk || !parentOk) return false;
    if (what3wordsError.value) return false;
    return true;
}

// Answer — kindFields payload from the current form state.
function buildKindFieldsPayload(): LocationKindFields {
    const out: Record<string, unknown> = {...formKindFields.value};
    if (hasPin.value) {
        out.geo = {
            lat: geo.value.lat,
            lng: geo.value.lng,
            precision: precision.value
        };
    }
    if (tags.value.length > 0) out.tags = [...tags.value];
    else delete out.tags;
    const trimmedNotes = notes.value.trim();
    if (trimmedNotes) out.notes = trimmedNotes;
    else delete out.notes;
    return out as LocationKindFields;
}

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

function saveRejectedMessage(): string {
    return props.mode === 'create'
        ? 'Save failed — the server rejected the location. Check the highlighted fields and try again.'
        : 'Update failed — the server rejected the change. Check the highlighted fields and try again.';
}

function readSaveErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return 'Save failed unexpectedly.';
}
</script>

<style scoped>
.lfm-banner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-danger-subtle);
}
.lfm-footer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
}
.lfm-footer__spacer {
    flex: 1;
}
</style>
