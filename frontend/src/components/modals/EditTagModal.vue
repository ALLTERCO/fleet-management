<template>
    <Modal :visible="visible" wide @close="close">
        <template #title>
            <div v-if="props.mode === 'create'" class="etm-title">
                <i class="fas fa-plus etm-title-icon" /> New Tag
            </div>
            <span v-else class="etm-title">Edit "{{ initial?.name }}"</span>
        </template>

        <template #default>
            <div class="etm" :class="{'etm--split': props.mode === 'edit'}">
                <div class="etm__identity">
                    <div class="etm__hero">
                        <div class="etm__hero-fields">
                            <div class="etm__field-wrap">
                                <Input
                                    id="etm-name"
                                    v-model="formName"
                                    :maxlength="NAME_MAX_LENGTH"
                                    aria-label="Name"
                                    placeholder="Name"
                                    @blur="validateName"
                                />
                                <span
                                    class="etm__count"
                                    :class="{
                                        'etm__count--full':
                                            formName.length >= NAME_MAX_LENGTH
                                    }"
                                >
                                    {{ formName.length }}/{{ NAME_MAX_LENGTH }}
                                </span>
                            </div>
                            <div class="etm__field-wrap">
                                <Textarea
                                    id="etm-desc"
                                    v-model="formDescription"
                                    :maxlength="DESCRIPTION_MAX_LENGTH"
                                    aria-label="Description"
                                    placeholder="Add a description"
                                />
                                <span
                                    class="etm__count"
                                    :class="{
                                        'etm__count--full':
                                            formDescription.length >=
                                            DESCRIPTION_MAX_LENGTH
                                    }"
                                >
                                    {{ formDescription.length }}/{{
                                        DESCRIPTION_MAX_LENGTH
                                    }}
                                </span>
                            </div>
                            <div class="etm__field-wrap">
                                <span class="etm__color-label">Color</span>
                                <AccentTokenPicker v-model="formColor" />
                            </div>
                        </div>
                    </div>
                    <p v-if="nameError" class="etm__error">{{ nameError }}</p>
                </div>

                <div v-if="props.mode === 'edit'" class="etm__applied">
                    <div class="etm__applied-bar">
                        <div
                            v-if="totalAssignments > 0"
                            class="search-pill etm__applied-search"
                            :class="{'search-pill__input--filtered': hasActiveFilter}"
                        >
                            <i class="fas fa-search search-pill__icon" />
                            <input
                                v-model="appliedSearch"
                                type="text"
                                class="search-pill__input"
                                placeholder="Filter by name or id…"
                                aria-label="Filter applied subjects"
                            />
                            <button
                                v-if="appliedSearch"
                                type="button"
                                class="search-pill__clear"
                                aria-label="Clear search"
                                @click="appliedSearch = ''"
                            >
                                <i class="fas fa-xmark" />
                            </button>
                            <button
                                type="button"
                                class="search-pill__filter"
                                :class="{
                                    'search-pill__filter--active': hasActiveFilter
                                }"
                                aria-label="Filter by type"
                                @click="filterModalVisible = true"
                            >
                                <i class="fas fa-filter" />
                            </button>
                        </div>
                        <Button type="green" size="sm" @click="openAssignMore">
                            Assign more
                        </Button>
                    </div>

                    <div v-if="activeFilterChips.length" class="etm__chips">
                        <button
                            v-for="chip in activeFilterChips"
                            :key="chip.key"
                            type="button"
                            class="etm__chip etm__chip--active"
                            @click="chip.remove()"
                        >
                            <i :class="chip.icon" />
                            {{ chip.label }}
                            <i class="fas fa-xmark" />
                        </button>
                    </div>

                    <div v-if="totalAssignments === 0" class="etm__applied-empty">
                        No subjects tagged yet.
                    </div>
                    <div
                        v-else-if="matchCount === 0"
                        class="etm__applied-empty"
                    >
                        {{
                            appliedSearch
                                ? `No matches for "${appliedSearch}".`
                                : 'No subjects match the filter.'
                        }}
                    </div>

                    <div v-else class="etm__applied-list">
                        <template
                            v-for="type in availableTypes"
                            :key="type"
                        >
                            <div
                                v-if="rowsForType(type).length"
                                class="etm__applied-group"
                            >
                                <div
                                    v-if="availableTypes.length > 1"
                                    class="etm__applied-group-label"
                                >
                                    {{ TYPE_LABELS[type] }} ({{ assignmentsByType[type].length }})
                                </div>
                                <ul class="etm__applied-rows">
                                    <li
                                        v-for="row in rowsForType(type)"
                                        :key="`${row.subjectType}:${row.subjectId}`"
                                        class="etm__applied-row"
                                    >
                                        <span class="etm__applied-row-logo">
                                            <img
                                                v-if="subjectVisual(row).img"
                                                :src="subjectVisual(row).img"
                                                alt=""
                                                class="etm__applied-row-img"
                                            />
                                            <i
                                                v-else
                                                :class="['etm__applied-row-icon', subjectVisual(row).icon]"
                                            />
                                        </span>
                                        <div class="etm__applied-row-text">
                                            <span class="etm__applied-row-name">
                                                {{ subjectName(row) }}
                                            </span>
                                            <code
                                                v-if="subjectName(row) !== row.subjectId"
                                                class="etm__applied-row-id"
                                            >
                                                {{ row.subjectId }}
                                            </code>
                                        </div>
                                        <button
                                            type="button"
                                            class="etm__applied-row-rm"
                                            title="Remove assignment"
                                            @click="removeAssignment(row)"
                                        >
                                            <i class="fas fa-xmark" />
                                        </button>
                                    </li>
                                </ul>
                                <button
                                    v-if="hiddenCountForType(type) > 0"
                                    type="button"
                                    class="etm__applied-more"
                                    @click="toggleExpanded(type)"
                                >
                                    show {{ hiddenCountForType(type) }} more
                                </button>
                            </div>
                        </template>
                    </div>

                    <FilterModal
                        v-if="filterModalVisible"
                        :visible="filterModalVisible"
                        title="Filter by type"
                        match-label="subjects"
                        :match-count="matchCount"
                        :sections="filterSections"
                        :initial-state="filterInitialState"
                        @close="filterModalVisible = false"
                        @apply-generic="onApplyFilter"
                    />
                </div>
            </div>
        </template>

        <template #footer>
            <div class="etm__footer">
                <Button
                    v-if="props.mode === 'edit'"
                    type="red"
                    :requires-write="true"
                    @click="askDelete"
                >
                    Delete
                </Button>
                <span class="etm__footer-spacer" />
                <Button type="blue-hollow" @click="close">Cancel</Button>
                <Button
                    type="green"
                    :loading="saving"
                    :disabled="!canSave"
                    :requires-write="true"
                    @click="handleSave"
                >
                    {{ props.mode === 'create' ? 'Create Tag' : 'Save Changes' }}
                </Button>
            </div>
        </template>
    </Modal>

    <Modal :visible="assignModalVisible" wide @close="assignModalVisible = false">
        <template #title><h3>Assign subjects</h3></template>
        <template #default>
            <SubjectPicker
                v-model="pickedSubjects"
                :subject-types="[...ASSIGNABLE_TYPES]"
            />
        </template>
        <template #footer>
            <div class="etm__footer">
                <Button type="blue-hollow" @click="assignModalVisible = false">Cancel</Button>
                <Button
                    type="green"
                    :loading="assigning"
                    :disabled="pickedSubjects.length === 0"
                    @click="confirmAssign"
                >
                    Assign {{ pickedSubjects.length }}
                </Button>
            </div>
        </template>
    </Modal>

    <ConfirmationModal ref="deleteRef">
        <template #title>
            <h3>Delete "{{ initial?.name }}"?</h3>
        </template>
        <template #subText>
            <p>This removes the tag from everything it's applied to.</p>
        </template>
    </ConfirmationModal>
