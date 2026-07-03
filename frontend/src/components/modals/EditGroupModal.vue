<template>
    <Modal :visible="visible" wide @close="close">
        <template #title>
            <div v-if="props.mode === 'create'" class="egm-title">New Group</div>
            <span v-else class="egm-title">{{ safeRootGroupName }}</span>
        </template>

        <template #default>
            <div class="egm">
                <!-- ═══ TOP: tree (left, if has children) + form (right) ═══ -->
                <div class="egm__top" :class="{'egm__top--has-tree': showTree}">
                    <!-- Tree map -->
                    <div v-if="showTree" class="egm__tree">
                        <Spinner v-if="treeLoading" size="sm" class="egm__tree-spinner" />
                        <template v-else>
                            <GroupTreeNode
                                v-for="node in treeRoots"
                                :key="node.id"
                                :node="node"
                                :children-map="childrenMap"
                                :selected-id="activeGroupId"
                                :depth="0"
                                @select="selectGroup"
                                @delete="confirmDeleteSubgroup"
                            />
                        </template>
                    </div>

                    <!-- Form -->
                    <div class="egm__form">
                        <div class="egm__form-cols">
                            <div class="egm__field egm__field--full">
                                <div class="egm__identity">
                                    <DecorationAvatar
                                        :icon="draftIcon"
                                        :accent="draftAccent"
                                        :image-asset-id="draftImage"
                                        fallback-icon="fas fa-layer-group"
                                        editable
                                        :size="96"
                                        @edit="pickerVisible = true"
                                    />
                                    <div class="egm__identity-body">
                                        <label class="egm__label" for="egm-name">Group name</label>
                                        <Input id="egm-name" v-model="formName" placeholder="Enter group name" @blur="validateName" />
                                        <p v-if="nameError" class="egm__error">{{ nameError }}</p>
                                    </div>
                                </div>
                            </div>

                            <details class="egm__advanced egm__field--full">
                                <summary class="egm__advanced-summary">
                                    <i class="fas fa-sliders egm__advanced-icon" />
                                    <span>Advanced settings</span>
                                    <span class="egm__advanced-hint">Kind, config profile, alerts &amp; data, metadata</span>
                                    <i class="fas fa-chevron-down egm__advanced-caret" />
                                </summary>
                                <div class="egm__advanced-body">
                                    <div class="egm__advanced-fields">
                                        <div class="egm__adv-pair">
                                            <div class="egm__field">
                                                <label class="egm__label">Config profile</label>
                                                <Dropdown
                                                    :options="['None', ...configProfileKeys]"
                                                    :default="formConfigProfile || 'None'"
                                                    @selected="(val: string | number | boolean) => formConfigProfile = String(val) === 'None' ? '' : String(val)"
                                                />
                                            </div>
                                            <div class="egm__field">
                                                <label class="egm__label">Kind</label>
                                                <GroupKindPicker v-model="formKind" />
                                            </div>
                                        </div>

                                        <div class="egm__field egm__field--full">
                                            <label class="egm__label">Alerts &amp; data</label>
                                            <div class="egm__policy">
                                                <!-- The group type is just a preset for the defaults below. -->
                                                <div v-if="props.mode === 'create' && groupTypeLabels.length > 0" class="egm__policy-row">
                                                    <span class="egm__policy-name">Preset</span>
                                                    <Dropdown
                                                        class="egm__policy-control"
                                                        :options="groupTypeLabels"
                                                        :default="groupTypeLabelFor(formGroupType)"
                                                        @selected="onGroupTypeSelected"
                                                    />
                                                </div>

                                                <!-- Minimum alert level -->
                                                <div class="egm__policy-row">
                                                    <span class="egm__policy-name">Minimum alert level</span>
                                                    <SeverityFloorPicker
                                                        v-if="overrideSeverity"
                                                        v-model="formSeverityFloor"
                                                        class="egm__policy-control"
                                                    />
                                                    <span v-else class="egm__policy-default">{{ severityDefaultLabel }}</span>
                                                    <button
                                                        v-if="overrideSeverity"
                                                        type="button"
                                                        class="egm__policy-link"
                                                        @click="useSeverityDefault"
                                                    >
                                                        Use default
                                                    </button>
                                                    <button
                                                        v-else
                                                        type="button"
                                                        class="egm__policy-link"
                                                        @click="overrideSeverity = true"
                                                    >
                                                        Override
                                                    </button>
                                                </div>

                                                <!-- Keep device data -->
                                                <div class="egm__policy-row">
                                                    <span class="egm__policy-name">Keep device data</span>
                                                    <RetentionDaysInput
                                                        v-if="overrideRetention"
                                                        v-model="formRetentionDaysText"
                                                        class="egm__policy-control"
                                                        placeholder="days"
                                                        :error="retentionDaysError"
                                                    />
                                                    <span v-else class="egm__policy-default">{{ retentionDefaultLabel }}</span>
                                                    <button
                                                        v-if="overrideRetention"
                                                        type="button"
                                                        class="egm__policy-link"
                                                        @click="useRetentionDefault"
                                                    >
                                                        Use default
                                                    </button>
                                                    <button
                                                        v-else
                                                        type="button"
                                                        class="egm__policy-link"
                                                        @click="overrideRetention = true"
                                                    >
                                                        Override
                                                    </button>
                                                </div>

                                                <!-- Keep activity log -->
                                                <div class="egm__policy-row">
                                                    <span class="egm__policy-name">Keep activity log</span>
                                                    <RetentionDaysInput
                                                        v-if="overrideAudit"
                                                        v-model="formAuditRetentionDaysText"
                                                        class="egm__policy-control"
                                                        placeholder="days"
                                                        :error="auditRetentionDaysError"
                                                    />
                                                    <span v-else class="egm__policy-default">{{ auditDefaultLabel }}</span>
                                                    <button
                                                        v-if="overrideAudit"
                                                        type="button"
                                                        class="egm__policy-link"
                                                        @click="useAuditDefault"
                                                    >
                                                        Use default
                                                    </button>
                                                    <button
                                                        v-else
                                                        type="button"
                                                        class="egm__policy-link"
                                                        @click="overrideAudit = true"
                                                    >
                                                        Override
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div class="egm__field egm__field--full">
                                            <label class="egm__label">Metadata</label>
                                            <GroupMetadataForm
                                                v-model="formKindMetadata"
                                                :kind="selectedKindDef"
                                                @update:invalid="metadataIsInvalid = $event"
                                            />
                                            <p v-if="metadataError" class="egm__error">{{ metadataError }}</p>
                                        </div>
                                    </div>
                                </div>
                            </details>
                        </div>
                    </div>
                </div>

                <!-- ═══ MEMBERS ═══ -->
                <div class="egm__section">
                    <div class="egm__section-hdr">
                        <span class="egm__section-title">Members{{ isEditingChild ? ` in "${activeGroupName}"` : '' }}</span>
                        <span class="egm__count-meter">
                            <span class="egm__count-val">{{ selectedMembers.length }}</span>
                            <span class="egm__count-sep">/</span>
                            <span class="egm__count-total">{{ availableSubjects.length + selectedMembers.length }}</span>
                        </span>
                        <button
                            v-if="selectedMembers.length > 0"
                            type="button"
                            class="egm__link-btn"
                            @click="clearAllMembers"
                        >
                            Clear all
                        </button>
                    </div>
                    <div class="egm__device-panel">
                        <div class="egm__member-bar">
                        <div
                            class="search-pill egm__member-search"
                            :class="{'search-pill__input--filtered': hasActiveFilter}"
                        >
                            <i class="fas fa-search search-pill__icon" />
                            <input
                                v-model="deviceSearch"
                                type="text"
                                class="search-pill__input"
                                placeholder="Search devices and BLE sensors…"
                                aria-label="Search members"
                            />
                            <button
                                v-if="deviceSearch"
                                type="button"
                                class="search-pill__clear"
                                aria-label="Clear search"
                                @click="deviceSearch = ''"
                            >
                                <i class="fas fa-xmark" />
                            </button>
                            <button
                                type="button"
                                class="search-pill__filter"
                                :class="{'search-pill__filter--active': hasActiveFilter}"
                                aria-label="Filter members"
                                @click="filterModalVisible = true"
                            >
                                <i class="fas fa-filter" />
                            </button>
                        </div>
                            <Button type="blue-hollow" size="sm" @click="toggleSelectAll">
                                {{ allMembersSelected ? 'Clear' : 'Select all' }}
                            </Button>
                        </div>

                        <!-- Selected (sticky pinned top) -->
                        <div v-if="selectedMembers.length > 0" class="egm__pool egm__pool--selected">
                            <div class="egm__pool-hdr">
                                <i class="fas fa-check-circle egm__pool-icon" />
                                <span class="egm__pool-label">Selected</span>
                                <span class="egm__pool-count">{{ filteredMembers.length }}<span v-if="filteredMembers.length !== selectedMembers.length"> of {{ selectedMembers.length }}</span></span>
                            </div>
                            <div v-if="filteredMembers.length > 0" class="dc-grid egm__pool-grid">
                                <template v-for="item in filteredMembers" :key="`sel-${item.key}`">
                                    <DeviceFleetCard
                                        v-if="item.kind === 'device'"
                                        :device="resolveDevice(item.shellyID)"
                                        :selected="true"
                                        @select="removeMember(item.ref)"
                                    />
                                    <BTHomeDeviceWidget
                                        v-else
                                        :device="item.sensor"
                                        :selected="true"
                                        @click="removeMember(item.ref)"
                                    />
                                </template>
                            </div>
                            <div v-else class="egm__empty">No selected members match the search.</div>
                        </div>

                        <!-- Available — online first, then a divider, then offline. -->
                        <div class="egm__pool">
                            <div v-if="filteredAvailable.length === 0" class="egm__empty">No matches.</div>

                            <div v-if="paginatedOnline.length > 0" class="dc-section">
                                <span class="dc-section-dot" style="background: var(--color-status-on)" />
                                Online
                                <span class="egm__sec-count">{{ onlineAvailable.length }}</span>
                            </div>
                            <div v-if="paginatedOnline.length > 0" class="dc-grid egm__pool-grid">
                                <template v-for="item in paginatedOnline" :key="`avon-${item.key}`">
                                    <DeviceFleetCard
                                        v-if="item.kind === 'device'"
                                        :device="resolveDevice(item.shellyID)"
                                        @select="addMember(item.ref)"
                                    />
                                    <BTHomeDeviceWidget
                                        v-else
                                        :device="item.sensor"
                                        @click="addMember(item.ref)"
                                    />
                                </template>
                            </div>

                            <div v-if="paginatedOffline.length > 0" class="dc-section">
                                <span class="dc-section-dot" style="background: var(--color-status-off)" />
                                Offline
                                <span class="egm__sec-count">{{ offlineAvailable.length }}</span>
                            </div>

                            <div v-if="paginatedOffline.length > 0" class="dc-grid egm__pool-grid">
                                <template v-for="item in paginatedOffline" :key="`avoff-${item.key}`">
                                    <DeviceFleetCard
                                        v-if="item.kind === 'device'"
                                        :device="resolveDevice(item.shellyID)"
                                        @select="addMember(item.ref)"
                                    />
                                    <BTHomeDeviceWidget
                                        v-else
                                        :device="item.sensor"
                                        @click="addMember(item.ref)"
                                    />
                                </template>
                            </div>

                            <button v-if="filteredAvailable.length > availableShownCount" type="button" class="egm__show-more" @click="availablePageSize += 30">
                                Show more ({{ filteredAvailable.length - availableShownCount }} remaining)
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <template #footer>
            <div class="egm__footer">
                <Button type="blue-hollow" @click="close">Cancel</Button>
                <Button type="green" :loading="saving" :disabled="!canSave" :requires-write="true" @click="handleSave">
                    {{ props.mode === 'create' ? 'Create Group' : 'Save Changes' }}
                </Button>
            </div>
        </template>
    </Modal>

    <ConfirmationModal ref="deleteConfirmRef">
        <template #title><h3>{{ deleteConfirmTitle }}</h3></template>
    </ConfirmationModal>

    <FilterModal
        v-if="filterModalVisible"
        :visible="filterModalVisible"
        title="Filter members"
        match-label="members"
        :match-count="filteredMembers.length + filteredAvailable.length"
        :sections="memberFilterSections"
        :initial-state="memberFilterInitialState"
        @close="filterModalVisible = false"
        @apply-generic="onApplyMemberFilter"
    />

    <AssetPickerModal
        v-if="pickerVisible"
        :visible="pickerVisible"
        :initial-selected-asset-id="draftImage"
        :initial-selected-icon="draftIcon"
        :initial-selected-accent="draftAccent"
        default-context="group"
        @close="pickerVisible = false"
        @select-asset="onPickAsset"
        @select-icon="onPickIcon"
        @clear="onClearDecoration"
    />
