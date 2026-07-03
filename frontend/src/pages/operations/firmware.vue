<template>
    <div class="flex min-h-0 flex-1 flex-col">
    <div class="h-full flex flex-col gap-2">
        <h2 class="sr-only">Firmware Management</h2>
        <ErrorBoundary>
        <!-- Firmware Devices -->
        <PageTemplate
            fill
            v-if="!actionPanelOpen"
            title="Firmware Updates"
            :tabs="operationsTabs"
            :count="`${executableDevices.length} devices`"
            searchable
            v-model:search="deviceSearch"
            filterable
            :has-active-filter="hasActiveFilters"
            :filter-count="activeFilterCount"
            search-placeholder="Search firmware…"
            @filter-click="filterModalVisible = true"
        >
            <template #actions>
                <Button
                    v-if="allDevicesWithStableUpdates.length > 0"
                    type="blue" size="sm"
                    :disabled="updatingDevices.length > 0"
                    @click="quickUpdateAll"
                >
                    Update All ({{ allDevicesWithStableUpdates.length }})
                </Button>
                <Button
                    type="blue-hollow" size="sm"
                    :disabled="isCheckingFirmware"
                    title="Refresh"
                    aria-label="Refresh"
                    @click="checkAllFirmware"
                ><i class="fas fa-sync-alt" :class="{'fa-spin': isCheckingFirmware}" /></Button>
                <Button
                    type="blue-hollow" size="sm"
                    title="Upload firmware"
                    aria-label="Upload firmware"
                    @click="uploadModalVisible = true"
                ><i class="fas fa-upload" /></Button>
            </template>
            <template #toggles>
                <div class="route-tabs">
                    <div class="route-tabs__track" :class="{'route-tabs__track--end': viewMode === 'library'}" />
                    <button
                        type="button"
                        class="route-tabs__btn"
                        :class="{'route-tabs__btn--active': viewMode === 'devices'}"
                        @click="viewMode = 'devices'"
                    >Devices</button>
                    <button
                        type="button"
                        class="route-tabs__btn"
                        :class="{'route-tabs__btn--active': viewMode === 'library'}"
                        @click="viewMode = 'library'"
                    >Library</button>
                </div>
            </template>

            <FilterChips
                v-if="filterChips.length > 0"
                class="fw-filter-chips"
                :chips="filterChips"
                @remove="removeFilterChip"
                @clear="clearAllFilters"
            />

            <!-- Device card grid — auto-wrapped by PageTemplate's GlassShell -->
            <template v-if="viewMode === 'devices'">
                <div v-if="isCheckingFirmware && executableDevices.length > 0 && firmwareInfoList.length === 0" class="dc-grid">
                    <Skeleton v-for="n in 8" :key="n" variant="card" />
                </div>
                <EmptyBlock v-else-if="filteredDevices.length === 0">
                    <p class="text-base font-semibold pb-2">
                        {{ executableDevices.length === 0 ? 'No firmware-capable devices online' : 'No devices match your search' }}
                    </p>
                    <p v-if="executableDevices.length === 0" class="text-sm text-[var(--color-text-tertiary)]">
                        Connect Shelly devices with firmware update capability.
                    </p>
                </EmptyBlock>
                <div v-else class="dc-grid">
                    <div v-for="device in filteredDevices" :key="device.shellyID" class="fw-card">
                        <DeviceFleetCard
                            :device="device"
                            :selected="isSelected(device.shellyID)"
                            @select="toggleDevice(device.shellyID)"
                        />
                        <div
                            v-if="getFirmwareDot(device.shellyID)"
                            class="fw-card__strip"
                            :class="getFirmwareDot(device.shellyID)"
                            :title="getFirmwareStatus(device.shellyID)?.label"
                        />
                    </div>
                </div>
            </template>

            <!-- Firmware library — auto-wrapped by PageTemplate's GlassShell -->
            <template v-else-if="viewMode === 'library'">
                <EmptyBlock v-if="isLoadingLibrary">
                    <Spinner size="sm" /> Loading library...
                </EmptyBlock>
                <EmptyBlock v-else-if="filteredLibrary.length === 0">
                    <p class="text-base font-semibold pb-2">
                        {{ firmwareLibrary.length === 0 ? 'No firmware files uploaded' : 'No files match your search' }}
                    </p>
                    <p class="text-sm text-[var(--color-text-secondary)]">Upload firmware files to manage and deploy them.</p>
                </EmptyBlock>
                <DataList
                    v-else
                    :rows="filteredLibrary"
                    :columns="libraryColumns"
                    row-key="id"
                    clickable
                    @row-click="openLibraryDetail"
                >
                    <template #cell-fileSize="{row}">
                        <span class="dp-table__mono">{{ formatBytes(row.fileSize) }}</span>
                    </template>
                    <template #cell-uploadedAt="{row}">{{ formatDate(row.uploadedAt) }}</template>
                </DataList>
            </template>

        </PageTemplate>

        <!-- Step 1b: Action view (after clicking Next) — same page, replaces card grid -->
        <div v-else-if="actionPanelOpen" class="flex-1 flex flex-col fw-page">
            <header class="dp-header">
                <div class="dp-header__left">
                    <h1 class="dp-header__title">Firmware Actions</h1>
                </div>
                <div class="dp-header__right">
                    <Button
                        type="blue-hollow" size="sm"
                        :disabled="isCheckingFirmware"
                        title="Refresh"
                        aria-label="Refresh"
                        @click="checkAllFirmware"
                    ><i class="fas fa-sync-alt" :class="{'fa-spin': isCheckingFirmware}" /></Button>
                    <Button type="blue-hollow" size="sm" @click="actionPanelOpen = false">
                        Back
                    </Button>
                </div>
            </header>

            <!-- Golden ratio split: 61.8% table / 38.2% actions -->
            <div class="fwa__split">
                <BasicBlock bordered blurred padding="sm" class="fwa__content">
                    <DataList
                        :rows="selectedFirmwareInfo"
                        :columns="actionColumns"
                        row-key="shellyID"
                    >
                        <template #cell-model="{row}">
                            <span class="dp-table__mono">{{ devicesStore.devices[row.shellyID]?.info?.model || '—' }}</span>
                        </template>
                        <template #cell-stable="{row}">
                            <span v-if="row.availableStable" class="fwa__ver fwa__ver--stable">{{ row.availableStable.version }}</span>
                            <span v-else class="fwa__ver--none">—</span>
                        </template>
                        <template #cell-beta="{row}">
                            <span v-if="row.availableBeta" class="fwa__ver fwa__ver--beta">{{ row.availableBeta.version }}</span>
                            <span v-else class="fwa__ver--none">—</span>
                        </template>
                        <template #cell-auto="{row}">
                            <span class="fwa__auto" :class="`fwa__auto--${autoUpdateModes[row.shellyID] || 'off'}`">{{ autoUpdateModes[row.shellyID] || 'Off' }}</span>
                        </template>
                        <template #cell-status="{row}">
                            <span v-if="row.checkStatus === 'checking'" class="fwa__status fwa__status--checking"><i class="fas fa-sync-alt fa-spin" /></span>
                            <span v-else-if="row.availableStable || row.availableBeta" class="fwa__status fwa__status--update"><i class="fas fa-arrow-up" /></span>
                            <span v-else-if="row.checkStatus === 'checked'" class="fwa__status fwa__status--current"><i class="fas fa-check" /></span>
                            <span v-else-if="row.checkStatus === 'error'" class="fwa__status fwa__status--error"><i class="fas fa-exclamation-triangle" /></span>
                        </template>
                    </DataList>
                </BasicBlock>

                <BasicBlock bordered blurred padding="sm" class="fwa__sidebar-wrap">
                    <FirmwareActionSidebar
                        :selected-count="selectedCount"
                        :stable-eligible-count="devicesWithStableUpdates.length"
                        :beta-eligible-count="devicesWithBetaUpdates.length"
                        :updating-count="updatingDevices.length"
                        :loading-library="isLoadingLibrary"
                        :library="firmwareLibrary"
                        :can-use-item="canUseLibraryItem"
                        :auto-update-summary="autoUpdateSummary"
                        @update-stable="updateAllToStable()"
                        @update-beta="updateAllToBeta()"
                        @open-upload="uploadModalVisible = true"
                        @open-url="urlModalVisible = true"
                        @enable-stable-auto="enableStableAutoUpdateForAll()"
                        @enable-beta-auto="enableBetaAutoUpdateForAll()"
                        @disable-auto="disableAutoUpdateForAll()"
                        @use-library-item="useLibraryItem"
                        @delete-library-item="deleteLibraryItem"
                    />
                </BasicBlock>
            </div>
        </div>

        <!-- Inline progress strip — appears at bottom when updates are running -->
        <FirmwareProgressStrip
            v-model:expanded="progressExpanded"
            :committed-count="committedDeviceIds.length"
            :updating-count="updatingDevices.length"
            :success-count="successDevices.length"
            :failed-count="failedDevices.length"
            :overall-progress-pct="overallProgressPct"
            :rows="committedFirmwareInfo"
            :columns="committedColumns"
            @finish="finishAndReset"
            @retry="retryDevice"
            @retry-all-failed="retryAllFailed"
        />
        </ErrorBoundary>
    </div>
    <SelectionBar
        v-if="!actionPanelOpen && selectedCount > 0"
        :count="selectedCount"
        :all-selected="allSelected"
        @select-all="selectAll"
        @clear="clearSelection"
        @done="clearSelection"
    >
        <Button type="blue" size="sm" @click="actionPanelOpen = true">
            Next
        </Button>
    </SelectionBar>
    <ConfirmationModal ref="confirmModalRef">
        <template #title><h3>{{ confirmTitle }}</h3></template>
    </ConfirmationModal>

    <FirmwareUploadModal
        :visible="uploadModalVisible"
        :has-selected-devices="selectedCount > 0"
        @close="uploadModalVisible = false"
        @upload="handleFirmwareUpload"
    />
    <FirmwareUrlModal
        :visible="urlModalVisible"
        :disabled="updatingDevices.length > 0 || selectedCount === 0"
        @close="urlModalVisible = false"
        @submit="handleUrlSubmit"
    />
    <FirmwareEditModal
        :visible="editModalVisible"
        :item="editingLibraryItem"
        @close="editModalVisible = false"
        @save="saveLibraryItemEdits"
    />
    <FirmwareDetailModal
        :visible="libraryDetailVisible"
        :item="libraryDetailItem"
        :can-flash="libraryDetailCanFlash"
        @close="libraryDetailVisible = false"
        @flash="flashFromDetail"
        @edit="editFromDetail"
        @delete="deleteFromDetail"
    />
    <FilterModal
        :visible="filterModalVisible"
        :sections="filterSections"
        :initial-state="currentFilterState"
        :match-count="filteredDevices.length"
        @close="filterModalVisible = false"
        @apply-generic="applyFilterState"
    />
    </div>
