<template>
    <WizardStep
        name="details"
        lede="Give the device a clear name and category so it is easy to find later."
    >
        <div class="dds__layout">
            <!-- Left: form -->
            <div class="dds__form">
                <FormField label="Name" :error="nameError">
                    <Input
                        v-model="name"
                        placeholder="e.g. Garage essentials"
                        autocomplete="off"
                    />
                </FormField>

                <FormField label="Category">
                    <Dropdown
                        :options="CATEGORY_LABELS"
                        :default="categoryLabel"
                        @selected="onCategorySelect"
                    />
                </FormField>

                <FormField label="Location">
                    <Dropdown
                        :groups="locationGroups"
                        :default="locationId ?? NO_LOCATION_VALUE"
                        @selected="onLocationSelect"
                    />
                </FormField>

                <FormField label="Tags">
                    <div class="dds__chips">
                        <span
                            v-for="id in draft.details.tagIds"
                            :key="id"
                            class="dds__chip"
                        >
                            {{ tagName(id) }}
                            <button
                                type="button"
                                class="icon-ghost-btn dds__chip-remove"
                                :aria-label="`Remove tag ${tagName(id)}`"
                                @click="removeTag(id)"
                            >
                                <i class="fas fa-xmark" aria-hidden="true" />
                            </button>
                        </span>
                        <Dropdown
                            v-if="addableTags.length > 0"
                            :groups="addableTagGroups"
                            placeholder="Add tag…"
                            @selected="addTag"
                        />
                    </div>
                </FormField>

                <FormField label="Groups">
                    <div class="dds__chips">
                        <span
                            v-for="id in draft.details.groupIds"
                            :key="id"
                            class="dds__chip"
                        >
                            {{ groupName(id) }}
                            <button
                                type="button"
                                class="icon-ghost-btn dds__chip-remove"
                                :aria-label="`Remove group ${groupName(id)}`"
                                @click="removeGroup(id)"
                            >
                                <i class="fas fa-xmark" aria-hidden="true" />
                            </button>
                        </span>
                        <Dropdown
                            v-if="addableGroups.length > 0"
                            :groups="addableGroupDropdownGroups"
                            placeholder="Add group…"
                            @selected="addGroup"
                        />
                    </div>
                </FormField>

                <FormField
                    v-if="draft.details.categoryKey === 'energy'"
                    label="Energy role"
                    :optional="true"
                    hint="What is this on your energy setup? Most are a load."
                >
                    <Dropdown
                        :groups="energyRoleGroups"
                        :default="draft.energyRole ?? 'load'"
                        @selected="onEnergyRoleSelect"
                    />
                </FormField>
            </div>

            <!-- Right: preview card -->
            <div class="dds__preview">
                <div class="dds__normal-preview">
                    <DeviceFleetCard
                        v-if="draft.previewDevice"
                        :device="draft.previewDevice"
                        label="Virtual Device"
                    >
                        <template #footer>
                            <button
                                type="button"
                                class="dds__appearance-btn"
                                aria-label="Appearance: pick device icon or image"
                                title="Pick device icon or image"
                                @click.stop="pickerVisible = true"
                            >
                                Appearance
                            </button>
                        </template>
                    </DeviceFleetCard>

                    <div v-else class="dds__empty-preview">
                        <button
                            type="button"
                            class="dds__empty-preview-icon"
                            aria-label="Pick device icon or image"
                            title="Pick device icon or image"
                            @click="pickerVisible = true"
                        >
                            <i class="fas fa-pen" aria-hidden="true" />
                        </button>
                        <span>Name the device and connect parts to preview it.</span>
                    </div>

                    <div
                        v-if="draft.previewEntities.length > 0"
                        class="dds__component-preview"
                    >
                        <EntityWidget
                            v-for="entity in draft.previewEntities"
                            :key="entity.id"
                            :entity="entity"
                            :source-device="draft.previewDevice"
                            vertical
                            class="dds__entity-card"
                        />
                    </div>

                    <div v-if="missingRoles.length > 0" class="dds__missing">
                        <div
                            v-for="role in missingRoles"
                            :key="role.roleKey"
                            class="dds__missing-row"
                        >
                            <span>{{ role.label }}</span>
                            <small>{{ role.required ? 'Required' : 'Optional' }}</small>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <AssetPickerModal
            :visible="pickerVisible"
            :initial-selected-asset-id="draft.details.imageAssetId"
            :initial-selected-image-model="draft.details.visual.imageModel ?? null"
            :initial-selected-icon="draft.details.visual.icon ?? null"
            :initial-selected-accent="draft.details.visual.accent ?? null"
            default-context="device"
            @close="pickerVisible = false"
            @select-asset="onLibraryPick"
            @select-device-picture="onDevicePicturePick"
            @select-icon="onIconPick"
            @clear="clearImage"
        />
    </WizardStep>