</template>

<script setup lang="ts">
import {ALERT_SEVERITIES, type AlertSeverity} from '@api/alert';
import type {GroupMemberRef} from '@api/group';
import {computed, defineAsyncComponent, ref, watch} from 'vue';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import GroupKindPicker from '@/components/core/GroupKindPicker.vue';
import GroupMetadataForm from '@/components/core/GroupMetadataForm.vue';
import DecorationAvatar from '@/components/core/DecorationAvatar.vue';
import Input from '@/components/core/Input.vue';
import RetentionDaysInput from '@/components/core/RetentionDaysInput.vue';
import AssetPickerModal from '@/components/modals/AssetPickerModal.vue';
import {useDecorationDraft} from '@/composables/useDecorationDraft';
import SeverityFloorPicker from '@/components/core/SeverityFloorPicker.vue';
import Spinner from '@/components/core/Spinner.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import Modal from '@/components/modals/Modal.vue';
import BTHomeDeviceWidget from '@/components/widgets/BTHomeDeviceWidget.vue';
import {useGroupKinds} from '@/composables/useGroupKinds';
import {getDeviceName} from '@/helpers/device';
import {type DeviceType, deviceTypeOf} from '@/helpers/deviceTypeFilter';
import {
    booleanSection,
    countByKey,
    deviceClassSection,
    enumSection
} from '@/helpers/filter-sections';
import {formatRpcError, toastRpcError} from '@/helpers/domainErrors';
import {diffSubjectMembers} from '@/helpers/groupMembers';
import {extractKindMetadata} from '@/helpers/groupMetadataKeys';
import {
    buildPolicyFromForm,
    configProfileFromMetadata,
    type MetadataRecord,
    policyFromMetadata
} from '@/helpers/groupPolicyParse';
import {
    buildGroupSelectableSubjects,
    type GroupSelectableSubject
} from '@/helpers/groupSelectableSubjects';
import {NAME_MAX_LENGTH} from '@/helpers/validation-limits';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {type StoreGroup, useGroupsStore} from '@/stores/groups';
import {useScopeModelStore} from '@/stores/scopeModel';
import {useToastStore} from '@/stores/toast';
import {debugWarn} from '@/tools/debug';
import {getRegistry} from '@/tools/websocket';

