<template>
    <PageTemplate
        v-model:search="nameFilter"
        title="Locations"
        :tabs="tabs"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search locations…"
        :scope="scope"
        :filterable="true"
        :has-active-filter="activeFilterCount > 0"
        :filter-count="activeFilterCount"
        :loading="store.loading && allLocations.length === 0"
        :empty="
            allLocations.length === 0 && !store.loading
        "
        :empty-title="
            nameFilter || activeFilterCount > 0
                ? 'No locations match'
                : 'No locations yet'
        "
        empty-sub="Locations are physical places (sites, buildings, floors, rooms…) you can assign devices to."
        :skeleton-count="6"
        fill
        @filter-click="filterModalVisible = true"
    >
        <template #actions>
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                title="New location"
                aria-label="New location"
                @click="openCreate"
            >
                <i class="fas fa-plus" />
            </Button>
        </template>

        <template #empty-cta>
            <Button
                v-if="canWrite && !nameFilter"
                type="green"
                @click="openCreate"
            >
                Create Location
            </Button>
        </template>

        <FilterChips
            v-if="filterChips.length > 0"
            class="li-filter-chips"
            :chips="filterChips"
            @remove="removeFilterChip"
            @clear="selectedKinds = []"
        />

        <!-- Kill switch — when the feature flag is off, the workspace
             collapses to a single message so ops can disable the redesign
             without a deploy. Flip via FM runtime config or env var. -->
        <div v-if="!locationsRedesignEnabled" class="li-disabled">
            <i class="fas fa-circle-pause" aria-hidden="true" />
            <p class="li-disabled__title">Locations workspace is disabled</p>
            <p class="li-disabled__sub">
                Contact your administrator to enable
                <code>LOCATIONS_REDESIGN_V2</code>.
            </p>
        </div>

        <!-- Tree view — admin surface; map dashboard handles geo overview.
             Renders in the template's content glass alongside the toolbar. -->
        <LocationsLayout v-else @request-delete="onRequestDelete">
            <template #tree="{selectedId, onSelect}">
                <LocationsTree
                    :selected-id="selectedId"
                    @open="onSelect"
                    @created="onSelect"
                    @delete="onRequestDelete"
                />
            </template>
        </LocationsLayout>

        <template #modals>
            <LocationFormModal
                v-model="createVisible"
                mode="create"
                @saved="onLocationCreated($event.id)"
            />
            <ConfirmationModal ref="confirmDeleteRef" />
            <FilterModal
                :visible="filterModalVisible"
                title="Filter Locations"
                match-label="locations"
                :match-count="allLocations.length"
                :sections="filterSections"
                :initial-state="activeFilterState"
                @close="filterModalVisible = false"
                @apply-generic="applyGenericFilters"
            />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import type {Location as ApiLocation} from '@api/location';
import {
    type ComputedRef,
    computed,
    inject,
    onMounted,
    ref
} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import Button from '@/components/core/Button.vue';
import FilterChips, {type FilterChip} from '@/components/core/FilterChips.vue';
import FilterModal from '@/components/core/FilterModal.vue';
import LocationsTree from '@/components/core/LocationsTree.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import LocationsLayout from '@/components/locations/LocationsLayout.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import LocationFormModal from '@/components/modals/LocationFormModal.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {useKeyboardShortcuts} from '@/composables/useKeyboardShortcuts';
import {usePermissions} from '@/composables/usePermissions';
import {useTagsBySubject} from '@/composables/useTagsBySubject';
import {
    DEVICE_TYPE_LABELS,
    type DeviceType,
    deviceTypeOf,
    holdsSelectedClass
} from '@/helpers/deviceTypeFilter';
import {isFeatureEnabled} from '@/helpers/featureFlags';
import {collectDescendants} from '@/helpers/locationTree';
import {
    countByKey,
    deviceClassSection,
    enumSection,
    namedSection
} from '@/helpers/filter-sections';
import {useDevicesStore} from '@/stores/devices';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import {trackInteraction} from '@/tools/observability';
import type {RouteTab, StatItem} from '@/types/page-template';

const store = useLocationsStore();
const {canWrite} = usePermissions();
const router = useRouter();
const route = useRoute();

const locationsRedesignEnabled = isFeatureEnabled('locationsRedesignV2');