</template>

<script setup lang="ts">
import type {
    Tag as ApiTag,
    TagAssignmentRef,
    TagSubjectType
} from '@api/tag';
import {computed, ref, watch} from 'vue';
import AccentTokenPicker from '@/components/core/AccentTokenPicker.vue';
import Button from '@/components/core/Button.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import Input from '@/components/core/Input.vue';
import SubjectPicker, {
    type SubjectRef,
    type SubjectType
} from '@/components/core/SubjectPicker.vue';
import Textarea from '@/components/core/Textarea.vue';
import {useDecorationDraft} from '@/composables/useDecorationDraft';
import {useTagSubjectName} from '@/composables/useTagSubjectName';
import {resolveDeviceLogo} from '@/helpers/deviceLogo';
import {NAME_MAX_LENGTH} from '@/helpers/validation-limits';
import {useDevicesStore} from '@/stores/devices';
import {useTagsStore} from '@/stores/tags';
import ConfirmationModal from './ConfirmationModal.vue';
import Modal from './Modal.vue';

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
// Mirrors the backend tag DESCRIPTION_SCHEMA maxLength.
const DESCRIPTION_MAX_LENGTH = 500;

const TYPE_LABELS: Record<TagSubjectType, string> = {
    device: 'Devices',
    entity: 'Entities',
    group: 'Groups',
    location: 'Locations',
    alert_rule: 'Alert rules',
    destination_group: 'Destinations',
    channel: 'Integrations',
    script: 'Scripts'
};