const GroupTreeNode = defineAsyncComponent(() => import('./GroupTreeNode.vue'));

// ── Interface ──

const visible = defineModel<boolean>({required: true});

const props = defineProps<{
    mode: 'create' | 'edit';
    groupId?: number;
}>();

const emit = defineEmits<{
    saved: [];
}>();

const devicesStore = useDevicesStore();
const entityStore = useEntityStore();
const groupStore = useGroupsStore();
const toast = useToastStore();

const {byId: kindById, ensureLoaded: ensureKindsLoaded} = useGroupKinds();
const selectedKindDef = computed(
    () => kindById.value.get(formKind.value) ?? null
);

// ── Active group ──

const activeGroupId = ref<number | null>(null);
const rootGroupId = computed(() => props.groupId ?? null);

// #1 fix: safe access, no non-null assertion
const safeRootGroupName = computed(() => {
    const id = rootGroupId.value;
    return id != null ? (groupStore.groups[id]?.name ?? '') : '';
});

const activeGroup = computed(() =>
    activeGroupId.value != null ? groupStore.groups[activeGroupId.value] : null
);
const activeGroupName = computed(() => activeGroup.value?.name ?? '');

// Picture / appearance editing lives here (works in create and edit). The
// draft seeds from the group in edit mode; on save it is applied via update.
const {
    icon: draftIcon,
    accent: draftAccent,
    imageAssetId: draftImage,
    onSelectAsset: onPickAsset,
    onSelectIcon: onPickIcon,
    onClear: onClearDecoration,
    reset: resetDecoration
} = useDecorationDraft();
const pickerVisible = ref(false);

watch(
    activeGroup,
    (g) => {
        resetDecoration({
            icon: g?.visual?.icon ?? null,
            accent: g?.visual?.accent ?? null
        });
        draftImage.value = g?.imageAssetId ?? null;
    },
    {immediate: true}
);
const isEditingChild = computed(
    () =>
        activeGroupId.value != null && activeGroupId.value !== rootGroupId.value
);

// ── Form state ──

const formName = ref('');
const formKind = ref<string>('manual');
const nameError = ref('');
const selectedMembers = ref<GroupMemberRef[]>([]);
const saving = ref(false);
const deviceSearch = ref('');
const availablePageSize = ref(30);

// Kind-specific metadata only — policy + configProfile are tracked
// separately and merged in on save. GroupMetadataForm owns the per-kind
// input rendering (typed fields + optional key-value extras).
const formKindMetadata = ref<Record<string, unknown>>({});
// Mirrors GroupMetadataForm's `update:invalid` event. True when the form
// holds unresolvable state (invisible fields, duplicate extras keys)
// that the backend would reject. Blocks Save until cleared.
const metadataIsInvalid = ref(false);
const metadataError = ref('');
const formConfigProfile = ref('');
const configProfileKeys = ref<string[]>([]);

// Policy overrides — persist at metadata.policy.*; empty = inherit env default.
const formSeverityFloor = ref<AlertSeverity | ''>('');
const formRetentionDaysText = ref<string>('');
const formAuditRetentionDaysText = ref<string>('');
const retentionDaysError = ref('');
const auditRetentionDaysError = ref('');

// Each policy row: false = using the inherited default; true = overriding.
const overrideSeverity = ref(false);
const overrideRetention = ref(false);
const overrideAudit = ref(false);

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Effective defaults come from the existing group (edit) or, in create mode,
// from the selected preset — so the "Using default" hints are never empty.
const selectedGroupType = computed(() =>
    groupTypeDescriptors.value.find((d) => d.key === formGroupType.value) ?? null
);
const severityDefaultLabel = computed(() => {
    const eff =
        activeGroup.value?.effectiveSeverityFloor ??
        selectedGroupType.value?.severityFloorDefault ??
        null;
    return eff ? `Using default (${capitalize(eff)})` : 'No default set';
});
const retentionDefaultLabel = computed(() => {
    const eff =
        activeGroup.value?.effectiveRetentionDays ??
        selectedGroupType.value?.retentionDaysDefault ??
        null;
    return eff != null ? `Using default (${eff} days)` : 'No default set';
});
const auditDefaultLabel = computed(() => {
    const eff =
        activeGroup.value?.effectiveAuditRetentionDays ??
        selectedGroupType.value?.auditRetentionDaysDefault ??
        null;
    return eff != null ? `Using default (${eff} days)` : 'No default set';
});