</template>

<script setup lang="ts">
import {isResourceNotFound} from '@api/errors';
import {
    FIRMWARE_LIBRARY_ITEM_RESOURCE_TYPE,
    type FirmwareLibraryItem,
    type FirmwareListLibraryResponse,
    type FirmwareUpdateLibraryEntryParams
} from '@api/firmware';
import {storeToRefs} from 'pinia';
import {computed, inject, onMounted, onUnmounted, ref, watch} from 'vue';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import FilterChips, {type FilterChip} from '@/components/core/FilterChips.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import SelectionBar from '@/components/core/SelectionBar.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import Spinner from '@/components/core/Spinner.vue';
import FirmwareDetailModal from '@/components/firmware/FirmwareDetailModal.vue';
import FirmwareEditModal from '@/components/firmware/FirmwareEditModal.vue';
import FirmwareUploadModal from '@/components/firmware/FirmwareUploadModal.vue';
import FirmwareUrlModal from '@/components/firmware/FirmwareUrlModal.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import FirmwareActionSidebar from '@/components/pages/firmware/FirmwareActionSidebar.vue';
import FirmwareProgressStrip from '@/components/pages/firmware/FirmwareProgressStrip.vue';
import {useSubjectAssociations} from '@/composables/useSubjectAssociations';
import {FLEET_MANAGER_HTTP} from '@/constants';
import apiClient from '@/helpers/axios';
import {
    countByKey,
    type KindedLocation,
    locationIdsFromState,
    locationSectionsByKind,
    locationStateByKind,
    namedSection
} from '@/helpers/filter-sections';
import {
    FIRMWARE_STATUS_MAP,
    type FirmwareCategory,
    firmwareDotFor,
    firmwareStatusLabel
} from '@/helpers/firmwareStatus';
import {formatBytes, formatDate} from '@/helpers/format';
import {shellyIdsFromGroups} from '@/helpers/groupDevices';
import {useDevicesStore} from '@/stores/devices';
import {type FirmwareDeviceInfo, useFirmwareStore} from '@/stores/firmware';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import {useToastStore} from '@/stores/toast';
import {createUploadTicket} from '@/tools/uploadTickets';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