const nameFilter = ref('');
const createVisible = ref(false);
const confirmDeleteRef = ref<InstanceType<typeof ConfirmationModal>>();

// Route tabs provided by the /organize/ parent (Locations | Groups | Tags | Policy)
const tabs = inject<ComputedRef<RouteTab[]>>(
    'organizeTabs',
    computed(() => [])
);

onMounted(() => {
    // Fire-and-forget — both store actions surface RPC failures via toast.
    void store.fetchLocations();
    void store.fetchKinds();
    // Full device list — bootstrap is capped, the class filter needs all.
    void devicesStore.fetchDevices();
    trackInteraction('locations', 'view_loaded', 'tree');
});

const allLocations = computed<ApiLocation[]>(() =>
    Object.values(store.locations)
);

const filterModalVisible = ref(false);
const selectedKinds = ref<string[]>([]);
const selectedTags = ref<string[]>([]);
const selectedClasses = ref<string[]>([]);

const tagsBySubject = useTagsBySubject();
const tagsStore = useTagsStore();
const devicesStore = useDevicesStore();

// Direct device sources per location id (device.locationId, no descendants).
const sourcesByLocation = computed(() => {
    const map: Record<number, (string | null | undefined)[]> = {};
    for (const d of Object.values(devicesStore.devices)) {
        if (d.locationId == null) continue;
        (map[d.locationId] ??= []).push(d.source);
    }
    return map;
});

const filterSections = computed(() => {
    const kindCounts = countByKey(
        Object.values(store.locations),
        (l) => l.kind as string
    );
    const tagItems = Object.values(tagsStore.tags).map((t) => ({
        id: t.id,
        name: t.name
    }));
    const tagCounts = countByKey(
        Object.values(store.locations).flatMap((l) =>
            tagsBySubject.tagIdsFor('location', String(l.id))
        ),
        (id) => id
    );
    const classCounts = countByKey(
        Object.values(devicesStore.devices).filter((d) => d.locationId != null),
        (d) => deviceTypeOf(d.source)
    );
    const sections = [
        enumSection(
            'kind',
            'Kind',
            'fa-shapes',
            kindCounts,
            (k) => store.kinds.find((x) => x.kind === k)?.label ?? k
        ),
        namedSection('tag', 'Tags', 'fa-tag', tagItems, tagCounts)
    ];
    if (classCounts.size > 0) sections.push(deviceClassSection(classCounts));
    return sections;
});

const activeFilterState = computed<Record<string, string[]>>(() => ({
    kind: selectedKinds.value,
    tag: selectedTags.value,
    source: selectedClasses.value
}));

const activeFilterCount = computed(
    () =>
        selectedKinds.value.length +
        selectedTags.value.length +
        selectedClasses.value.length
);

const filterChips = computed<FilterChip[]>(() => {
    const chips: FilterChip[] = selectedKinds.value.map((k) => ({
        key: `kind::${k}`,
        section: 'Kind',
        label: store.kinds.find((x) => x.kind === k)?.label ?? k
    }));
    for (const tagIdStr of selectedTags.value) {
        const tag = tagsStore.tags[Number(tagIdStr)];
        if (tag)
            chips.push({
                key: `tag::${tagIdStr}`,
                section: 'Tags',
                label: tag.name
            });
    }
    for (const cls of selectedClasses.value) {
        chips.push({
            key: `source::${cls}`,
            section: 'Class',
            label: DEVICE_TYPE_LABELS[cls as DeviceType]
        });
    }
    return chips;
});

function removeFilterChip(key: string) {
    const [section, value] = key.split('::');
    if (section === 'kind') {
        selectedKinds.value = selectedKinds.value.filter((k) => k !== value);
    } else if (section === 'tag') {
        selectedTags.value = selectedTags.value.filter((t) => t !== value);
    } else if (section === 'source') {
        selectedClasses.value = selectedClasses.value.filter(
            (c) => c !== value
        );
    }
}

function applyGenericFilters(next: Record<string, string[]>) {
    selectedKinds.value = next.kind ?? [];
    selectedTags.value = next.tag ?? [];
    selectedClasses.value = next.source ?? [];
    filterModalVisible.value = false;
}