function useSeverityDefault(): void {
    formSeverityFloor.value = '';
    overrideSeverity.value = false;
}
function useRetentionDefault(): void {
    formRetentionDaysText.value = '';
    retentionDaysError.value = '';
    overrideRetention.value = false;
}
function useAuditDefault(): void {
    formAuditRetentionDaysText.value = '';
    auditRetentionDaysError.value = '';
    overrideAudit.value = false;
}

// Build the policy from form state via the shared helper. Surfaces
// per-field errors so both retention inputs can highlight simultaneously.
function buildPolicy() {
    retentionDaysError.value = '';
    auditRetentionDaysError.value = '';
    const result = buildPolicyFromForm({
        severityFloor: formSeverityFloor.value,
        retentionDaysText: formRetentionDaysText.value,
        auditRetentionDaysText: formAuditRetentionDaysText.value
    });
    if (!result.ok) {
        retentionDaysError.value = result.errors.retentionDays ?? '';
        auditRetentionDaysError.value = result.errors.auditRetentionDays ?? '';
        return {
            ok: false as const,
            error:
                result.errors.retentionDays ??
                result.errors.auditRetentionDays ??
                ''
        };
    }
    return result;
}

// F.7 — group type picker driven by Organization.GetScopeModel.
const scopeModel = useScopeModelStore();
const formGroupType = ref<string>('standard');
const groupTypeDescriptors = computed(() => scopeModel.groupTypes);
const nestedGroupsEnabled = computed(() =>
    Boolean(scopeModel.capabilities?.nestedGroups)
);
const groupTypeLabels = computed(() =>
    groupTypeDescriptors.value.map((d) => d.label)
);
function groupTypeLabelFor(key: string): string {
    return groupTypeDescriptors.value.find((d) => d.key === key)?.label ?? key;
}
function onGroupTypeSelected(label: string | number | boolean) {
    const descriptor = groupTypeDescriptors.value.find(
        (d) => d.label === String(label)
    );
    if (descriptor) formGroupType.value = descriptor.key;
}

// ── Delete confirmation ──

const deleteConfirmRef = ref<InstanceType<typeof ConfirmationModal>>();
const deleteConfirmTitle = ref('');

// ── Tree state ──

const treeLoading = ref(false);

// #10 fix: track which groups have been edited so we save ALL of them
const dirtyGroupIds = ref(new Set<number>());
type DirtyEntry = {
    name: string;
    members: GroupMemberRef[];
    baselineMembers: GroupMemberRef[];
    metadata: Record<string, unknown>;
    kind: string;
};
const dirtyFormData = ref<Record<number, DirtyEntry>>({});

// WHY separate build + sort: avoid re-sorting on every reactive tick.
// The computed only recalculates when groupStore.groups ref changes.
const childrenMap = computed<Record<number, StoreGroup[]>>(() => {
    const groups = groupStore.groups;
    const map: Record<number, StoreGroup[]> = {};
    const keys = Object.keys(groups);
    for (let i = 0; i < keys.length; i++) {
        const g = groups[Number(keys[i])];
        if (g.parentGroupId != null) {
            (map[g.parentGroupId] ??= []).push(g);
        }
    }
    for (const key in map)
        map[key].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    return map;
});

const treeRoots = computed(() => {
    const id = rootGroupId.value;
    if (id == null) return [];
    const root = groupStore.groups[id];
    return root ? [root] : [];
});

// Show tree only for existing nested legacy structures; new groups are flat.
const showTree = computed(() => {
    if (props.mode !== 'edit' || rootGroupId.value == null) return false;
    if (nestedGroupsEnabled.value) return true;
    return (childrenMap.value[rootGroupId.value]?.length ?? 0) > 0;
});

// Recursively fetch all descendants so the tree is fully populated
async function fetchAllChildren(groupId: number) {
    await groupStore.fetchChildren(groupId);
    const kids = childrenMap.value[groupId] ?? [];
    await Promise.all(kids.map((child: any) => fetchAllChildren(child.id)));
}

// Save current form data to dirty map before switching nodes
function saveToDirtyMap() {
    const id = activeGroupId.value;
    if (id == null || props.mode === 'create') return;
    const existing = dirtyFormData.value[id];
    const baseline = existing?.baselineMembers ?? [
        ...(groupStore.groups[id]?.members ?? [])
    ];
    dirtyGroupIds.value.add(id);
    dirtyFormData.value[id] = {
        name: formName.value,
        members: [...selectedMembers.value],
        baselineMembers: baseline,
        metadata: {...formKindMetadata.value},
        kind: formKind.value
    };
}

function selectGroup(groupId: number) {
    if (activeGroupId.value === groupId) return;
    saveToDirtyMap();
    activeGroupId.value = groupId;
    loadFormFromGroup(groupId);
}

const canSave = computed(
    () =>
        formName.value.trim().length > 0 &&
        !saving.value &&
        !metadataIsInvalid.value
);

// ── Device list ──

const allSubjects = computed<GroupSelectableSubject[]>(() =>
    buildGroupSelectableSubjects({
        devices: Object.values(devicesStore.devices),
        entities: Object.values(entityStore.entities),
        deviceName: (dev) => getDeviceName(dev.info, dev.shellyID)
    })
);

const memberSet = computed(
    () =>
        new Set(
            selectedMembers.value.map(
                (member) => `${member.subjectType}:${member.subjectId}`
            )
        )
);
const memberSubjects = computed(() =>
    allSubjects.value.filter((subject) => memberSet.value.has(subject.key))
);
const availableSubjects = computed(() =>
    allSubjects.value.filter((subject) => !memberSet.value.has(subject.key))
);

// Member filter — reuse the devices-page filter atoms (FilterModal + the shared
// section factories), so facets match the pages: Status, Class, Device Type.
const filterModalVisible = ref(false);
const memberFilters = ref<FilterState>({});
const hasActiveFilter = computed(() =>
    Object.values(memberFilters.value).some((v) => v.length > 0)
);

function matchesSearch(subject: GroupSelectableSubject): boolean {
    if (!deviceSearch.value) return true;
    const q = deviceSearch.value.toLowerCase();
    return subject.searchText.includes(q);
}