const operationsTabs = inject<RouteTab[]>('operationsTabs', [] as RouteTab[]);

interface ConfirmationModalHandle {
    storeAction(action: () => void | Promise<void>): void;
}

const firmwareStore = useFirmwareStore();
const devicesStore = useDevicesStore();
const groupsStore = useGroupsStore();
const tagsStore = useTagsStore();
const locationsStore = useLocationsStore();
const toastStore = useToastStore();

// Device → tagIds[] / locationIds[] reverse index, derived from the device FKs.
const {tagsByDevice, locationsByDevice} = useSubjectAssociations();

const confirmModalRef = ref<ConfirmationModalHandle>();
const confirmTitle = ref('Are you sure?');

const {
    selectedDevices,
    selectedCount,
    executableDevices,
    firmwareInfoList,
    isCheckingFirmware,
    failedDevices,
    successDevices,
    updatingDevices,
    autoUpdateModes,
    committedDeviceIds
} = storeToRefs(firmwareStore);

const libraryColumns: DataColumn<FirmwareLibraryItem>[] = [
    {key: 'name', label: 'Name', role: 'primary'},
    {key: 'originalFileName', label: 'File', role: 'secondary', mono: true},
    {key: 'app', label: 'App', role: 'meta', mono: true, accessor: (i) => i.app || '—'},
    {key: 'model', label: 'Model', role: 'meta', mono: true, accessor: (i) => i.model || '—'},
    {key: 'ver', label: 'Version', role: 'meta', mono: true, accessor: (i) => i.ver || '—'},
    {key: 'fwId', label: 'Build ID', role: 'meta', mono: true, accessor: (i) => i.fwId || '—'},
    {key: 'channel', label: 'Channel', role: 'meta', accessor: (i) => i.channel || '—'},
    {key: 'fileSize', label: 'Size', role: 'meta', mono: true},
    {key: 'uploadedAt', label: 'Uploaded', role: 'meta'},
    {key: 'uploadedBy', label: 'By', role: 'meta'}
];

const actionColumns: DataColumn<FirmwareDeviceInfo>[] = [
    {key: 'deviceName', label: 'Device', role: 'primary'},
    {key: 'model', label: 'Model', role: 'secondary'},
    {key: 'currentVersion', label: 'Current', role: 'meta', mono: true, accessor: (i) => i.currentVersion || '—'},
    {key: 'stable', label: 'Stable', role: 'meta'},
    {key: 'beta', label: 'Beta', role: 'meta'},
    {key: 'auto', label: 'Auto', role: 'meta'},
    {key: 'status', label: '', role: 'status'}
];

const committedColumns: DataColumn<FirmwareDeviceInfo>[] = [
    {key: 'deviceName', label: 'Device', role: 'primary'},
    {key: 'progress', label: 'Progress', role: 'meta'},
    {key: 'status', label: 'Status', role: 'status'},
    {key: 'actions', label: '', role: 'action', align: 'right'}
];

const progressExpanded = ref(false);

// Modal visibility
const uploadModalVisible = ref(false);
const urlModalVisible = ref(false);
const editModalVisible = ref(false);
const editingLibraryItem = ref<FirmwareLibraryItem | null>(null);
const actionPanelOpen = ref(false);

// View + filter state
const viewMode = ref<'devices' | 'library'>('devices');
const deviceSearch = ref('');
const filterModalVisible = ref(false);
const filterGroupIds = ref<number[]>([]);
const filterModels = ref<string[]>([]);
const filterStatuses = ref<string[]>([]);
const filterTagIds = ref<number[]>([]);
const filterLocationIds = ref<number[]>([]);

const hasActiveFilters = computed(() => activeFilterCount.value > 0);
const activeFilterCount = computed(
    () =>
        filterGroupIds.value.length +
        filterModels.value.length +
        filterStatuses.value.length +
        filterTagIds.value.length +
        filterLocationIds.value.length
);

// Locations mapped to the shared per-kind shape so location sections + state
// helpers can be reused verbatim.
const kindedLocations = computed<KindedLocation[]>(() =>
    Object.values(locationsStore.locations).map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind
    }))
);

const currentFilterState = computed<FilterState>(() => ({
    group: filterGroupIds.value.map(String),
    models: filterModels.value,
    statuses: filterStatuses.value,
    tag: filterTagIds.value.map(String),
    ...locationStateByKind(filterLocationIds.value, kindedLocations.value)
}));

// One source of truth for the modal's sections — group, model, firmware
// status, tag, and per-kind location, all reusing the shared factories.
const filterSections = computed<FilterSection[]>(() => {
    const groupItems = Object.values(groupsStore.groups)
        .filter((g) => g.devices.length > 0)
        .map((g) => ({id: g.id, name: g.name}));
    const groupCounts = countByKey(
        executableDevices.value.flatMap((d) => d.groupIds ?? []),
        (id) => id
    );

    const modelCounts = countByKey(
        executableDevices.value,
        (d) => d.info?.model || 'Unknown'
    );

    const tagItems = Object.values(tagsStore.tags).map((t) => ({
        id: t.id,
        name: t.name
    }));
    const tagCounts = countByKey(
        Object.values(tagsByDevice.value).flat(),
        (id) => id
    );

    const locationCounts = countByKey(
        Object.values(locationsByDevice.value).flat(),
        (id) => id
    );

    return [
        namedSection(
            'group',
            'Groups',
            'fa-folder-tree',
            groupItems,
            groupCounts
        ),
        {
            key: 'models',
            label: 'Models',
            icon: 'fa-microchip',
            searchable: modelCounts.size > 6,
            options: Array.from(modelCounts.entries())
                .map(([model, count]) => ({key: model, label: model, count}))
                .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        },
        {
            key: 'statuses',
            label: 'Status',
            icon: 'fa-signal',
            options: [
                {key: 'update-available', label: 'Update available'},
                {key: 'up-to-date', label: 'Up to date'},
                {key: 'error', label: 'Check failed'}
            ]
        },
        namedSection('tag', 'Tags', 'fa-tag', tagItems, tagCounts),
        ...locationSectionsByKind(kindedLocations.value, locationCounts)
    ];
});