const TYPE_ICONS: Record<TagSubjectType, string> = {
    device: 'fas fa-microchip',
    entity: 'fas fa-puzzle-piece',
    group: 'fas fa-folder-tree',
    location: 'fas fa-location-dot',
    alert_rule: 'fas fa-bell',
    destination_group: 'fas fa-paper-plane',
    channel: 'fas fa-plug',
    script: 'fas fa-code'
};

// Subjects the picker can target. Other types (alert rules etc.) are read-only
// in this UI for now — assigned externally.
const ASSIGNABLE_TYPES: readonly SubjectType[] = [
    'device',
    'entity',
    'group',
    'location'
];

type DeviceKind = 'physical' | 'bluetooth' | 'virtual';
const KIND_ORDER: readonly DeviceKind[] = ['physical', 'bluetooth', 'virtual'];
const KIND_LABELS: Record<DeviceKind, string> = {
    physical: 'Physical',
    bluetooth: 'Bluetooth',
    virtual: 'Virtual'
};
const KIND_ICONS: Record<DeviceKind, string> = {
    physical: 'fas fa-microchip',
    bluetooth: 'fab fa-bluetooth-b',
    virtual: 'fas fa-cube'
};

const DEFAULT_TRUNCATE = 4;

const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    mode: 'create' | 'edit';
    initial?: ApiTag | null;
}>();

const emit = defineEmits<{saved: [ApiTag]}>();

const tagsStore = useTagsStore();
const devicesStore = useDevicesStore();

const formName = ref('');
const formKey = ref('');
const formDescription = ref('');
const {accent: formColor} = useDecorationDraft();

const nameError = ref('');
const keyError = ref('');
const saving = ref(false);

const typeFilter = ref<Set<TagSubjectType>>(new Set());
const kindFilter = ref<Set<DeviceKind>>(new Set());
const appliedSearch = ref('');
const expandedTypes = ref<Set<TagSubjectType>>(new Set());

const assignModalVisible = ref(false);
const filterModalVisible = ref(false);
const pickedSubjects = ref<SubjectRef[]>([]);
const assigning = ref(false);

function resetForm() {
    const t = props.initial;
    formName.value = t?.name ?? '';
    formKey.value = t?.key ?? '';
    formDescription.value = t?.description ?? '';
    formColor.value = t?.color ?? '';
    nameError.value = '';
    keyError.value = '';
    typeFilter.value = new Set();
    kindFilter.value = new Set();
    appliedSearch.value = '';
    expandedTypes.value = new Set();
}