function isSubjectOnline(subject: GroupSelectableSubject): boolean {
    return subject.kind === 'device'
        ? (resolveDevice(subject.shellyID)?.online ?? false)
        : (subject.sensor.online ?? false);
}

// A subject's device-class + model, for the Class / Device Type facets.
function subjectClass(subject: GroupSelectableSubject): DeviceType {
    if (subject.kind === 'ble_device') return 'bluetooth';
    return deviceTypeOf(resolveDevice(subject.shellyID)?.source);
}
function subjectApp(subject: GroupSelectableSubject): string {
    if (subject.kind === 'ble_device') return 'BLE sensor';
    return resolveDevice(subject.shellyID)?.info?.app ?? 'Unknown';
}

// Search + Status / Class / Device Type facets; then online first.
function matchesFilters(subject: GroupSelectableSubject): boolean {
    if (!matchesSearch(subject)) return false;
    const f = memberFilters.value;
    if (f.status?.length) {
        const key = isSubjectOnline(subject) ? 'true' : 'false';
        if (!f.status.includes(key)) return false;
    }
    if (f.source?.length && !f.source.includes(subjectClass(subject))) {
        return false;
    }
    if (f.type?.length && !f.type.includes(subjectApp(subject))) return false;
    return true;
}
function byOnlineFirst(
    a: GroupSelectableSubject,
    b: GroupSelectableSubject
): number {
    return Number(isSubjectOnline(b)) - Number(isSubjectOnline(a));
}

const memberFilterSections = computed<FilterSection[]>(() => {
    const subjects = allSubjects.value;
    const onlineCount = subjects.filter(isSubjectOnline).length;
    return [
        booleanSection(
            'status',
            'Status',
            'fa-wifi',
            'Online',
            'Offline',
            onlineCount,
            subjects.length - onlineCount
        ),
        deviceClassSection(countByKey(subjects, subjectClass)),
        enumSection(
            'type',
            'Device Type',
            'fa-microchip',
            countByKey(subjects, subjectApp)
        )
    ];
});

const memberFilterInitialState = computed<FilterState>(() => ({
    ...memberFilters.value
}));

function onApplyMemberFilter(state: FilterState): void {
    memberFilters.value = state;
    filterModalVisible.value = false;
}

const filteredMembers = computed(() =>
    memberSubjects.value.filter(matchesFilters).slice().sort(byOnlineFirst)
);
const filteredAvailable = computed(() =>
    availableSubjects.value.filter(matchesFilters).slice().sort(byOnlineFirst)
);
// Split available into online / offline (like the devices tab), online first.
const onlineAvailable = computed(() =>
    filteredAvailable.value.filter(isSubjectOnline)
);
const offlineAvailable = computed(() =>
    filteredAvailable.value.filter((s) => !isSubjectOnline(s))
);
const paginatedOnline = computed(() =>
    onlineAvailable.value.slice(0, availablePageSize.value)
);
const paginatedOffline = computed(() =>
    offlineAvailable.value.slice(
        0,
        Math.max(0, availablePageSize.value - onlineAvailable.value.length)
    )
);
const availableShownCount = computed(
    () => paginatedOnline.value.length + paginatedOffline.value.length
);

function resolveDevice(shellyID: string) {
    return devicesStore.devices[shellyID] ?? null;
}

function addMember(member: GroupMemberRef) {
    const key = `${member.subjectType}:${member.subjectId}`;
    if (!memberSet.value.has(key)) selectedMembers.value.push(member);
}

function removeMember(member: GroupMemberRef) {
    const key = `${member.subjectType}:${member.subjectId}`;
    const idx = selectedMembers.value.findIndex(
        (item) => `${item.subjectType}:${item.subjectId}` === key
    );
    if (idx >= 0) selectedMembers.value.splice(idx, 1);
}

function clearAllMembers() {
    selectedMembers.value = [];
}

// Everything is picked when nothing is left to add.
const allMembersSelected = computed(() => availableSubjects.value.length === 0);
function toggleSelectAll(): void {
    if (allMembersSelected.value) {
        clearAllMembers();
        return;
    }
    for (const subject of [...availableSubjects.value]) addMember(subject.ref);
}


// #8 fix: capture parentGroupId BEFORE delete
async function performDeleteSubgroup(
    childId: number,
    childName: string,
    parentGroupId: number | null
) {
    try {
        await groupStore.deleteGroup(childId);
        toast.info(`Subgroup '${childName}' deleted.`);
        const root = rootGroupId.value;
        if (activeGroupId.value === childId && root != null) selectGroup(root);
        if (parentGroupId != null)
            await groupStore.fetchChildren(parentGroupId);
    } catch (err: any) {
        toastRpcError(toast, err, 'Failed to delete subgroup');
    }
}

function confirmDeleteSubgroup(childId: number) {
    const g = groupStore.groups[childId];
    const childName = g?.name ?? `#${childId}`;
    const parentGroupId = g?.parentGroupId ?? null;
    deleteConfirmTitle.value = `Delete subgroup "${childName}"?`;
    deleteConfirmRef.value?.storeAction(() =>
        performDeleteSubgroup(childId, childName, parentGroupId)
    );
}

// ── Form ↔ Store ──

function loadFormFromGroup(groupId: number) {
    // #10: load from dirty map if this group was previously edited
    const dirty = dirtyFormData.value[groupId];
    if (dirty) {
        formName.value = dirty.name;
        selectedMembers.value = [...dirty.members];
        formKindMetadata.value = {...dirty.metadata};
        formKind.value = dirty.kind;
    } else {
        const g = groupStore.groups[groupId];
        formName.value = g?.name ?? '';
        selectedMembers.value = [...(g?.members ?? [])];
        formKindMetadata.value = extractKindMetadata(g?.metadata);
        formKind.value =
            typeof g?.kind === 'string' && g.kind.length > 0
                ? g.kind
                : 'manual';
    }
    // Load config profile from metadata (not shown in the kind form)
    const g = groupStore.groups[groupId];
    formConfigProfile.value = configProfileFromMetadata(g?.metadata);
    // Load policy overrides from metadata.policy
    const policy = policyFromMetadata(g?.metadata);
    const sev = policy?.severityFloor;
    formSeverityFloor.value =
        typeof sev === 'string' &&
        (ALERT_SEVERITIES as readonly string[]).includes(sev)
            ? (sev as AlertSeverity)
            : '';
    formRetentionDaysText.value =
        typeof policy?.retentionDays === 'number'
            ? String(policy.retentionDays)
            : '';
    formAuditRetentionDaysText.value =
        typeof policy?.auditRetentionDays === 'number'
            ? String(policy.auditRetentionDays)
            : '';
    retentionDaysError.value = '';
    auditRetentionDaysError.value = '';
    // A stored value means the group overrides; otherwise it inherits.
    overrideSeverity.value = formSeverityFloor.value !== '';
    overrideRetention.value = formRetentionDaysText.value !== '';
    overrideAudit.value = formAuditRetentionDaysText.value !== '';
    deviceSearch.value = '';
    availablePageSize.value = 30;
    metadataError.value = '';
    nameError.value = '';
}