function applyFilterState(state: FilterState) {
    filterGroupIds.value = (state.group ?? []).map(Number);
    filterModels.value = state.models ?? [];
    filterStatuses.value = state.statuses ?? [];
    filterTagIds.value = (state.tag ?? []).map(Number);
    filterLocationIds.value = Array.from(locationIdsFromState(state));
}

/** Build chip list from every filter axis so the user can see and remove any
 *  active filter without opening the modal. */
const filterChips = computed<FilterChip[]>(() => {
    const out: FilterChip[] = [];
    const groupNameById = new Map(
        Object.values(groupsStore.groups).map((g) => [g.id, g.name])
    );
    for (const id of filterGroupIds.value) {
        out.push({
            key: `group::${id}`,
            section: 'Group',
            label: groupNameById.get(id) ?? `Group ${id}`
        });
    }
    for (const m of filterModels.value) {
        out.push({key: `model::${m}`, section: 'Model', label: m});
    }
    for (const s of filterStatuses.value) {
        const entry = FIRMWARE_STATUS_MAP[s as FirmwareCategory];
        const label = entry?.label ?? s.charAt(0).toUpperCase() + s.slice(1);
        out.push({key: `status::${s}`, section: 'Status', label});
    }
    for (const id of filterTagIds.value) {
        out.push({
            key: `tag::${id}`,
            section: 'Tag',
            label: tagsStore.tags[id]?.name ?? `Tag ${id}`
        });
    }
    for (const id of filterLocationIds.value) {
        out.push({
            key: `location::${id}`,
            section: 'Location',
            label: locationsStore.locations[id]?.name ?? `Location ${id}`
        });
    }
    return out;
});

function removeFilterChip(key: string) {
    const [axis, raw] = key.split('::');
    if (axis === 'group') {
        const id = Number(raw);
        filterGroupIds.value = filterGroupIds.value.filter((g) => g !== id);
    } else if (axis === 'model') {
        filterModels.value = filterModels.value.filter((m) => m !== raw);
    } else if (axis === 'status') {
        filterStatuses.value = filterStatuses.value.filter((s) => s !== raw);
    } else if (axis === 'tag') {
        const id = Number(raw);
        filterTagIds.value = filterTagIds.value.filter((t) => t !== id);
    } else if (axis === 'location') {
        const id = Number(raw);
        filterLocationIds.value = filterLocationIds.value.filter(
            (l) => l !== id
        );
    }
}

function clearAllFilters() {
    filterGroupIds.value = [];
    filterModels.value = [];
    filterStatuses.value = [];
    filterTagIds.value = [];
    filterLocationIds.value = [];
}

// Firmware dot + label come from a shared helper; the modal stays the
// orchestrator, the resolution rules + class names have one home.
function getFirmwareDot(shellyID: string): string | null {
    return firmwareDotFor(firmwareStore.firmwareInfo[shellyID]);
}

function getFirmwareStatus(shellyID: string): {label: string} | null {
    return firmwareStatusLabel(firmwareStore.firmwareInfo[shellyID]);
}

function checkAllFirmware() {
    void firmwareStore.checkFirmwareForAll(true);
}