</template>

<script setup lang="ts">
import type {EnergyMeterRole} from '@api/energy';
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import type {VisualAsset} from '@/api/assetRpc';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import WizardStep from '@/components/core/wizard/WizardStep.vue';
import AssetPickerModal from '@/components/modals/AssetPickerModal.vue';
import EntityWidget from '@/components/widgets/EntityWidget.vue';
import {DEVICE_CATEGORIES} from '@/helpers/deviceCategories';
import {energyRolesForUtility} from '@/helpers/energyAssignment';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import {useVirtualDeviceDraftStore} from '@/stores/virtualDeviceDraftStore';

// ── Constants ──────────────────────────────────────────────────────────────

const NONE_LABEL = '— None —';
const NO_LOCATION_VALUE = -1 as const;

const CATEGORY_LABELS: string[] = [
    NONE_LABEL,
    ...DEVICE_CATEGORIES.map((c) => c.label)
];

// ── Store & composables ────────────────────────────────────────────────────

const draft = useVirtualDeviceDraftStore();
const locationsStore = useLocationsStore();
const tagsStore = useTagsStore();
const groupsStore = useGroupsStore();

onMounted(() => {
    void locationsStore.fetchLocations();
    void tagsStore.fetchTags();
    void groupsStore.fetchGroups();
});

// ── Name ──────────────────────────────────────────────────────────────────

const name = computed({
    get: () => draft.details.name,
    set: (v: string) => {
        draft.details.name = v;
    }
});

const nameError = computed(() => {
    const trimmed = draft.details.name.trim();
    if (!trimmed && draft.details.name.length > 0) return 'Cannot be blank';
    if (trimmed.length > 120) return 'Too long (max 120)';
    return undefined;
});

// ── Category ──────────────────────────────────────────────────────────────

const categoryLabel = computed(() => {
    const key = draft.details.categoryKey;
    if (!key) return NONE_LABEL;
    return DEVICE_CATEGORIES.find((c) => c.key === key)?.label ?? NONE_LABEL;
});

function onCategorySelect(label: string): void {
    if (label === NONE_LABEL) {
        draft.details.categoryKey = null;
        return;
    }
    const cat = DEVICE_CATEGORIES.find((c) => c.label === label);
    draft.details.categoryKey = cat?.key ?? null;
}

// ── Location ──────────────────────────────────────────────────────────────

const locationId = computed(() => draft.details.locationId);

const locationGroups = computed(() => {
    const locs = Object.values(locationsStore.locations);
    return [
        {
            label: '',
            items: [
                {value: NO_LOCATION_VALUE as number, label: '— No location —'}
            ]
        },
        {
            label: 'Locations',
            items: locs.map((loc) => ({
                value: loc.id,
                label: loc.name
            }))
        }
    ];
});

function onLocationSelect(value: number): void {
    draft.details.locationId = value === NO_LOCATION_VALUE ? null : value;
}

// ── Tags ──────────────────────────────────────────────────────────────────

function tagName(id: number): string {
    return tagsStore.tags[id]?.name ?? String(id);
}

const addableTags = computed(() => {
    const selected = new Set(draft.details.tagIds);
    return Object.values(tagsStore.tags)
        .filter((t) => !selected.has(t.id))
        .sort((a, b) => a.name.localeCompare(b.name));
});

const addableTagGroups = computed(() => [
    {
        label: 'Tags',
        items: addableTags.value.map((t) => ({value: t.id, label: t.name}))
    }
]);

function addTag(id: number): void {
    if (!draft.details.tagIds.includes(id)) {
        draft.details.tagIds = [...draft.details.tagIds, id];
    }
}

function removeTag(id: number): void {
    draft.details.tagIds = draft.details.tagIds.filter((t) => t !== id);
}

// ── Groups ────────────────────────────────────────────────────────────────

function groupName(id: number): string {
    return groupsStore.groups[id]?.name ?? String(id);
}

const addableGroups = computed(() => {
    const selected = new Set(draft.details.groupIds);
    return Object.values(groupsStore.groups)
        .filter((g) => !selected.has(g.id))
        .sort((a, b) => a.name.localeCompare(b.name));
});

const addableGroupDropdownGroups = computed(() => [
    {
        label: 'Groups',
        items: addableGroups.value.map((g) => ({value: g.id, label: g.name}))
    }
]);

function addGroup(id: number): void {
    if (!draft.details.groupIds.includes(id)) {
        draft.details.groupIds = [...draft.details.groupIds, id];
    }
}

function removeGroup(id: number): void {
    draft.details.groupIds = draft.details.groupIds.filter((g) => g !== id);
}

// ── Energy role ───────────────────────────────────────────────────────────

const ELECTRIC_ROLES = energyRolesForUtility('electric');

const energyRoleGroups = computed(() => [
    {
        label: 'Role',
        items: ELECTRIC_ROLES.map((r) => ({value: r.role, label: r.label}))
    }
]);

