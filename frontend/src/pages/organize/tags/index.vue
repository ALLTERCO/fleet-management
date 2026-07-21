<template>
    <PageTemplate
        fill
        :selectable="canWrite"
        v-model:search="nameFilter"
        title="Tags"
        :tabs="tabs"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search tags…"
        :filterable="true"
        :has-active-filter="activeFilterCount > 0"
        :filter-count="activeFilterCount"
        @filter-click="filterModalVisible = true"
        :loading="store.loading && filteredTags.length === 0"
        :empty="filteredTags.length === 0 && !store.loading"
        :empty-title="nameFilter ? 'No tags match that search' : 'No tags yet'"
        empty-sub="Tags are reusable labels you can attach to devices, entities, groups, locations, alerts, and more."
        :skeleton-count="6"
        :items="filteredTags"
        :page-size="100"
        pagination-mode="infinite"
        url-key="tags"
        :item-key="tagItemKey"
        grid-class="tag-grid"
    >
        <template #actions>
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                title="New tag"
                aria-label="New tag"
                @click="openCreate"
            >
                <i class="fas fa-plus" />
            </Button>
        </template>

        <FilterChips
            v-if="filterChips.length > 0"
            :chips="filterChips"
            @remove="removeFilterChip"
            @clear="clearFilters"
        />

        <template #empty-cta>
            <Button
                v-if="canWrite && !nameFilter"
                type="green"
                @click="openCreate"
            >
                Create Tag
            </Button>
        </template>

        <template #item="{item, selecting, selected, toggleSelect}">
            <CardValue_Tag
                :tag="item"
                :selected="selected"
                @open-preview="selecting ? toggleSelect() : openEdit(item)"
            />
        </template>

        <template #bulk-actions="{selectedItems, clear}">
            <Button
                type="red"
                size="sm"
                title="Delete"
                aria-label="Delete selected tags"
                @click="askBulkDelete(selectedItems, clear)"
            >
                <i class="fas fa-trash" />
            </Button>
        </template>

        <template #modals>
            <FilterModal
                :visible="filterModalVisible"
                title="Filter Tags"
                match-label="tags"
                :match-count="filteredTags.length"
                :sections="filterSections"
                :initial-state="activeFilterState"
                @close="filterModalVisible = false"
                @apply-generic="applyGenericFilters"
            />
            <EditTagModal
                v-model="createVisible"
                mode="create"
            />
            <EditTagModal
                v-if="editTarget"
                v-model="editVisible"
                mode="edit"
                :initial="editTarget"
            />
            <ConfirmationModal ref="bulkDeleteRef">
                <template #title>
                    <h3>
                        Delete {{ bulkTargets.length }}
                        tag{{ bulkTargets.length === 1 ? '' : 's' }}?
                    </h3>
                </template>
                <template #subText>
                    <p>
                        This removes them from everything they're applied to.
                    </p>
                </template>
            </ConfirmationModal>
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import type {Tag as ApiTag} from '@api/tag';
import {type ComputedRef, computed, inject, onMounted, ref} from 'vue';
import CardValue_Tag from '@/components/cards/CardValue_Tag.vue';
import Button from '@/components/core/Button.vue';
import FilterChips, {type FilterChip} from '@/components/core/FilterChips.vue';
import FilterModal from '@/components/core/FilterModal.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import EditTagModal from '@/components/modals/EditTagModal.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {usePermissions} from '@/composables/usePermissions';
import {useTagsBySubject} from '@/composables/useTagsBySubject';
import {
    DEVICE_TYPE_LABELS,
    type DeviceType,
    deviceTypeOf,
    holdsSelectedClass
} from '@/helpers/deviceTypeFilter';
import type {FilterSection} from '@/helpers/filter-modal-types';
import {
    booleanSection,
    deviceClassSection,
    enumSection
} from '@/helpers/filter-sections';
import {useDevicesStore} from '@/stores/devices';
import {useTagsStore} from '@/stores/tags';
import {useToastStore} from '@/stores/toast';
import type {RouteTab, StatItem} from '@/types/page-template';

const store = useTagsStore();
const toast = useToastStore();
const {canWrite} = usePermissions();

const nameFilter = ref('');
const createVisible = ref(false);
const editVisible = ref(false);
const editTarget = ref<ApiTag | null>(null);

const filterModalVisible = ref(false);
const selectedApplied = ref<string[]>([]);
const selectedClasses = ref<string[]>([]);
const selectedUsage = ref<string[]>([]);

const tagsBySubject = useTagsBySubject();
const devicesStore = useDevicesStore();

// Route tabs provided by /organize/ parent.
const tabs = inject<ComputedRef<RouteTab[]>>(
    'organizeTabs',
    computed(() => [])
);

onMounted(() => {
    store.fetchTags();
    // Full device list — bootstrap is capped, the class filter needs all.
    void devicesStore.fetchDevices();
});

const sortedTags = computed(() =>
    Object.values(store.tags).sort((a, b) => a.name.localeCompare(b.name))
);

// Inverse of the subject→tags index: what each tag is applied to.
const subjectsByTag = computed(() => {
    const map = new Map<number, {type: string; id: string}[]>();
    for (const [key, tagIds] of tagsBySubject.index.value.entries()) {
        const at = key.indexOf(':');
        const subject = {type: key.slice(0, at), id: key.slice(at + 1)};
        for (const id of tagIds) {
            const arr = map.get(id);
            if (arr) arr.push(subject);
            else map.set(id, [subject]);
        }
    }
    return map;
});

function subjectTypesOf(tagId: number): Set<string> {
    return new Set((subjectsByTag.value.get(tagId) ?? []).map((s) => s.type));
}