const filteredLibrary = computed(() => {
    const q = deviceSearch.value.trim().toLowerCase();
    if (!q) return firmwareLibrary.value;
    return firmwareLibrary.value.filter((item) =>
        [
            item.name,
            item.originalFileName,
            item.model,
            item.app,
            item.ver,
            ...item.tags
        ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
    );
});

function initializeFirmwarePage() {
    firmwareStore.activateExecutableDevices();
    firmwareStore.initializeAllFirmwareInfo();
    void firmwareStore.fetchAutoUpdateModes();
    void firmwareStore.checkFirmwareForAll();
    void fetchFirmwareLibrary();
}

onMounted(initializeFirmwarePage);

onUnmounted(() => {
    firmwareStore.deactivateExecutableDevices();
});

// Auto-expand progress strip when update starts, toast on completion
watch(committedDeviceIds, (ids) => {
    if (ids.length > 0) progressExpanded.value = true;
});
watch(updatingDevices, (updating) => {
    if (updating.length === 0 && committedDeviceIds.value.length > 0) {
        const s = successDevices.value.length;
        const f = failedDevices.value.length;
        if (f > 0)
            toastStore.error(`Update complete: ${s} success, ${f} failed`);
        else if (s > 0)
            toastStore.success(
                `${s} device${s > 1 ? 's' : ''} updated successfully`
            );
    }
});

// Re-initialize firmware info when new devices connect
watch(executableDevices, () => {
    firmwareStore.initializeAllFirmwareInfo();
    void firmwareStore.checkFirmwareForAll();
});

const customFirmwareUrl = ref('');
const isLoadingLibrary = ref(false);

const firmwareLibrary = ref<FirmwareLibraryItem[]>([]);

// Filter devices by search + groups + models + firmware status + tag + location
const filteredDevices = computed(() => {
    let list = executableDevices.value;

    // Group filter
    if (filterGroupIds.value.length > 0) {
        const deviceIds = shellyIdsFromGroups(
            filterGroupIds.value,
            groupsStore.groups
        );
        list = list.filter((d) => deviceIds.has(d.shellyID as string));
    }

    // Model filter
    if (filterModels.value.length > 0) {
        const models = new Set(filterModels.value);
        list = list.filter((d) => models.has(d.info?.model || 'Unknown'));
    }

    // Tag filter — device matches if it carries any selected tag.
    if (filterTagIds.value.length > 0) {
        const tags = new Set(filterTagIds.value);
        const tagIx = tagsByDevice.value;
        list = list.filter((d) =>
            (tagIx[d.shellyID as string] ?? []).some((id) => tags.has(id))
        );
    }

    // Location filter — device matches if its location is selected.
    if (filterLocationIds.value.length > 0) {
        const locations = new Set(filterLocationIds.value);
        const locIx = locationsByDevice.value;
        list = list.filter((d) =>
            (locIx[d.shellyID as string] ?? []).some((id) => locations.has(id))
        );
    }

    // Firmware status filter
    if (filterStatuses.value.length > 0) {
        const statuses = new Set(filterStatuses.value);
        list = list.filter((d) => {
            const info = firmwareStore.firmwareInfo[d.shellyID as string];
            if (!info) return statuses.has('checking');
            if (info.availableStable || info.availableBeta)
                return statuses.has('update-available');
            if (info.checkStatus === 'checked')
                return statuses.has('up-to-date');
            if (info.checkStatus === 'checking')
                return statuses.has('checking');
            if (info.checkStatus === 'error') return statuses.has('error');
            return false;
        });
    }

    // Text search
    const q = deviceSearch.value.trim().toLowerCase();
    if (!q) return list;
    return list.filter((d) => {
        const name = (d.info?.name || d.shellyID || '').toLowerCase();
        const model = (d.info?.model || '').toLowerCase();
        return (
            name.includes(q) ||
            model.includes(q) ||
            (d.shellyID as string).toLowerCase().includes(q)
        );
    });
});

// Committed devices' firmware info (for inline progress strip)
const committedFirmwareInfo = computed(() => {
    return committedDeviceIds.value
        .map((id) => firmwareStore.firmwareInfo[id])
        .filter(Boolean);
});

// Overall progress percentage across all committed devices
const overallProgressPct = computed(() => {
    const total = committedDeviceIds.value.length;
    if (total === 0) return 0;
    const done = successDevices.value.length + failedDevices.value.length;
    const downloading = updatingDevices.value.reduce(
        (sum, d) => sum + (d.progressPercent || 0),
        0
    );
    const totalProgress = done * 100 + downloading;
    const maxProgress = total * 100;
    return Math.round((totalProgress / maxProgress) * 100);
});

// Selected devices' firmware info (for action modal sidebar)
const selectedFirmwareInfo = computed(() => {
    return Array.from(selectedDevices.value)
        .map((id) => firmwareStore.firmwareInfo[id])
        .filter(Boolean);
});

// Current auto-update mode across selected devices; 'mixed' when they differ.
const autoUpdateSummary = computed<'stable' | 'beta' | 'off' | 'mixed'>(() => {
    const rows = selectedFirmwareInfo.value;
    if (rows.length === 0) return 'off';
    const modes = new Set(
        rows.map((row) => autoUpdateModes.value[row.shellyID] || 'off')
    );
    if (modes.size > 1) return 'mixed';
    return [...modes][0] as 'stable' | 'beta' | 'off';
});

// Computed for SELECTED devices with available updates (used in action modal)
const devicesWithStableUpdates = computed(() => {
    return selectedFirmwareInfo.value.filter(
        (info: FirmwareDeviceInfo) => info.availableStable
    );
});

const devicesWithBetaUpdates = computed(() => {
    return selectedFirmwareInfo.value.filter(
        (info: FirmwareDeviceInfo) => info.availableBeta
    );
});

// All devices with stable updates (for quick update on main page)
const allDevicesWithStableUpdates = computed(() => {
    return firmwareInfoList.value.filter(
        (info: FirmwareDeviceInfo) => info.availableStable
    );
});

function quickUpdateAll() {
    const count = allDevicesWithStableUpdates.value.length;
    if (count === 0) return;
    // Select all devices that have stable updates
    for (const info of allDevicesWithStableUpdates.value) {
        firmwareStore.selectDevice(info.shellyID);
    }
    confirmTitle.value = `Update ${count} device(s) to latest stable firmware?`;
    confirmModalRef.value?.storeAction(async () => {
        try {
            await firmwareStore.updateSelected('stable');
        } catch (error: any) {
            toastStore.error(
                error?.message || 'Failed to start firmware update'
            );
        }
    });
}

// Helper to check if device is selected
function isSelected(shellyID: string) {
    return selectedDevices.value.has(shellyID);
}

// Step 1 actions
function toggleDevice(shellyID: string) {
    firmwareStore.toggleDevice(shellyID);
}

function selectAll() {
    firmwareStore.selectAll();
}

function clearSelection() {
    firmwareStore.clearSelection();
}

// Drives the SelectionBar's "Select all / Deselect all" toggle.
const allSelected = computed(
    () =>
        executableDevices.value.length > 0 &&
        selectedCount.value >= executableDevices.value.length
);

// Confirmed action helper — named object instead of 4 positional args
function confirmAndExecute(opts: {
    title: string;
    action: () => Promise<void>;
    success: string;
    error: string;
}) {
    confirmTitle.value = opts.title;
    confirmModalRef.value?.storeAction(async () => {
        try {
            await opts.action();
            toastStore.success(opts.success);
        } catch {
            toastStore.error(opts.error);
        }
    });
}

function enableStableAutoUpdateForAll() {
    confirmAndExecute({
        title: 'Enable stable auto-update for all selected devices?',
        action: () => firmwareStore.enableAutoUpdateStableForSelected(),
        success: 'Stable auto-update enabled',
        error: 'Failed to enable stable auto-update'
    });
}
function enableBetaAutoUpdateForAll() {
    confirmAndExecute({
        title: 'Enable beta auto-update for all selected devices?',
        action: () => firmwareStore.enableAutoUpdateBetaForSelected(),
        success: 'Beta auto-update enabled',
        error: 'Failed to enable beta auto-update'
    });
}
function disableAutoUpdateForAll() {
    confirmAndExecute({
        title: 'Disable auto-update for all selected devices?',
        action: () => firmwareStore.disableAutoUpdateForSelected(),
        success: 'Auto-update disabled',
        error: 'Failed to disable auto-update'
    });
}

// Unified channel update — eliminates updateAllToStable/Beta duplication
function updateByChannel(channel: 'stable' | 'beta') {
    const devices =
        channel === 'stable'
            ? devicesWithStableUpdates.value
            : devicesWithBetaUpdates.value;
    if (devices.length === 0) {
        toastStore.error(`No devices have ${channel} updates available`);
        return;
    }
    confirmTitle.value = `Update ${devices.length} device(s) to ${channel} firmware?`;
    confirmModalRef.value?.storeAction(async () => {
        try {
            await firmwareStore.updateSelected(channel);
        } catch (error: any) {
            toastStore.error(
                error?.message || `Failed to start ${channel} firmware update`
            );
        }
    });
}

function updateAllToStable() {
    updateByChannel('stable');
}
function updateAllToBeta() {
    updateByChannel('beta');
}

function validateUrlUpdateSelection(): {valid: boolean; reason?: string} {
    const selectedIds = Array.from(selectedDevices.value);
    if (selectedIds.length === 0) {
        return {valid: false, reason: 'Select at least one device first'};
    }

    const selectedDeviceInfo = selectedIds.map((shellyID) => {
        const device = devicesStore.devices[shellyID];
        return {
            shellyID,
            app: device?.info?.app,
            model: device?.info?.model
        };
    });

    if (selectedDeviceInfo.some((device) => !device.app || !device.model)) {
        return {
            valid: false,
            reason: 'Custom URL and temporary firmware updates require selected devices with known app and model information'
        };
    }

    const firstDevice = selectedDeviceInfo[0]!;
    const hasMixedCompatibility = selectedDeviceInfo.some(
        (device) =>
            device.app !== firstDevice.app || device.model !== firstDevice.model
    );
    if (hasMixedCompatibility) {
        return {
            valid: false,
            reason: 'Custom URL and temporary firmware updates can only target devices with the same app and model. Narrow the selection or save the file to the library with compatibility tags first.'
        };
    }

    return {valid: true};
}

function extractFirmwareBuildIdHint(source: string): string | undefined {
    let decoded = source;
    try {
        decoded = decodeURIComponent(source);
    } catch {
        // Ignore malformed URL encoding and fall back to raw string parsing.
    }
    const fwIdMatch = decoded.match(/\b\d{8}-\d{6}\/(g[0-9a-f]{7,})\b/i);
    if (fwIdMatch?.[1]) return fwIdMatch[1].toLowerCase();

    const buildMatch = decoded.match(/\b(g[0-9a-f]{7,})\b/i);
    return buildMatch?.[1]?.toLowerCase();
}

async function startUpdateFromUrl(
    url: string,
    options?: {buildIdHint?: string; skipConfirm?: boolean}
) {
    if (!url) {
        toastStore.error('Enter a firmware image URL first');
        return;
    }

    const validation = validateUrlUpdateSelection();
    if (!validation.valid) {
        toastStore.error(validation.reason!);
        return;
    }

    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            toastStore.error('Firmware URL must use http or https');
            return;
        }
    } catch {
        toastStore.error('Enter a valid firmware image URL');
        return;
    }

    async function doUpdate() {
        try {
            await firmwareStore.updateSelectedByUrl(
                url,
                options?.buildIdHint ?? extractFirmwareBuildIdHint(url)
            );
        } catch (error: any) {
            toastStore.error(
                error?.message || 'Failed to start firmware update from URL'
            );
        }
    }

    if (options?.skipConfirm) {
        await doUpdate();
    } else {
        const count = selectedCount.value;
        confirmTitle.value = `Update ${count} device(s) from custom URL?`;
        confirmModalRef.value?.storeAction(doUpdate);
    }
}