const energyRoleLabel = computed(() => {
    if (!draft.energyRole) return '';
    return (
        ELECTRIC_ROLES.find((r) => r.role === draft.energyRole)?.label ?? ''
    );
});

function onEnergyRoleSelect(role: EnergyMeterRole): void {
    draft.energyRole = role;
}

const missingRoles = computed(() =>
    draft.roles.filter((role) => role.source === null)
);

// ── Image picker (kept from original — modal is still wired) ──────────────

const pickerVisible = ref(false);
const previewObjectUrl = ref<string | null>(null);

function onLibraryPick(asset: VisualAsset): void {
    revokePreview();
    draft.details.pendingImageFile = null;
    draft.details.imageAssetId = asset.id;
    draft.details.visual = {};
}

function onDevicePicturePick(picture: {model: string}): void {
    revokePreview();
    draft.details.pendingImageFile = null;
    draft.details.imageAssetId = null;
    draft.details.visual = {
        imageModel: picture.model
    };
}

function onIconPick(decoration: {icon: string; accent: string | null}): void {
    revokePreview();
    draft.details.pendingImageFile = null;
    draft.details.imageAssetId = null;
    draft.details.visual = {
        icon: decoration.icon,
        accent: decoration.accent ?? undefined
    };
}

function clearImage(): void {
    revokePreview();
    draft.details.pendingImageFile = null;
    draft.details.imageAssetId = null;
    draft.details.visual = {};
}

function revokePreview(): void {
    if (previewObjectUrl.value) {
        URL.revokeObjectURL(previewObjectUrl.value);
        previewObjectUrl.value = null;
    }
}

watch(
    () => draft.details.pendingImageFile,
    (file) => {
        if (!file) revokePreview();
    }
);

onBeforeUnmount(revokePreview);
</script>

<style scoped>
.dds__layout {
    display: grid;
    grid-template-columns: 1fr var(--dds-preview-width);
    gap: var(--gap-lg);
    align-items: start;
}

/* ── Form ── */

.dds__form {
    display: grid;
    gap: var(--gap-md);
}

/* Inline chip row for tags/groups */
.dds__chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-xs);
    min-height: var(--touch-target-min);
}

.dds__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2xs);
    padding: var(--space-0-5) var(--gap-xs);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    line-height: 1;
    white-space: nowrap;
    border: var(--space-px) solid var(--color-border-medium);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
}

/* Sits on the chip's own colour until hovered, so a row of chips stays calm. */
.dds__chip-remove {
    color: inherit;
    font-size: var(--type-caption);
    line-height: 1;
    opacity: 0.6;
    transition: opacity var(--duration-fast) var(--ease-default);
}

.dds__chip-remove:hover,
.dds__chip-remove:focus-visible {
    opacity: 1;
    color: var(--color-danger-text);
}

/* ── Preview ── */

.dds__preview {
    position: sticky;
    top: 0;
    display: grid;
    gap: var(--gap-xs);
}

.dds__normal-preview {
    display: grid;
    gap: var(--gap-sm);
}

.dds__appearance-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: var(--touch-target-min);
    border: var(--space-px) solid var(--color-border-medium);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition:
        color var(--duration-fast) var(--ease-default),
        border-color var(--duration-fast) var(--ease-default);
}

.dds__appearance-btn:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
}

.dds__appearance-btn:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.dds__empty-preview {
    display: grid;
    place-items: center;
    gap: var(--gap-xs);
    min-height: var(--wizard-state-min-height);
    padding: var(--gap-md);
    border: var(--space-px) dashed var(--color-border-medium);
    border-radius: var(--radius-lg);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    text-align: center;
}

.dds__empty-preview-icon {
    display: inline-grid;
    place-items: center;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border: var(--space-px) solid var(--color-border-medium);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    cursor: pointer;
}

.dds__empty-preview-icon:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.dds__component-preview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--gap-xs);
}

.dds__entity-card {
    min-width: 0;
}

.dds__missing {
    display: grid;
    gap: var(--gap-2xs);
}

.dds__missing-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-xs);
    padding: var(--gap-xs);
    border: var(--space-px) solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
}

.dds__missing-row small {
    color: var(--color-text-tertiary);
}

/* Narrow the "Add…" dropdown trigger to fit inside the chip row */
.dds__chips :deep(.dropdown-anchor) {
    width: auto;
}

.dds__chips :deep(.dropdown-trigger) {
    min-height: unset;
    padding: var(--space-0-5) var(--gap-xs);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    border-style: dashed;
    color: var(--color-text-secondary);
    background: transparent;
}

/* One column once the preview column can no longer hold a card. */
@media (max-width: 768px) {
    .dds__layout {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--gap-md);
    }

    .dds__preview {
        position: static;
    }
}
</style>
