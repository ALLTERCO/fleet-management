<template>
    <PageTemplate
        fill
        :selectable="canWrite"
        v-model:search="nameFilter"
        title="Groups"
        :tabs="tabs"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search groups…"
        :scope="scope"
        :filterable="true"
        :has-active-filter="hasActiveFilter"
        :filter-count="totalFilterCount"
        :loading="groupsLoading && filteredItems.length === 0"
        :items="filteredItems"
        :page-size="50"
        pagination-mode="infinite"
        url-key="groups"
        :item-key="groupItemKey"
        :empty="filteredItems.length === 0 && !groupsLoading"
        empty-title="No groups found"
        empty-sub="Groups are a collection of devices."
        @filter-click="filterModalVisible = true"
    >
        <template #skeleton>
            <div class="dc-grid">
                <SkeletonCard v-for="n in 6" :key="n" avatar subtitle name-width="60%" />
            </div>
        </template>
        <template #actions>
            <Button v-if="canWrite" type="green" size="sm" title="New group" aria-label="New group" @click="openCreateGroupModal"><i class="fas fa-plus" /></Button>
        </template>

        <FilterChips
            v-if="filterChips.length > 0"
            class="gi-filter-chips"
            :chips="filterChips"
            @remove="removeFilterChip"
            @clear="clearGroupFilters"
        />

        <template #empty-cta>
            <Button v-if="canWrite" type="green" size="sm" @click="openCreateGroupModal">Create Group</Button>
            <p v-else class="dp-empty-sub">You have read-only access.</p>
        </template>

        <template #item="{item, selecting, selected, toggleSelect}">
            <CardValue_Group
                :group="item"
                size="1x1"
                :selected="selected"
                :resizable="false"
                @open-preview="selecting ? toggleSelect() : openPreview(item.id)"
            />
        </template>

        <template #bulk-actions="{selectedItems, clear}">
            <Button
                type="red"
                size="sm"
                title="Delete"
                aria-label="Delete selected groups"
                @click="askBulkDeleteGroups(selectedItems, clear)"
            >
                <i class="fas fa-trash" />
            </Button>
        </template>

        <template #modals>
            <EditGroupModal v-model="isCreateGroupModalActive" mode="create" @saved="onGroupCreated" />

            <FilterModal
                :visible="filterModalVisible"
                title="Filter Groups"
                match-label="groups"
                :match-count="filteredItems.length"
                :sections="groupFilterSections"
                :initial-state="currentGroupFilterState"
                @close="filterModalVisible = false"
                @apply-generic="applyGroupFilters"
            />

            <ConfirmationModal ref="modalRefDelete">
                <template #title>
                    <h3>Delete {{ bulkTargets.length }} group{{ bulkTargets.length === 1 ? '' : 's' }}?</h3>
                </template>
                <template #subText>
                    <p class="grp-delete-warn"><i class="fas fa-exclamation-triangle" /> Groups that still have subgroups won't be deleted.</p>
                </template>
            </ConfirmationModal>

            <GroupPreviewModal
                v-if="isPreviewActive && previewGroupId !== null"
                v-model="isPreviewActive"
                v-model:current-group-id="previewGroupId"
                :group-id="previewGroupId"
                @edit="onPreviewEdit"
                @deleted="onGroupDeleted"
            />

            <EditGroupModal
                v-if="editingGroupId !== null"
                v-model="isEditGroupModalActive"
                mode="edit"
                :group-id="editingGroupId"
                @saved="onGroupEdited"
            />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import '@/styles/card-system.css';
import '@/styles/device-page.css';
import {storeToRefs} from 'pinia';
import {type ComputedRef, computed, inject, onMounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import CardValue_Group from '@/components/cards/CardValue_Group.vue';
import Button from '@/components/core/Button.vue';
import FilterChips, {type FilterChip} from '@/components/core/FilterChips.vue';
import type {FilterSection} from '@/components/core/FilterModal.vue';
import FilterModal from '@/components/core/FilterModal.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import SkeletonCard from '@/components/core/SkeletonCard.vue';
import  ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import EditGroupModal from '@/components/modals/EditGroupModal.vue';
import GroupPreviewModal from '@/components/modals/GroupPreviewModal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {
    type DeviceType,
    deviceTypeOf,
    holdsSelectedClass
} from '@/helpers/deviceTypeFilter';
import {
    countByKey,
    deviceClassSection,
    enumSection
} from '@/helpers/filter-sections';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import type {RouteTab, StatItem} from '@/types/page-template';

const {canWrite} = usePermissions();

const isCreateGroupModalActive = ref(false);
const isEditGroupModalActive = ref(false);
const editingGroupId = ref<number | null>(null);
const isPreviewActive = ref(false);
const previewGroupId = ref<number | null>(null);

const toast = useToastStore();
const nameFilter = ref('');

// Route tabs provided by /organize/ parent.
const tabs = inject<ComputedRef<RouteTab[]>>(
    'organizeTabs',
    computed(() => [])
);

// ── Filter modal ──
const filterModalVisible = ref(false);
const bulkTargets = ref<{id: number}[]>([]);
let bulkClear: (() => void) | null = null;
const activeFilters = ref<Record<string, string[]>>({});