async function uploadFirmwareFile(formData: FormData) {
    const ticket = await createUploadTicket('Firmware.CreateUploadTicket');
    formData.append('ticket', ticket);
    return apiClient.post<{
        success: boolean;
        url?: string;
        fileName: string;
        item?: FirmwareLibraryItem;
    }>('/media/uploadFirmwareFile', formData, {
        headers: {'Content-Type': 'multipart/form-data'}
    });
}

function handleLibraryUploadResult(
    item: FirmwareLibraryItem,
    fileName: string
) {
    void fetchFirmwareLibrary();
    toastStore.success(`Uploaded ${fileName}`);
    if (selectedCount.value > 0) useLibraryItem(item);
}

async function handleTemporaryUploadResult(
    url: string | undefined,
    fileName: string,
    file: File | null
) {
    const uploadedUrl = url ? `${FLEET_MANAGER_HTTP}${url}` : '';
    if (!uploadedUrl)
        throw new Error('Upload succeeded but no firmware URL was returned');
    customFirmwareUrl.value = uploadedUrl;
    toastStore.success(`Uploaded ${fileName}`);
    const hint = file
        ? (extractFirmwareBuildIdHint(file.name) ??
          extractFirmwareBuildIdHint(fileName))
        : extractFirmwareBuildIdHint(fileName);
    await startUpdateFromUrl(uploadedUrl, {
        buildIdHint: hint,
        skipConfirm: true
    });
}

async function handleFirmwareUpload(formData: FormData) {
    uploadModalVisible.value = false;
    try {
        const response = await uploadFirmwareFile(formData);
        if (response.data.item) {
            handleLibraryUploadResult(
                response.data.item,
                response.data.fileName
            );
        } else {
            await handleTemporaryUploadResult(
                response.data.url,
                response.data.fileName,
                formData.get('firmware') as File | null
            );
        }
    } catch (error: any) {
        toastStore.error(
            error?.response?.data?.error ||
                error?.message ||
                'Failed to upload firmware file'
        );
    }
}

function handleUrlSubmit(url: string) {
    urlModalVisible.value = false;
    customFirmwareUrl.value = url;
    void startUpdateFromUrl(url);
}

function isLibraryItemCompatible(
    item: FirmwareLibraryItem,
    shellyID: string
): boolean {
    const device = devicesStore.devices[shellyID];
    if (!device) return false;

    if (item.model && item.model !== device.info?.model) {
        return false;
    }
    if (item.app && item.app !== device.info?.app) {
        return false;
    }
    return true;
}

function hasLibraryCompatibilityMetadata(item: FirmwareLibraryItem): boolean {
    return Boolean(item.model || item.app);
}

function selectedDevicesShareKnownCompatibilityTarget(): boolean {
    const selectedInfo = Array.from(selectedDevices.value).map((shellyID) => {
        const device = devicesStore.devices[shellyID];
        return {
            shellyID,
            app: device?.info?.app,
            model: device?.info?.model
        };
    });

    if (selectedInfo.length === 0) return false;
    if (selectedInfo.some((device) => !device.app || !device.model)) {
        return false;
    }

    const first = selectedInfo[0]!;
    return selectedInfo.every(
        (device) => device.app === first.app && device.model === first.model
    );
}