// ── Validation ──

function validateName(): boolean {
    const trimmed = formName.value.trim();
    if (!trimmed) {
        nameError.value = 'Group name is required';
        return false;
    }
    if (trimmed.length > NAME_MAX_LENGTH) {
        nameError.value = `Max ${NAME_MAX_LENGTH} characters`;
        return false;
    }
    nameError.value = '';
    return true;
}

// Compose the final metadata payload: kind-specific fields from the
// GroupMetadataForm + the reserved configProfile + policy slots managed
// outside it. Returns null if any sub-validator rejects.
function validateMetadata(): MetadataRecord | null {
    metadataError.value = '';
    const policyResult = buildPolicy();
    if (!policyResult.ok) return null;
    const data: MetadataRecord = {...formKindMetadata.value};
    if (formConfigProfile.value) data.configProfile = formConfigProfile.value;
    else delete data.configProfile;
    if (policyResult.data) data.policy = policyResult.data;
    else delete data.policy;
    return data;
}

// ── Save ──

// Validate all dirty groups — returns error message or null if all valid
function validateAllDirtyGroups(): string | null {
    saveToDirtyMap();
    // Policy overrides apply to the active group only — validate once.
    const policyResult = buildPolicy();
    if (!policyResult.ok) return policyResult.error;
    for (const id of dirtyGroupIds.value) {
        const data = dirtyFormData.value[id];
        if (!data) continue;
        if (!data.name.trim())
            return `Group name cannot be empty (group #${id}).`;
        if (data.name.trim().length > NAME_MAX_LENGTH)
            return `Name too long (group "${data.name}").`;
    }
    return null;
}

async function syncGroupMembers(
    id: number,
    baseline: GroupMemberRef[],
    target: GroupMemberRef[]
) {
    const {toAdd, toRemove} = diffSubjectMembers(baseline, target);
    await Promise.all([
        toAdd.length > 0
            ? groupStore.addMembers(id, toAdd)
            : Promise.resolve(),
        toRemove.length > 0
            ? groupStore.removeMembers(id, toRemove)
            : Promise.resolve()
    ]);
}

function buildUpdateMetadata(id: number, data: DirtyEntry): MetadataRecord {
    const metadata: MetadataRecord = {...data.metadata};
    // Reserved slots (configProfile + policy) are tracked at the modal
    // level — only the active group's form state has them in scope.
    if (id === activeGroupId.value) {
        if (formConfigProfile.value)
            metadata.configProfile = formConfigProfile.value;
        else delete metadata.configProfile;
        const policyResult = buildPolicy();
        if (policyResult.ok && policyResult.data)
            metadata.policy = policyResult.data;
        else delete metadata.policy;
    }
    return metadata;
}

async function saveDirtyGroup(id: number, data: DirtyEntry): Promise<void> {
    const metadata = buildUpdateMetadata(id, data);
    // Only the active group has its kind in formKind right now; for other
    // dirty groups in the tree we leave kind untouched (PG keeps current).
    const kindPatch =
        id === activeGroupId.value &&
        formKind.value !== groupStore.groups[id]?.kind
            ? {kind: formKind.value}
            : {};
    await groupStore.updateGroup({
        id,
        patch: {name: data.name.trim(), metadata, ...kindPatch}
    });
    await syncGroupMembers(id, data.baselineMembers, data.members);
}

async function saveAllDirtyGroups() {
    const entries = [...dirtyGroupIds.value]
        .map((id): [number, DirtyEntry] | null => {
            const data = dirtyFormData.value[id];
            return data ? [id, data] : null;
        })
        .filter((e): e is [number, DirtyEntry] => e !== null);

    const results = await Promise.allSettled(
        entries.map(([id, data]) => saveDirtyGroup(id, data))
    );

    // Refresh failed groups — update + member sync aren't atomic server-side.
    const failedIds: number[] = [];
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            const [id, data] = entries[i];
            failedIds.push(id);
            toast.error(
                `Failed to save '${data.name}': ${formatRpcError(result.reason, 'unknown error')}`
            );
        }
    });
    if (failedIds.length > 0) {
        await Promise.allSettled(
            failedIds.map((id) => groupStore.fetchGroup(id))
        );
    }
}

// Persist the picked icon/accent/image — only when it actually changed.
async function applyDecoration(groupId: number | null | undefined): Promise<void> {
    if (groupId == null) return;
    const g = groupStore.groups[groupId];
    const sameIcon = (g?.visual?.icon ?? null) === draftIcon.value;
    const sameAccent = (g?.visual?.accent ?? null) === draftAccent.value;
    const sameImage = (g?.imageAssetId ?? null) === draftImage.value;
    if (sameIcon && sameAccent && sameImage) return;
    await groupStore.updateGroup({
        id: groupId,
        patch: {
            visual: {
                icon: draftIcon.value ?? undefined,
                accent: draftAccent.value ?? undefined
            },
            imageAssetId: draftImage.value
        }
    });
}

async function handleSave() {
    // Guard against double-clicks: the button's :disabled binding takes
    // a render cycle to apply, so two rapid clicks could otherwise queue
    // two createGroup calls and produce a duplicate-name conflict.
    if (saving.value) return;
    saving.value = true;
    try {
        if (!validateName()) return;
        const metadata = validateMetadata();
        if (metadata === null) return;

        if (props.mode === 'create') {
            const groupName = formName.value.trim();
            const created = await groupStore.createGroup({
                name: groupName,
                metadata,
                groupType: formGroupType.value,
                kind: formKind.value,
                members: selectedMembers.value
            });
            await applyDecoration(created?.id);
            toast.success(`Group '${groupName}' created.`);
        } else {
            const validationError = validateAllDirtyGroups();
            if (validationError) {
                toast.error(validationError);
                return;
            }
            await saveAllDirtyGroups();
            await applyDecoration(activeGroupId.value);
            toast.success('Changes saved.');
        }
        visible.value = false;
        emit('saved');
    } catch (err: any) {
        toastRpcError(toast, err, 'Failed to save group');
    } finally {
        saving.value = false;
    }
}