watch(
    () => visible.value,
    (open) => {
        if (open) {
            resetForm();
            if (props.mode === 'edit' && props.initial?.id != null) {
                void tagsStore.fetchAssignments(props.initial.id);
            }
        }
    },
    {immediate: true}
);

function validateName(): boolean {
    const t = formName.value.trim();
    if (!t) {
        nameError.value = 'Name is required';
        return false;
    }
    if (t.length > NAME_MAX_LENGTH) {
        nameError.value = `Max ${NAME_MAX_LENGTH} characters`;
        return false;
    }
    nameError.value = '';
    return true;
}

function validateKey(): boolean {
    const t = formKey.value.trim();
    if (!t) {
        keyError.value = '';
        return true;
    }
    if (!KEY_PATTERN.test(t)) {
        keyError.value =
            'Lowercase letters, digits, . _ - only (2–64 chars, must start alphanumeric)';
        return false;
    }
    keyError.value = '';
    return true;
}

const canSave = computed(() => {
    if (saving.value) return false;
    if (!formName.value.trim()) return false;
    return !nameError.value && !keyError.value;
});

// ── Applied to ──

const allAssignments = computed<TagAssignmentRef[]>(() =>
    props.initial?.id != null
        ? (tagsStore.assignments[props.initial.id] ?? [])
        : []
);

const assignmentsByType = computed<Record<TagSubjectType, TagAssignmentRef[]>>(
    () => {
        const out = {} as Record<TagSubjectType, TagAssignmentRef[]>;
        for (const a of allAssignments.value) {
            (out[a.subjectType] ??= []).push(a);
        }
        return out;
    }
);

const availableTypes = computed<TagSubjectType[]>(() =>
    Object.keys(assignmentsByType.value)
        .filter((k) => assignmentsByType.value[k as TagSubjectType].length > 0)
        .sort() as TagSubjectType[]
);

const totalAssignments = computed(() => allAssignments.value.length);

const deviceById = computed(() => {
    const map = new Map<
        string,
        ReturnType<typeof devicesStore.getDevices>[number]
    >();
    for (const d of devicesStore.getDevices()) map.set(d.shellyID, d);
    return map;
});

// Shared resolver — resolves device/location/group/entity names (was
// device-only here, showing raw ids for the rest).
const {subjectName} = useTagSubjectName();

function subjectVisual(row: TagAssignmentRef): {img?: string; icon: string} {
    if (row.subjectType === 'device') {
        const device = deviceById.value.get(row.subjectId);
        if (device) {
            const logo = resolveDeviceLogo(device as never);
            return logo.kind === 'icon'
                ? {icon: logo.faClass}
                : {img: logo.src, icon: TYPE_ICONS.device};
        }
    }
    return {icon: TYPE_ICONS[row.subjectType]};
}

function deviceKindOf(id: string): DeviceKind | null {
    const device = deviceById.value.get(id);
    if (!device) return null;
    const source = (device as {source?: string}).source;
    if (source === 'bluetooth') return 'bluetooth';
    if (source === 'virtual') return 'virtual';
    return 'physical';
}

const deviceKindCounts = computed<Record<DeviceKind, number>>(() => {
    const counts: Record<DeviceKind, number> = {
        physical: 0,
        bluetooth: 0,
        virtual: 0
    };
    for (const a of allAssignments.value) {
        if (a.subjectType !== 'device') continue;
        const kind = deviceKindOf(a.subjectId);
        if (kind) counts[kind]++;
    }
    return counts;
});

function matchesSearch(row: TagAssignmentRef): boolean {
    const q = appliedSearch.value.trim().toLowerCase();
    if (!q) return true;
    return (
        subjectName(row).toLowerCase().includes(q) ||
        row.subjectId.toLowerCase().includes(q)
    );
}

function matches(row: TagAssignmentRef): boolean {
    if (!matchesSearch(row)) return false;
    if (typeFilter.value.size > 0 && !typeFilter.value.has(row.subjectType)) {
        return false;
    }
    if (kindFilter.value.size > 0) {
        if (row.subjectType !== 'device') return false;
        const kind = deviceKindOf(row.subjectId);
        if (!kind || !kindFilter.value.has(kind)) return false;
    }
    return true;
}