const sortedLocations = computed(() => {
    const all = Object.values(store.locations);
    const kindSet = new Set(selectedKinds.value);
    const tagSet = new Set(selectedTags.value.map(Number));
    const classSet = new Set(selectedClasses.value as DeviceType[]);
    const scoped = all.filter((l) => {
        if (kindSet.size > 0 && !kindSet.has(l.kind)) return false;
        if (tagSet.size > 0) {
            const tagIds = tagsBySubject.tagIdsFor('location', String(l.id));
            if (!tagIds.some((id) => tagSet.has(id))) return false;
        }
        if (classSet.size > 0) {
            const sources = sourcesByLocation.value[l.id] ?? [];
            if (!holdsSelectedClass(sources, classSet)) return false;
        }
        return true;
    });
    return scoped.sort((a, b) => a.name.localeCompare(b.name));
});

const filteredLocations = useFuzzySearch(sortedLocations, nameFilter, {
    keys: ['name', 'kind']
});

const headerStats = computed<StatItem[]>(() => {
    const all = Object.values(store.locations);
    const rootCount = all.filter((l) => l.parentLocationId == null).length;
    return [
        {value: all.length, label: 'locations', status: 'on'},
        {value: rootCount, label: 'top level'}
    ];
});

const scope = {
    type: 'Location',
    icon: 'fas fa-location-dot',
    items: sortedLocations,
    keys: ['name', 'kind'] as const,
    toHit: (l: ApiLocation) => ({
        id: `location-${l.id}`,
        label: l.name,
        meta: l.kind,
        type: 'Location',
        icon: 'fas fa-location-dot',
        route: `/organize/locations?selected=${l.id}`
    })
};

function openCreate() {
    createVisible.value = true;
}

// Newly-created locations land selected so the user can dive into Edit.
async function selectLocation(id: number): Promise<void> {
    await router.replace({
        path: route.path,
        query: {...route.query, selected: String(id)}
    });
}

function onLocationCreated(id: number): void {
    void selectLocation(id);
}

// Both the tree row's trash button and the settings "Delete location…" button
// funnel here. Opens the confirmation modal; on confirm the location and its
// whole subtree are cascade-deleted. A plain confirm/cancel modal — no
// type-to-confirm input, even for cascades.
function onRequestDelete(id: number): void {
    const loc = store.locations[id];
    if (!loc) return;
    const descendants = collectDescendants(id, store.locations);
    const childCount = descendants.size;
    const message =
        childCount > 0
            ? `"${loc.name}" and its ${childCount} sub-location${
                  childCount === 1 ? '' : 's'
              } will be permanently deleted.`
            : `"${loc.name}" will be permanently deleted.`;
    confirmDeleteRef.value?.storeAction(
        async () => {
            const ok = await store.deleteLocationCascade(id);
            // Clear the selection if the selected node was anywhere in the
            // deleted subtree (the node itself or a cascade-deleted child).
            const selected = route.query.selected;
            const wasDeleted =
                selected != null &&
                (selected === String(id) || descendants.has(Number(selected)));
            if (ok && wasDeleted) {
                const query = {...route.query};
                delete query.selected;
                await router.replace({path: route.path, query});
            }
        },
        {
            title: 'Delete location',
            message,
            confirmLabel: 'Delete'
        }
    );
}

// `/` focuses the page search. UniversalSearch (rendered by PageTemplate)
// owns the input — we reach for it by its stable selector. The editable-
// target guard in useKeyboardShortcuts already skips when typing.
function focusPageSearch(): void {
    const input = document.querySelector<HTMLInputElement>('.us__pill input');
    input?.focus();
    input?.select();
}

useKeyboardShortcuts({
    bindings: [{key: '/', handler: focusPageSearch}]
});
</script>

<style scoped>
.li-filter-chips {
    margin-bottom: var(--space-3);
}


/* Kill-switch surface — shown when LOCATIONS_REDESIGN_V2 is disabled. */
.li-disabled {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-12);
    margin: 0 var(--space-2);
    min-height: 320px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    color: var(--color-text-tertiary);
    text-align: center;
}

.li-disabled > i {
    font-size: var(--icon-size-xl);
    color: var(--color-text-quaternary);
}

.li-disabled__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    margin: 0;
}

.li-disabled__sub {
    font-size: var(--type-caption);
    margin: 0;
    max-width: 48ch;
}

.li-disabled code {
    background: var(--color-surface-2);
    padding: var(--space-px) var(--space-1-5);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.9em;
}
</style>