function compatibleSelectedCount(item: FirmwareLibraryItem): number {
    if (!hasLibraryCompatibilityMetadata(item)) {
        return selectedDevicesShareKnownCompatibilityTarget()
            ? selectedDevices.value.size
            : 0;
    }

    return Array.from(selectedDevices.value).filter((shellyID) =>
        isLibraryItemCompatible(item, shellyID)
    ).length;
}

function canUseLibraryItem(item: FirmwareLibraryItem): boolean {
    if (selectedCount.value === 0) return false;
    return compatibleSelectedCount(item) > 0;
}

async function fetchFirmwareLibrary() {
    isLoadingLibrary.value = true;
    try {
        const result = await sendRPC<FirmwareListLibraryResponse>(
            'FLEET_MANAGER',
            'Firmware.ListLibrary'
        );
        firmwareLibrary.value = result?.items ?? [];
    } catch (error: any) {
        toastStore.error(
            error?.message || 'Failed to fetch firmware library'
        );
    } finally {
        isLoadingLibrary.value = false;
    }
}

function removeStaleLibraryItem(itemId: string) {
    firmwareLibrary.value = firmwareLibrary.value.filter(
        (entry: FirmwareLibraryItem) => entry.id !== itemId
    );
}

// Library detail popup — click a library row to see its metadata + actions.
const libraryDetailItem = ref<FirmwareLibraryItem | null>(null);
const libraryDetailVisible = ref(false);
const libraryDetailCanFlash = computed(
    () =>
        selectedCount.value > 0 &&
        !!libraryDetailItem.value &&
        canUseLibraryItem(libraryDetailItem.value)
);

function openLibraryDetail(item: FirmwareLibraryItem) {
    libraryDetailItem.value = item;
    libraryDetailVisible.value = true;
}

function flashFromDetail() {
    if (libraryDetailItem.value) useLibraryItem(libraryDetailItem.value);
    libraryDetailVisible.value = false;
}

function editFromDetail() {
    if (libraryDetailItem.value) openEditLibraryItem(libraryDetailItem.value);
    libraryDetailVisible.value = false;
}

function deleteFromDetail() {
    if (libraryDetailItem.value) deleteLibraryItem(libraryDetailItem.value);
    libraryDetailVisible.value = false;
}

async function executeLibraryUpdate(
    item: FirmwareLibraryItem,
    compatibleIds: string[]
) {
    try {
        const urlResult = await sendRPC<{url: string}>(
            'FLEET_MANAGER',
            'Firmware.CreateLibraryDownloadUrl',
            {id: item.id}
        );
        await firmwareStore.updateDeviceIdsByUrl(
            compatibleIds,
            `${FLEET_MANAGER_HTTP}${urlResult.url}`,
            item.fwId || extractFirmwareBuildIdHint(item.originalFileName)
        );
    } catch (error: any) {
        const isStale = isResourceNotFound(
            error,
            FIRMWARE_LIBRARY_ITEM_RESOURCE_TYPE
        );
        if (isStale) removeStaleLibraryItem(item.id);
        toastStore.error(
            isStale
                ? 'Firmware library item is no longer available'
                : error?.message ||
                      'Failed to start firmware update from library item'
        );
    }
}

function useLibraryItem(item: FirmwareLibraryItem) {
    if (!hasLibraryCompatibilityMetadata(item)) {
        if (!selectedDevicesShareKnownCompatibilityTarget()) {
            toastStore.error(
                'This firmware has no compatibility tags. Select devices with the same app and model first.'
            );
            return;
        }
        confirmTitle.value = `Firmware "${item.name}" has no compatibility tags. Continue anyway?`;
        confirmModalRef.value?.storeAction(async () => {
            await proceedWithLibraryItem(item);
        });
        return;
    }
    proceedWithLibraryItem(item);
}

async function proceedWithLibraryItem(item: FirmwareLibraryItem) {
    const compatibleIds = Array.from(selectedDevices.value).filter((id) =>
        isLibraryItemCompatible(item, id)
    );
    if (compatibleIds.length === 0) {
        toastStore.error(
            'No selected devices are compatible with this firmware'
        );
        return;
    }
    if (compatibleIds.length !== selectedDevices.value.size) {
        confirmTitle.value = `Only ${compatibleIds.length} of ${selectedDevices.value.size} selected devices match. Update compatible devices only?`;
        confirmModalRef.value?.storeAction(async () => {
            await executeLibraryUpdate(item, compatibleIds);
        });
        return;
    }
    await executeLibraryUpdate(item, compatibleIds);
}

function openEditLibraryItem(item: FirmwareLibraryItem) {
    editingLibraryItem.value = item;
    editModalVisible.value = true;
}

async function saveLibraryItemEdits(
    item: FirmwareLibraryItem,
    updates: Record<string, string>
) {
    editModalVisible.value = false;
    if (Object.keys(updates).length === 0) return;
    try {
        const params: FirmwareUpdateLibraryEntryParams = {
            ...updates,
            id: item.id
        };
        await sendRPC('FLEET_MANAGER', 'Firmware.UpdateLibraryEntry', params);
        const entry = firmwareLibrary.value.find((e) => e.id === item.id);
        if (entry) {
            if (updates.name !== undefined) entry.name = updates.name;
            if (updates.model !== undefined) entry.model = updates.model;
            if (updates.app !== undefined) entry.app = updates.app;
            if (updates.ver !== undefined) entry.ver = updates.ver;
            if (updates.channel !== undefined)
                entry.channel = coerceChannel(updates.channel);
            if (updates.tags !== undefined)
                entry.tags = updates.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean);
        }
        toastStore.success('Firmware metadata updated');
    } catch (error: any) {
        toastStore.error(
            error?.response?.data?.error ||
                error?.message ||
                'Failed to update firmware metadata'
        );
    }
}

function coerceChannel(
    value: string
): 'stable' | 'beta' | 'custom' | undefined {
    return value === 'stable' || value === 'beta' || value === 'custom'
        ? value
        : undefined;
}