const hasActiveFilter = computed(
    () => typeFilter.value.size > 0 || kindFilter.value.size > 0
);
const isFiltering = computed(
    () => !!appliedSearch.value.trim() || hasActiveFilter.value
);

const matchCount = computed(
    () => allAssignments.value.filter(matches).length
);

function rowsForType(type: TagSubjectType): TagAssignmentRef[] {
    const rows = (assignmentsByType.value[type] ?? []).filter(matches);
    if (isFiltering.value) return rows;
    if (expandedTypes.value.has(type)) return rows;
    return rows.slice(0, DEFAULT_TRUNCATE);
}

function hiddenCountForType(type: TagSubjectType): number {
    if (isFiltering.value || expandedTypes.value.has(type)) return 0;
    const total = (assignmentsByType.value[type] ?? []).length;
    return Math.max(0, total - DEFAULT_TRUNCATE);
}

function toggleExpanded(type: TagSubjectType) {
    const next = new Set(expandedTypes.value);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    expandedTypes.value = next;
}

async function removeAssignment(row: TagAssignmentRef) {
    if (props.initial?.id == null) return;
    await tagsStore.unassignSubjects(props.initial.id, [row]);
}

const filterSections = computed<FilterSection[]>(() => {
    const sections: FilterSection[] = [
        {
            key: 'type',
            label: 'Type',
            icon: 'fa-shapes',
            options: availableTypes.value.map((t) => ({
                key: t,
                label: TYPE_LABELS[t],
                count: assignmentsByType.value[t].length
            }))
        }
    ];
    const kindOptions = KIND_ORDER.filter(
        (k) => deviceKindCounts.value[k] > 0
    ).map((k) => ({
        key: k,
        label: KIND_LABELS[k],
        count: deviceKindCounts.value[k]
    }));
    if (kindOptions.length > 0) {
        sections.push({
            key: 'kind',
            label: 'Device kind',
            icon: 'fa-microchip',
            options: kindOptions
        });
    }
    return sections;
});

const filterInitialState = computed<FilterState>(() => ({
    type: [...typeFilter.value],
    kind: [...kindFilter.value]
}));

function onApplyFilter(state: FilterState): void {
    typeFilter.value = new Set((state.type ?? []) as TagSubjectType[]);
    kindFilter.value = new Set((state.kind ?? []) as DeviceKind[]);
    filterModalVisible.value = false;
}

interface FacetChip {
    key: string;
    label: string;
    icon: string;
    remove: () => void;
}

const activeFilterChips = computed<FacetChip[]>(() => {
    const chips: FacetChip[] = [];
    for (const t of typeFilter.value) {
        chips.push({
            key: `type:${t}`,
            label: TYPE_LABELS[t],
            icon: TYPE_ICONS[t],
            remove: () => {
                const next = new Set(typeFilter.value);
                next.delete(t);
                typeFilter.value = next;
            }
        });
    }
    for (const k of kindFilter.value) {
        chips.push({
            key: `kind:${k}`,
            label: KIND_LABELS[k],
            icon: KIND_ICONS[k],
            remove: () => {
                const next = new Set(kindFilter.value);
                next.delete(k);
                kindFilter.value = next;
            }
        });
    }
    return chips;
});

function openAssignMore() {
    pickedSubjects.value = [];
    assignModalVisible.value = true;
}

async function confirmAssign() {
    if (props.initial?.id == null || pickedSubjects.value.length === 0) return;
    assigning.value = true;
    try {
        const refs: TagAssignmentRef[] = pickedSubjects.value
            .filter((s) =>
                (ASSIGNABLE_TYPES as readonly SubjectType[]).includes(s.subjectType)
            )
            .map((s) => ({
                subjectType: s.subjectType as TagSubjectType,
                subjectId: s.subjectId
            }));
        if (refs.length > 0) {
            await tagsStore.assignSubjects(props.initial.id, refs);
        }
        assignModalVisible.value = false;
        pickedSubjects.value = [];
    } finally {
        assigning.value = false;
    }
}