const groupFilterSections = computed<FilterSection[]>(() => {
    const sections: FilterSection[] = [
        {
            key: 'status',
            label: 'Status',
            icon: 'fa-signal',
            searchable: false,
            options: [
                {key: 'has-offline', label: 'Has offline devices'},
                {key: 'all-online', label: 'All online'},
                {key: 'empty', label: 'Empty groups'},
                {key: 'has-subgroups', label: 'Has subgroups'}
            ]
        }
    ];

    const modelCounts = countByKey(
        allRootGroups.value.flatMap((g) => g.devices ?? []),
        (sid) => {
            const dev = devicesStore.devices[sid];
            return dev?.info?.app ?? dev?.info?.model ?? 'Unknown';
        }
    );
    if (modelCounts.size > 0) {
        sections.push(enumSection('models', 'Device Models', 'fa-microchip', modelCounts));
    }

    const classCounts = countByKey(
        allRootGroups.value.flatMap((g) => g.devices ?? []),
        (sid) => deviceTypeOf(devicesStore.devices[sid]?.source)
    );
    if (classCounts.size > 0) {
        sections.push(deviceClassSection(classCounts));
    }

    const metaCounts = countByKey(
        allRootGroups.value.flatMap((g) =>
            g.metadata && typeof g.metadata === 'object'
                ? Object.keys(g.metadata)
                : []
        ),
        (k) => k
    );
    if (metaCounts.size > 0) {
        sections.push(enumSection('metadata', 'Metadata', 'fa-tags', metaCounts));
    }

    return sections;
});

const currentGroupFilterState = computed(() => activeFilters.value);

function applyGroupFilters(state: Record<string, string[]>) {
    activeFilters.value = state;
}

function clearGroupFilters() {
    activeFilters.value = {};
}

const totalFilterCount = computed(() =>
    Object.values(activeFilters.value).reduce((sum, arr) => sum + arr.length, 0)
);

/** Build a flat chip list from the nested filter state — one chip per
 *  selected option, labelled with its section + value so the user sees
 *  exactly what's filtering the list. */
const filterChips = computed<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    const sectionByKey = new Map(
        groupFilterSections.value.map((s) => [s.key, s])
    );
    for (const [sectionKey, values] of Object.entries(activeFilters.value)) {
        const section = sectionByKey.get(sectionKey);
        if (!section) continue;
        const optByKey = new Map(section.options.map((o) => [o.key, o.label]));
        for (const v of values) {
            out.push({
                key: `${sectionKey}::${v}`,
                section: section.label,
                label: optByKey.get(v) ?? String(v)
            });
        }
    }
    return out;
});

function removeFilterChip(key: string) {
    const [sectionKey, value] = key.split('::');
    if (!sectionKey || value == null) return;
    const next = {...activeFilters.value};
    const arr = (next[sectionKey] ?? []).filter((v) => v !== value);
    if (arr.length === 0) {
        delete next[sectionKey];
    } else {
        next[sectionKey] = arr;
    }
    activeFilters.value = next;
}
const hasActiveFilter = computed(() => totalFilterCount.value > 0);
const activeFilterLabel = computed(
    () =>
        `${totalFilterCount.value} filter${totalFilterCount.value !== 1 ? 's' : ''}`
);

const groupStore = useGroupsStore();
const devicesStore = useDevicesStore();
const {loading: groupsLoading} = storeToRefs(groupStore);

function isRootGroup(group: any) {
    return (
        group?.parentGroupId === null ||
        typeof group?.parentGroupId === 'undefined'
    );
}

const allRootGroups = computed(() =>
    Object.values(groupStore.groups).filter(isRootGroup)
);

function matchesGroupFilter(group: any): boolean {
    const filters = activeFilters.value;
    const statusFilters = filters.status ?? [];
    for (const f of statusFilters) {
        if (f === 'empty' && (group.devices?.length ?? 0) > 0) return false;
        if (
            f === 'has-offline' &&
            !(group.devices ?? []).some((sid: string) => {
                const d = devicesStore.devices[sid];
                return d && !d.online;
            })
        )
            return false;
        if (
            f === 'all-online' &&
            (group.devices ?? []).some((sid: string) => {
                const d = devicesStore.devices[sid];
                return d && !d.online;
            })
        )
            return false;
        if (
            f === 'has-subgroups' &&
            !Object.values(groupStore.groups).some(
                (g: any) => g.parentGroupId === group.id
            )
        )
            return false;
    }
    const modelFilters = filters.models ?? [];
    if (modelFilters.length > 0) {
        const groupModels = new Set(
            (group.devices ?? []).map((sid: string) => {
                const dev = devicesStore.devices[sid];
                return dev?.info?.app ?? dev?.info?.model ?? 'Unknown';
            })
        );
        if (!modelFilters.some((m) => groupModels.has(m))) return false;
    }
    const classFilters = filters.source ?? [];
    if (classFilters.length > 0) {
        const sources = (group.devices ?? []).map(
            (sid: string) => devicesStore.devices[sid]?.source
        );
        if (!holdsSelectedClass(sources, new Set(classFilters as DeviceType[]))) {
            return false;
        }
    }
    const metaFilters = filters.metadata ?? [];
    if (metaFilters.length > 0) {
        const groupKeys = new Set(Object.keys(group.metadata ?? {}));
        if (!metaFilters.some((k) => groupKeys.has(k))) return false;
    }
    return true;
}