function deviceSourcesOf(tagId: number): (string | null | undefined)[] {
    return (subjectsByTag.value.get(tagId) ?? [])
        .filter((s) => s.type === 'device')
        .map((s) => devicesStore.devices[s.id]?.source);
}

const APPLIED_LABELS: Record<string, string> = {
    device: 'Devices',
    entity: 'Entities',
    group: 'Groups',
    location: 'Locations',
    alert_rule: 'Alert rules',
    destination_group: 'Destinations',
    channel: 'Integrations',
    script: 'Scripts'
};

const filterSections = computed<FilterSection[]>(() => {
    const appliedCounts = new Map<string, number>();
    const classCounts = new Map<DeviceType, number>();
    let used = 0;
    for (const tag of sortedTags.value) {
        const types = subjectTypesOf(tag.id);
        if (types.size > 0) used++;
        for (const t of types) {
            appliedCounts.set(t, (appliedCounts.get(t) ?? 0) + 1);
        }
        for (const c of new Set(deviceSourcesOf(tag.id).map(deviceTypeOf))) {
            classCounts.set(c, (classCounts.get(c) ?? 0) + 1);
        }
    }
    const sections: FilterSection[] = [];
    if (appliedCounts.size > 0) {
        sections.push(
            enumSection(
                'applied',
                'Applied to',
                'fa-link',
                appliedCounts,
                (k) => APPLIED_LABELS[k] ?? k
            )
        );
    }
    if (classCounts.size > 0) sections.push(deviceClassSection(classCounts));
    sections.push(
        booleanSection(
            'usage',
            'Usage',
            'fa-link-slash',
            'Used',
            'Unused',
            used,
            sortedTags.value.length - used
        )
    );
    return sections;
});

const activeFilterState = computed<Record<string, string[]>>(() => ({
    applied: selectedApplied.value,
    source: selectedClasses.value,
    usage: selectedUsage.value
}));

const activeFilterCount = computed(
    () =>
        selectedApplied.value.length +
        selectedClasses.value.length +
        selectedUsage.value.length
);

function applyGenericFilters(next: Record<string, string[]>) {
    selectedApplied.value = next.applied ?? [];
    selectedClasses.value = next.source ?? [];
    selectedUsage.value = next.usage ?? [];
    filterModalVisible.value = false;
}

const filterChips = computed<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    for (const v of selectedApplied.value) {
        chips.push({
            key: `applied::${v}`,
            section: 'Applied to',
            label: APPLIED_LABELS[v] ?? v
        });
    }
    for (const v of selectedClasses.value) {
        chips.push({
            key: `source::${v}`,
            section: 'Class',
            label: DEVICE_TYPE_LABELS[v as DeviceType]
        });
    }
    for (const v of selectedUsage.value) {
        chips.push({
            key: `usage::${v}`,
            section: 'Usage',
            label: v === 'true' ? 'Used' : 'Unused'
        });
    }
    return chips;
});

function removeFilterChip(key: string) {
    const [section, value] = key.split('::');
    if (section === 'applied') {
        selectedApplied.value = selectedApplied.value.filter((v) => v !== value);
    } else if (section === 'source') {
        selectedClasses.value = selectedClasses.value.filter((v) => v !== value);
    } else if (section === 'usage') {
        selectedUsage.value = selectedUsage.value.filter((v) => v !== value);
    }
}

function clearFilters() {
    selectedApplied.value = [];
    selectedClasses.value = [];
    selectedUsage.value = [];
}

const scopedTags = computed(() => {
    const appliedSet = new Set(selectedApplied.value);
    const classSet = new Set(selectedClasses.value as DeviceType[]);
    const usageMode = selectedUsage.value[0] ?? '';
    return sortedTags.value.filter((tag) => {
        const types = subjectTypesOf(tag.id);
        if (appliedSet.size > 0 && ![...appliedSet].some((t) => types.has(t))) {
            return false;
        }
        if (
            classSet.size > 0 &&
            !holdsSelectedClass(deviceSourcesOf(tag.id), classSet)
        ) {
            return false;
        }
        if (usageMode === 'true' && types.size === 0) return false;
        if (usageMode === 'false' && types.size > 0) return false;
        return true;
    });
});

const filteredTags = useFuzzySearch(scopedTags, nameFilter, {
    keys: ['name', 'key', 'description']
});

function tagItemKey(tag: ApiTag): number {
    return tag.id;
}

const headerStats = computed<StatItem[]>(() => {
    const total = sortedTags.value.length;
    return [{value: total, label: total === 1 ? 'tag' : 'tags', status: 'on'}];
});

function openCreate() {
    createVisible.value = true;
}

function openEdit(tag: ApiTag) {
    editTarget.value = tag;
    editVisible.value = true;
}

// Bulk delete — driven by PageTemplate's selection bar.
const bulkDeleteRef = ref<InstanceType<typeof ConfirmationModal>>();
const bulkTargets = ref<ApiTag[]>([]);
let bulkClear: (() => void) | null = null;

function askBulkDelete(items: ApiTag[], clear: () => void) {
    if (items.length === 0) return;
    bulkTargets.value = items;
    bulkClear = clear;
    bulkDeleteRef.value?.storeAction(performBulkDelete);
}

async function performBulkDelete() {
    const count = bulkTargets.value.length;
    for (const tag of bulkTargets.value) {
        await store.deleteTag(tag.id);
    }
    toast.info(`${count} tag${count === 1 ? '' : 's'} deleted.`);
    bulkClear?.();
    bulkTargets.value = [];
}
</script>

<style scoped>
</style>

<style>
/* Tag wall — content-width pills (Notion / GitHub label pattern). The
   .tag-grid class is emitted only by this page's PageTemplate slot; plain
   block instead of scoped :deep (opaque to the CSS linter). */
.tag-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
}
</style>