function close() {
    visible.value = false;
}

const deleteRef = ref<InstanceType<typeof ConfirmationModal>>();

function askDelete() {
    deleteRef.value?.storeAction(performDelete);
}

async function performDelete() {
    if (props.initial?.id == null) return;
    const ok = await tagsStore.deleteTag(props.initial.id);
    if (ok) close();
}

async function handleSave() {
    if (!validateName() || !validateKey()) {
        return;
    }
    saving.value = true;
    try {
        const name = formName.value.trim();
        const description = formDescription.value.trim() || null;
        const color = formColor.value || null;
        const keyInput = formKey.value.trim();

        if (props.mode === 'create') {
            const created = await tagsStore.createTag({
                name,
                ...(keyInput ? {key: keyInput} : {}),
                description,
                color
            });
            if (created) emit('saved', created);
            close();
        } else if (props.initial) {
            const updated = await tagsStore.updateTag(props.initial.id, {
                name,
                description,
                color
            });
            if (updated) emit('saved', updated);
            close();
        }
    } finally {
        saving.value = false;
    }
}
</script>

<style scoped>
.etm {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}
.etm--split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.618fr);
    gap: var(--space-6);
    align-items: start;
}
.etm__identity {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}
.etm:not(.etm--split) .etm__identity {
    max-width: 22rem;
}
.etm__applied {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
}
.etm__applied-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
@media (max-width: 768px) {
    .etm--split {
        grid-template-columns: 1fr;
    }
}
.etm-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-subheading);
    font-weight: 700;
}
.etm-title-icon { color: var(--color-primary); }
.etm__color-label {
    display: block;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    margin-bottom: var(--space-2);
}

.etm__hero {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
}
.etm__hero-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
}
.etm__field-wrap {
    display: grid;
    gap: var(--space-1);
}
.etm__count {
    justify-self: end;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}
.etm__count--full {
    color: var(--color-status-red);
}
.etm__error {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-status-red);
}

/* ── Applied to ── */
.etm__chips { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.etm__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-full);
    font-family: inherit;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background var(--motion-hover), border-color var(--motion-hover), color var(--motion-hover);
}
.etm__chip:hover { background: var(--color-surface-3); }
.etm__chip--active {
    background: rgba(var(--color-primary-rgb), 0.12);
    border-color: rgba(var(--color-primary-rgb), 0.35);
    color: var(--color-primary);
}
.etm__chip-count {
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
}

.etm__applied-empty {
    padding: var(--space-6);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.etm__applied-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.etm__applied-group { display: flex; flex-direction: column; gap: var(--space-2); }
.etm__applied-group-label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.etm__applied-rows {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--space-2);
}
.etm__applied-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    transition: border-color var(--motion-hover);
}
.etm__applied-row:hover { border-color: var(--color-border-medium); }
.etm__applied-row-logo {
    flex: none;
    width: var(--space-8);
    height: var(--space-8);
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
}
.etm__applied-row-img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.etm__applied-row-icon { color: var(--color-text-tertiary); }
.etm__applied-row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}
.etm__applied-row-name {
    color: var(--color-text-primary);
    font-size: var(--type-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.etm__applied-row-id {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.etm__applied-row-rm {
    width: var(--space-6);
    height: var(--space-6);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--motion-hover), background var(--motion-hover);
}
.etm__applied-row-rm:hover {
    color: var(--color-status-red);
    background: rgba(var(--color-status-off-rgb), 0.1);
}
.etm__applied-more {
    align-self: flex-start;
    background: none;
    border: none;
    padding: var(--space-1) var(--space-2);
    font-family: inherit;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-primary);
    cursor: pointer;
}
.etm__applied-more:hover { text-decoration: underline; }

/* ── Footer ── */
.etm__footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
}
.etm__footer-spacer {
    flex: 1;
}

</style>