function close() {
    visible.value = false;
}

// ── Init ──

watch(
    () => visible.value,
    async (isOpen) => {
        if (!isOpen) return;
        loadConfigProfileKeys();
        void scopeModel.fetch();
        // Reset transient error / validity state from any previous open.
        nameError.value = '';
        metadataError.value = '';
        metadataIsInvalid.value = false;
        dirtyGroupIds.value = new Set<number>();
        dirtyFormData.value = {};
        void entityStore.fetchEntities();

        if (props.mode === 'edit' && props.groupId != null) {
            activeGroupId.value = props.groupId;
            await groupStore.fetchGroup(props.groupId);
            loadFormFromGroup(props.groupId);
            treeLoading.value = true;
            fetchAllChildren(props.groupId).finally(() => {
                treeLoading.value = false;
            });
        } else {
            activeGroupId.value = null;
            formName.value = '';
            formKind.value = 'manual';
            formConfigProfile.value = '';
            formSeverityFloor.value = '';
            formRetentionDaysText.value = '';
            formAuditRetentionDaysText.value = '';
            retentionDaysError.value = '';
            auditRetentionDaysError.value = '';
            overrideSeverity.value = false;
            overrideRetention.value = false;
            overrideAudit.value = false;
            selectedMembers.value = [];
            formKindMetadata.value = {};
        }
        void ensureKindsLoaded();
    },
    {immediate: true}
);

function loadConfigProfileKeys(): void {
    getRegistry('configs')
        .keys()
        .then((keys: string[]) => {
            configProfileKeys.value = keys ?? [];
        })
        .catch((error) => {
            debugWarn('Group config profile keys load failed', error);
        });
}
</script>

<style scoped>
/* ═══ LAYOUT ═══ */
.egm { display: flex; flex-direction: column; gap: var(--space-6); }

.egm-title { display: flex; align-items: center; gap: var(--space-2); font-size: var(--type-subheading); font-weight: 700; }

/* ═══ TOP — tree (38.2%) + form (61.8%) ═══ */
.egm__top { display: flex; gap: var(--space-5); }

.egm__tree {
    display: flex; flex-direction: column; gap: var(--space-1);
    max-height: 340px; overflow-y: auto; padding: var(--space-3);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg); background: var(--color-surface-1);
    box-shadow:
        var(--card-shadow-contact),
        inset 0 1px 0 var(--glass-highlight);
}
.egm__tree-spinner { margin: var(--space-5) auto; }

.egm__form { display: flex; flex-direction: column; gap: var(--space-5); flex: 1; }
.egm__form-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); }
/* Advanced settings stack in a single clean column. */
/* Advanced settings: even rows separated by hairlines — reads as a tidy
   settings list rather than a stack of heavy boxed controls. */
.egm__advanced-fields { display: flex; flex-direction: column; }
.egm__advanced-fields > .egm__field,
.egm__advanced-fields > .egm__adv-pair { padding: var(--space-4) 0; }
.egm__advanced-fields > .egm__field { gap: var(--space-3); }
.egm__advanced-fields > :first-child { padding-top: 0; }
.egm__advanced-fields > :last-child { padding-bottom: 0; }
.egm__advanced-fields > :not(:last-child) {
    border-bottom: 1px solid var(--divider-hairline);
}
/* Config profile + Kind share a row. */
.egm__adv-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-5);
    align-items: start;
}

.egm__top--has-tree .egm__tree { flex: 0 0 38.2%; }
.egm__top--has-tree .egm__form { flex: 1; min-width: 0; }

.egm__field { display: flex; flex-direction: column; gap: var(--space-2); }

/* Alerts & data — one row per policy: name, control/default, override link */
/* Flat policy rows — no heavy box; the advanced hairlines separate sections. */
.egm__policy {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.egm__policy-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}
.egm__policy-name {
    flex: 0 0 auto;
    width: 11rem;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.egm__policy-control {
    flex: 1 1 auto;
    min-width: 0;
}
.egm__policy-default {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.egm__policy-link {
    flex: 0 0 auto;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    font-weight: var(--font-semibold);
    color: var(--color-primary-text);
}
.egm__policy-link:hover {
    text-decoration: underline;
}

/* Picture + name: a centered header — the picture leads, the name sits under
   it at a constrained width so it reads like a title, not a stretched field. */
.egm__identity {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
    padding-bottom: var(--space-2);
}
.egm__identity-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    max-width: 20rem;
}
.egm__field--full { grid-column: 1 / -1; }
.egm__label {
    font-size: var(--type-body); font-weight: 700; color: var(--color-text-primary);
    display: flex; align-items: center; gap: var(--space-2);
}

/* ── Advanced settings (collapsed by default — keeps create/edit focused
      on name + members; everything optional hides here) ── */
.egm__advanced {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}
.egm__advanced-summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    cursor: pointer;
    list-style: none;
    user-select: none;
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}
.egm__advanced-summary::-webkit-details-marker { display: none; }
.egm__advanced-icon { color: var(--color-primary); opacity: 0.7; }
.egm__advanced-hint {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
}
.egm__advanced-caret {
    margin-left: auto;
    color: var(--color-text-tertiary);
    transition: transform var(--motion-hover);
}
.egm__advanced[open] .egm__advanced-caret { transform: rotate(180deg); }
.egm__advanced[open] .egm__advanced-hint { display: none; }
.egm__advanced-body {
    padding: var(--space-4) var(--space-3) var(--space-3);
    border-top: 1px solid var(--divider-hairline);
}

/* ── Chips ── */
.egm__chips { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.egm__chip {
    display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px dashed var(--color-border-medium);
    background: transparent; color: var(--color-text-disabled);
    font-size: var(--type-body); font-weight: 600; cursor: pointer;
    transition: color var(--duration-fast), border-color var(--duration-fast), background var(--duration-fast);
}
.egm__chip:hover {
    color: var(--color-primary); border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 4%, transparent);
}