// Filter BEFORE pagination so infinite scroll page count is correct
const filteredItems = computed(() =>
    allRootGroups.value.filter((group: any) => {
        const matchesName = (group.name ?? '')
            .toLowerCase()
            .includes(nameFilter.value.toLowerCase());
        return matchesName && matchesGroupFilter(group);
    })
);

function groupItemKey(item: {id: number}): number {
    return item.id;
}

const modalRefDelete = ref<InstanceType<typeof ConfirmationModal>>();

const scope = {
    type: 'Group',
    icon: 'fas fa-folder-tree',
    items: allRootGroups,
    keys: ['name', 'description'] as const,
    toHit: (g: {id: number; name: string; devices?: string[]}) => {
        const n = g.devices?.length ?? 0;
        return {
            id: `group-${g.id}`,
            label: g.name,
            meta: `${n} device${n === 1 ? '' : 's'}`,
            type: 'Group',
            icon: 'fas fa-folder-tree',
            route: `/organize/groups?preview=${g.id}`
        };
    }
};

const headerStats = computed<StatItem[]>(() => {
    const total = allRootGroups.value.length;
    const filtered = filteredItems.value.length;
    const stats: StatItem[] = [
        {value: total, label: 'groups', status: 'on'}
    ];
    if (filtered !== total) {
        stats.push({value: filtered, label: 'matching', highlight: true});
    }
    return stats;
});

function openCreateGroupModal() {
    isCreateGroupModalActive.value = true;
}

function onGroupCreated() {
    refreshGroups();
}

function openPreview(id: number) {
    previewGroupId.value = id;
    isPreviewActive.value = true;
}

function onPreviewEdit(id: number) {
    previewGroupId.value = null;
    openEditGroupModal(id);
}

function openEditGroupModal(id: number) {
    editingGroupId.value = id;
    isEditGroupModalActive.value = true;
}

function onGroupEdited() {
    editingGroupId.value = null;
    refreshGroups();
}

async function performBulkDeleteGroups() {
    const count = bulkTargets.value.length;
    for (const group of bulkTargets.value) {
        await groupStore.deleteGroup(group.id);
    }
    toast.info(`${count} group${count === 1 ? '' : 's'} deleted.`);
    bulkClear?.();
    bulkTargets.value = [];
    await refreshGroups();
}

function refreshGroups() {
    return groupStore.fetchGroups();
}

function askBulkDeleteGroups(items: {id: number}[], clear: () => void) {
    if (items.length === 0) return;
    bulkTargets.value = items;
    bulkClear = clear;
    modalRefDelete.value?.storeAction(performBulkDeleteGroups);
}

function onGroupDeleted() {
    isPreviewActive.value = false;
    previewGroupId.value = null;
    refreshGroups();
}

onMounted(() => {
    // Groups are seeded by websocket onConnect — only refetch when empty.
    if (Object.keys(groupStore.groups).length === 0) {
        void groupStore.fetchGroups();
    }
    // Full device list — bootstrap is capped, the class filter needs all.
    void devicesStore.fetchDevices();
});

// Deep-link `?preview=N` opens GroupPreviewModal for that group. Replaces
// the legacy `/organize/groups/[id]` page route.
const route = useRoute();
const router = useRouter();
watch(
    () => route.query.preview,
    (raw) => {
        if (raw == null) return;
        const value = Array.isArray(raw) ? raw[0] : raw;
        const id = Number(value);
        if (Number.isFinite(id) && id > 0) openPreview(id);
    },
    {immediate: true}
);
watch(isPreviewActive, (open) => {
    if (open || route.query.preview == null) return;
    const {preview: _, ...rest} = route.query;
    router.replace({query: rest});
});
</script>

<style scoped>
.dp-header__center .search-pill { max-width: var(--search-w-max); width: 100%; position: relative; }
.dp-header__center { display: flex; flex-direction: column; align-items: center; gap: var(--gap-xs); }
.gi-skeleton-pad { padding: var(--gap-md); }
.gi-filter-chips { margin-bottom: var(--space-3); }
.gi-clear {
    background: none; border: none; padding: 0 var(--space-1);
    font-family: inherit; font-size: inherit; color: var(--color-primary);
    cursor: pointer;
}
.gi-empty-title { font-size: var(--type-body); font-weight: var(--font-bold); color: var(--color-text-primary); padding-bottom: var(--gap-xs); }
.gi-empty-sub { font-size: var(--type-body); color: var(--color-text-secondary); padding-bottom: var(--gap-xs); }
.gi-empty-warn { font-size: var(--type-body); color: var(--color-warning-text); }
.grp-delete-warn {
    font-size: var(--type-body); color: var(--color-warning-text); font-weight: var(--font-semibold);
    display: flex; align-items: center; gap: var(--gap-xs);
}
</style>