function deleteLibraryItem(item: FirmwareLibraryItem) {
    confirmTitle.value = `Delete firmware "${item.name}"?`;
    confirmModalRef.value?.storeAction(async () => {
        try {
            await sendRPC('FLEET_MANAGER', 'Firmware.DeleteLibraryEntry', {
                id: item.id
            });
            firmwareLibrary.value = firmwareLibrary.value.filter(
                (entry) => entry.id !== item.id
            );
            toastStore.success(`Deleted ${item.name}`);
        } catch (error: any) {
            toastStore.error(
                error?.message || 'Failed to delete firmware file'
            );
        }
    });
}

// Step 2 (Progress) actions
async function retryDevice(shellyID: string) {
    try {
        await firmwareStore.retryDevice(shellyID);
    } catch (error: any) {
        toastStore.error(error?.message || 'Failed to retry firmware update');
    }
}

async function retryAllFailed() {
    try {
        await firmwareStore.retryFailed();
    } catch (error: any) {
        toastStore.error(
            error?.message || 'Failed to retry failed firmware updates'
        );
    }
}

function finishAndReset() {
    firmwareStore.reset();
    customFirmwareUrl.value = '';
}

</script>

<style scoped>
.fw-page { gap: var(--space-2); }
.fw-filter-chips { margin: 0 var(--space-2); }

/* Slider uses shared route-tabs from device-page.css */

/* ── Device card with firmware badge overlay ── */
.fw-card {
    position: relative;
}

/* Thin colored strip at card bottom — firmware status indicator */
.fw-card__strip {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    border-radius: 0 0 var(--radius-card) var(--radius-card);
    pointer-events: none;
    z-index: 2;
}

.fw-dot--stable { background: var(--color-success-text); }
.fw-dot--beta { background: var(--color-warning-text); }
.fw-dot--checking { background: var(--color-primary-text); animation: fw-pulse 1.2s ease-in-out infinite; }
.fw-dot--error { background: var(--color-danger-text); }

@keyframes fw-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
}

/* Golden ratio split: 61.8% content / 38.2% actions */
.fwa__split {
    flex: 1;
    display: flex;
    overflow: hidden;
    gap: var(--space-3); /* golden */
    padding: var(--space-3);
}

/* Left: device table (61.8%) */
.fwa__content {
    flex: 1.618;
    overflow-y: auto;
}

/* Right: action sidebar (38.2%) */
.fwa__sidebar-wrap {
    flex: 1;
    overflow-y: auto;
}
/* Table uses shared dp-table from device-page.css */

.fwa__ver {
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
}
.fwa__ver--stable {
    color: var(--color-success-text);
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
}
.fwa__ver--beta {
    color: var(--color-orange);
    background: color-mix(in srgb, var(--color-orange) 12%, transparent);
}
.fwa__ver--none {
    color: var(--color-text-disabled);
    font-family: var(--font-mono);
}

.fwa__auto {
    font-weight: var(--font-medium);
    text-transform: capitalize;
}
.fwa__auto--off { color: var(--color-text-disabled); }
.fwa__auto--stable { color: var(--color-success-text); }
.fwa__auto--beta { color: var(--color-orange); }

.fwa__status--checking { color: var(--color-text-disabled); }
.fwa__status--update { color: var(--color-primary-text); }
.fwa__status--current { color: var(--color-success-text); }
.fwa__status--error { color: var(--color-danger-text); }

.fwa__progress-bar-cell {
    width: 33%;
}
.fwa__progress-track {
    width: 100%;
    height: var(--space-2);
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
}
.fwa__progress-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width var(--duration-moderate) var(--ease-default);
}
.fwa__update-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.fwa__update-status--active { color: var(--color-primary-text); }
.fwa__update-status--warning { color: var(--color-warning-text); }
.fwa__update-status--success { color: var(--color-success-text); }
.fwa__update-status--error { color: var(--color-danger-text); }
.fwa__update-status--waiting { color: var(--color-text-disabled); }

/* ── Inline progress strip ── */
.fw-progress {
    border: 1px solid var(--color-border-medium);
    border-radius: var(--btn-radius);
    background: var(--color-surface-2);
    overflow: hidden;
    flex-shrink: 0;
    margin: 0 var(--space-5) var(--space-2);
}
.fw-progress__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--touch-target-min);
    padding: 0 var(--space-3);
    background: none;
    border: none;
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
}
.fw-progress__header:hover {
    background: color-mix(in srgb, var(--color-text-tertiary) 4%, transparent);
}
.fw-progress__done-icon {
    color: var(--color-success-text);
}
.fw-progress__summary {
    font-weight: var(--font-semibold);
    white-space: nowrap;
}
.fw-progress__counts {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    white-space: nowrap;
}
.fw-progress__counts i.fa-check { color: var(--color-success-text); }
.fw-progress__counts i.fa-times { color: var(--color-danger-text); }
.fw-progress__counts i.fa-spin { color: var(--color-primary-text); }
.fw-progress__bar {
    flex: 1;
    height: var(--space-2);
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
    min-width: var(--space-20);
}
.fw-progress__bar-fill {
    height: 100%;
    background: var(--color-primary);
    border-radius: var(--radius-full);
    transition: width var(--duration-moderate) var(--ease-default);
}
.fw-progress__chevron {
    font-size: var(--type-body);
    color: var(--color-text-disabled);
    transition: transform var(--duration-fast);
}
.fw-progress__chevron--open {
    transform: rotate(180deg);
}
.fw-progress__body {
    border-top: 1px solid var(--color-border-medium);
    max-height: 240px;
    overflow-y: auto;
    padding: var(--space-2);
}
.fw-progress__footer {
    padding: var(--space-2);
    border-top: 1px solid var(--color-border-medium);
}

/* Slide transition for progress strip */
.bulk-slide-enter-active,
.bulk-slide-leave-active {
    transition: max-height var(--duration-normal) ease, opacity var(--duration-normal) ease;
    overflow: hidden;
}
.bulk-slide-enter-from,
.bulk-slide-leave-to {
    max-height: 0;
    opacity: 0;
}
.bulk-slide-enter-to,
.bulk-slide-leave-from {
    max-height: 400px;
    opacity: 1;
}

/* ── Responsive (shared header/search/table handled by device-page.css) ── */
@media (max-width: 768px) {
    .dp-filter-bar { flex-wrap: wrap; }
    .fwa__split { flex-direction: column; padding: var(--space-2); }
}
</style>