/* ── Pending subgroups ── */
.egm__pending-list {
    display: flex; flex-direction: column;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg); background: var(--color-surface-1); overflow: hidden;
    box-shadow:
        var(--card-shadow-contact),
        inset 0 1px 0 var(--glass-highlight);
}
.egm__pending-row {
    display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-medium);
}
.egm__pending-row:last-child { border-bottom: none; }
.egm__pending-icon { color: var(--color-text-disabled); font-size: var(--type-body); }
.egm__pending-name { flex: 1; font-size: var(--type-body); font-weight: 600; color: var(--color-text-primary); }
.egm__inline-create { display: flex; gap: var(--space-2); align-items: center; }

/* ═══ SECTIONS ═══ */
.egm__section {
    display: flex; flex-direction: column; gap: var(--space-3);
    padding-top: var(--space-5);
    border-top: 1px solid var(--divider-hairline);
}
.egm__section-hdr {
    display: flex; align-items: center; gap: var(--space-3);
    padding-bottom: var(--space-1);
}
.egm__section-title { font-size: var(--type-subheading); font-weight: 700; color: var(--color-text-primary); line-height: 1.1; }
.egm__badge {
    font-size: var(--type-caption); font-weight: 700;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
    border: 1px solid color-mix(in srgb, var(--color-primary) 28%, transparent);
}

/* ═══ DEVICE PANEL ═══ */
.egm__device-panel {
    display: flex; flex-direction: column; gap: var(--space-4);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg); padding: var(--space-4); background: var(--color-surface-1);
    box-shadow:
        var(--card-shadow-contact),
        inset 0 1px 0 var(--glass-highlight);
}
.egm__device-group { display: flex; flex-direction: column; gap: var(--space-2); }
.egm__device-group-label { font-size: var(--type-body); font-weight: 700; color: var(--color-text-disabled); padding: var(--space-2) 0; }

/* Search + Select-all share a row; the search shrinks to leave room. */
.egm__member-bar { display: flex; align-items: center; gap: var(--space-2); }
.egm__member-search { flex: 1; min-width: 0; }

/* ── Pools (selected / available) ── */
.egm__pool { display: flex; flex-direction: column; gap: var(--space-2); }
/* Online / offline section count next to the dc-section label. */
.egm__sec-count {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-quaternary);
    font-variant-numeric: tabular-nums;
}
.egm__pool--selected {
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--divider-hairline);
}
.egm__pool-hdr {
    position: sticky; top: 0;
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) 0;
    background: var(--color-surface-1);
    z-index: var(--z-raised);
}
.egm__pool-icon { font-size: var(--icon-size-sm); color: var(--color-primary); }
.egm__pool-icon--muted { color: var(--color-text-tertiary); }
.egm__pool-label {
    font-size: var(--type-body); font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    letter-spacing: var(--tracking-tight);
}
.egm__pool-count {
    font-size: var(--type-caption); font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    margin-left: auto;
}
.egm__pool-grid { max-height: none; overflow: visible; }

/* ── Count meter (header KPI) ── */
.egm__count-meter {
    display: inline-flex; align-items: baseline;
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
    margin-left: auto;
}
.egm__count-val {
    font-size: var(--type-body); font-weight: var(--font-bold);
    color: var(--color-primary);
}
.egm__count-sep {
    font-size: var(--type-caption);
    padding: 0 var(--space-1);
    color: var(--color-text-quaternary);
}
.egm__count-total {
    font-size: var(--type-caption);
}

/* ── Inline link button (Clear all etc.) ── */
.egm__link-btn {
    background: none; border: none; cursor: pointer;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    font-size: var(--type-caption); font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    transition: color var(--motion-hover), background var(--motion-hover);
}
.egm__link-btn:hover {
    color: var(--color-danger-text);
    background: var(--state-hover-bg);
}

.egm__show-more {
    display: flex; align-items: center; justify-content: center;
    padding: var(--space-3); border: none; background: none;
    color: var(--color-primary); font-size: var(--type-body); font-weight: 600;
    cursor: pointer; transition: opacity var(--duration-fast);
}
.egm__show-more:hover { opacity: 0.8; }

/* ═══ ICON BUTTONS ═══ */
/* 34px visual, 48px hit area via ::after */
.egm__icon-btn {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; flex-shrink: 0;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-medium);
    background: var(--color-surface-1); color: var(--color-text-disabled); cursor: pointer;
    position: relative;
    transition: background var(--duration-fast), color var(--duration-fast), border-color var(--duration-fast);
}
.egm__icon-btn::after { content: ""; position: absolute; inset: -7px; }
.egm__icon-btn:hover { background: var(--color-surface-3); border-color: var(--color-border-medium); color: var(--color-text-primary); }
.egm__icon-btn--confirm { color: var(--color-primary); border-color: color-mix(in srgb, var(--color-primary) 30%, transparent); }
.egm__icon-btn--confirm:hover { background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface-1)); }
.egm__icon-btn--danger { color: var(--color-danger-text); }
.egm__icon-btn--danger:hover {
    background: color-mix(in srgb, var(--color-danger-text) 10%, var(--color-surface-1));
    border-color: color-mix(in srgb, var(--color-danger-text) 30%, transparent);
}

/* ═══ STATES ═══ */
.egm__empty { font-size: var(--type-body); color: var(--color-text-disabled); padding: var(--space-3); text-align: center; }
.egm__hint { font-size: var(--type-body); color: var(--color-text-tertiary); padding: var(--space-2) 0; }
.egm__error { font-size: var(--type-body); color: var(--color-status-red); margin-top: var(--gap-xs); }
.egm__hint { font-size: var(--type-body); color: var(--color-text-quaternary); margin-top: var(--gap-xs); }
.egm__footer { display: flex; justify-content: flex-end; gap: var(--space-2); }

/* ═══ MOBILE ═══ */
@media (max-width: 768px) {
    .egm__top { flex-direction: column; }
    .egm__top--has-tree .egm__tree, .egm__top--has-tree .egm__form { flex: none; }
    .egm__tree { max-height: 200px; }
    .egm__form-cols { grid-template-columns: 1fr; }
}
</style>

<!--
    Child-component overrides for the DeviceFleetCard grid inside the
    members panel. Lives in a non-scoped block (and keyed by .egm__device-panel
    so it never leaks outside this modal) because scoped + child-class
    descent (`:deep(.dc-grid)`) trips biome's noUnknownPseudoClass rule.
-->
<style>
/* Device grid is the shared .dc-grid, untouched — the exact same cards and
   sizing as the devices page. No column overrides (those stretched them). */
</style>
