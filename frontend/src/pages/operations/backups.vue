<template>
    <div class="flex min-h-0 flex-1 flex-col">
    <div class="h-full flex flex-col gap-2">
        <h2 class="sr-only">Device Backups</h2>

        <!-- ================================================================ -->
        <!-- VIEW: Backup Library -->
        <!-- ================================================================ -->
        <ErrorBoundary>
        <!-- ============================================================ -->
        <!-- MAIN VIEW: Device selection + Backups table                  -->
        <!-- ============================================================ -->
        <PageTemplate
            fill
            v-if="!actionPanel"
            title="Backups"
            :tabs="operationsTabs"
            :count="`${executableDevices.length} devices`"
            searchable
            v-model:search="backupSearch"
            filterable
            :has-active-filter="showFilters || hasDeviceFilters"
            :filter-count="backupsActiveFilterCount || undefined"
            search-placeholder="Search backups…"
            @filter-click="onFilterClick"
        >
            <template #actions>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :disabled="loading"
                    title="Refresh"
                    aria-label="Refresh"
                    @click="refreshBackups"
                ><i class="fas fa-sync-alt" :class="{'fa-spin': loading}" /></Button>
                <Button
                    type="blue-hollow"
                    size="sm"
                    title="Export CSV"
                    aria-label="Export CSV"
                    @click="exportBackups"
                ><i class="fas fa-file-export" /></Button>
            </template>
            <template #toggles>
                <div class="route-tabs">
                    <div class="route-tabs__track" :class="{'route-tabs__track--end': bkView === 'backups'}" />
                    <button type="button" class="route-tabs__btn" :class="{'route-tabs__btn--active': bkView === 'devices'}" @click="bkView = 'devices'">Devices</button>
                    <button type="button" class="route-tabs__btn" :class="{'route-tabs__btn--active': bkView === 'backups'}" @click="bkView = 'backups'">Backups</button>
                </div>
            </template>

            <BasicBlock
                v-if="showFilters && bkView === 'backups'"
                bordered
                padding="sm"
                class="bk-filters"
            >
                <div class="bk-filters__grid">
                    <FormField label="Model">
                        <FilterSelect v-model="filterModel" :options="modelOptions" />
                    </FormField>
                    <FormField label="App">
                        <FilterSelect v-model="filterApp" :options="appOptions" />
                    </FormField>
                    <FormField label="Firmware">
                        <FilterSelect v-model="filterFirmware" :options="firmwareOptions" />
                    </FormField>
                    <FormField label="Date">
                        <FilterSelect v-model="filterDate" :options="dateOptions as string[]" />
                    </FormField>
                    <FormField label="Group">
                        <FilterSelect v-model="filterGroup" :options="groupFilterOptions" />
                    </FormField>
                </div>
                <div class="bk-filters__actions">
                    <Button type="blue-hollow" size="sm" @click="clearFilters">
                        Clear Filters
                    </Button>
                </div>
            </BasicBlock>

            <!-- Device cards — auto-wrapped by PageTemplate's GlassShell -->
            <template v-if="bkView === 'devices'">
                <div v-if="loading" class="dc-grid"><Skeleton v-for="n in 8" :key="n" variant="card" /></div>
                <EmptyBlock v-else-if="filteredDevices.length === 0">
                    <p class="text-base font-semibold pb-2">{{ executableDevices.length === 0 ? 'No devices online' : 'No devices match filters' }}</p>
                </EmptyBlock>
                <div v-else class="dc-grid">
                    <DeviceFleetCard v-for="device in filteredDevices" :key="device.shellyID" :device="device" :selected="isSelected(device.shellyID)" @select="toggleDevice(device.shellyID)" />
                </div>
            </template>

            <!-- Backups table — auto-wrapped by PageTemplate's GlassShell -->
            <template v-else-if="bkView === 'backups'">
                <EmptyBlock v-if="backupsList.length === 0">
                    <p class="text-base font-semibold pb-2">No backups yet</p>
                    <p class="text-base text-[var(--color-text-secondary)]">Select devices and click Backup.</p>
                </EmptyBlock>
                <DataList
                    v-else
                    :rows="sortedBackups"
                    :columns="backupColumns"
                    row-key="id"
                    :sort-key="bkSortKey"
                    :sort-asc="bkSortAsc"
                    clickable
                    @sort="bkToggleSort"
                    @row-click="openDetailModal"
                >
                    <template #cell-createdDateKey="{row}">{{ formatDate(row.createdAt) }}</template>
                    <template #cell-fileSize="{row}">{{ formatBytes(row.fileSize) }}</template>
                    <template #cell-contentsSummary="{row}">{{ row.contentsSummary || 'Base config' }}</template>
                </DataList>
            </template>
        </PageTemplate>

        <!-- ============================================================ -->
        <!-- ACTION VIEW: Unified panel (backup + restore on one screen) -->
        <!-- ============================================================ -->
        <div v-else-if="actionPanel" class="flex-1 flex flex-col bk-action-shell">
            <header class="dp-header">
                <div class="dp-header__left bk-action-header__left">
                    <h1 class="dp-header__title">{{ actionPanel === 'restore' ? `Restore: ${restoreBackupData?.name}` : 'Backup Actions' }}</h1>
                    <span class="dp-header__count">{{ selectedCount }} devices</span>
                </div>
                <div class="dp-header__right">
                    <Button type="blue-hollow" size="sm" @click="actionPanel = actionPanel === 'restore' ? 'backup' : null">
                        Back
                    </Button>
                </div>
            </header>

            <div class="bk-split">
                <!-- LEFT 61.8%: Device table -->
                <BasicBlock bordered blurred padding="sm" class="bk-split__content">
                    <!-- Backup mode: selected devices + progress + inline naming -->
                    <template v-if="actionPanel === 'backup'">
                        <DataList
                            v-if="progressList.length > 0"
                            :rows="progressList"
                            :columns="progressColumns"
                            row-key="shellyID"
                            empty-message=""
                        >
                            <template #cell-firmware="{row}">
                                <span class="dp-table__mono">{{ devicesStore.devices[row.shellyID]?.info?.ver || '—' }}</span>
                            </template>
                            <template #cell-progress="{row}">
                                <span v-if="row.status === 'success'" class="bk-status bk-status--success"><i class="fas fa-check" /> Done</span>
                                <span v-else-if="row.status === 'failed'" class="bk-status bk-status--error"><i class="fas fa-times" /> {{ row.error || 'Failed' }}</span>
                                <span v-else-if="row.status === 'idle'" class="bk-status bk-status--waiting">Waiting</span>
                                <span v-else class="bk-status bk-status--active">
                                    <Spinner size="xs" /> {{ row.status }}
                                    <div class="bk-progress-bar"><div class="bk-progress-fill" /></div>
                                </span>
                            </template>
                            <template #cell-name="{row}">
                                <input v-if="row.status === 'success'" v-model="backupNames[row.shellyID]" type="text" class="bk-inline-name" />
                            </template>
                        </DataList>
                        <EmptyBlock v-else>Select devices and use the sidebar actions.</EmptyBlock>
                    </template>

                    <!-- Restore mode: compatible devices with better info -->
                    <template v-else-if="actionPanel === 'restore'">
                        <DataList
                            v-if="restoreCompatibleDevices.length > 0"
                            :rows="restoreCompatibleDevices"
                            :columns="restoreColumns"
                            row-key="shellyID"
                            clickable
                            @row-click="(d) => toggleRestoreDevice(d.shellyID)"
                        >
                            <template #cell-select="{row}">
                                <Checkbox
                                    :model-value="restoreTargets.has(row.shellyID)"
                                    @click.stop
                                    @update:model-value="() => toggleRestoreDevice(row.shellyID)"
                                />
                            </template>
                            <template #cell-deviceName="{row}">
                                <span class="dp-table__name" :title="row.shellyID">{{ deviceDisplayName(row) }}</span>
                            </template>
                            <template #cell-model="{row}">
                                <span class="dp-table__mono">{{ row.info?.model || '—' }}</span>
                            </template>
                            <template #cell-firmware="{row}">
                                <span class="dp-table__mono">{{ row.info?.ver || '—' }}</span>
                            </template>
                            <template #cell-lastBackup="{row}">{{ getLastBackupDate(row.shellyID) }}</template>
                            <template #cell-status>
                                <span><span class="bk-online-dot" /> Online</span>
                            </template>
                        </DataList>
                        <EmptyBlock v-else>No compatible devices online ({{ restoreBackupData?.model }})</EmptyBlock>
                    </template>
                </BasicBlock>

                <!-- RIGHT 38.2%: Actions sidebar -->
                <BasicBlock bordered blurred padding="sm" class="bk-split__sidebar">
                    <div class="bk-sidebar">
                        <!-- Backup section -->
                        <div v-if="actionPanel === 'backup'" class="bk-sidebar__group">
                            <h4 class="bk-sidebar__title">Extra Content</h4>
                            <div class="bk-sidebar__grid">
                                <Checkbox
                                    v-for="(label, key) in CONTENT_LABELS"
                                    :key="`bk-${key}`"
                                    v-model="backupContents[key as keyof typeof backupContents]"
                                    :label="label"
                                />
                            </div>
                        </div>
                        <div v-if="actionPanel === 'backup'" class="bk-sidebar__actions">
                            <Button v-if="!isCreating && !allComplete" type="green" size="sm" @click="startBackup">
                                Start Backup ({{ selectedCount }})
                            </Button>
                            <Button v-if="failedDevices.length > 0" type="blue-hollow" size="sm" @click="retryFailed">
                                Retry ({{ failedDevices.length }})
                            </Button>
                        </div>

                        <!-- Done/Save actions after backup completes -->
                        <div v-if="actionPanel === 'backup' && allComplete" class="bk-sidebar__actions">
                            <Button type="blue" size="sm" @click="saveNamesAndFinish">
                                Save & Done
                            </Button>
                            <Button type="blue-hollow" size="sm" @click="finishWithoutNaming">
                                Skip
                            </Button>
                        </div>

                        <!-- Restore section (when in backup mode — pick a backup to restore) -->
                        <div v-if="actionPanel === 'backup' && !isCreating" class="bk-sidebar__group">
                            <h4 class="bk-sidebar__title">Restore</h4>
                            <p v-if="compatibleBackupsForSelected.length === 0" class="bk-sidebar__empty">No backups for selected model</p>
                            <Dropdown
                                v-else
                                :options="restoreDropdownOptions"
                                :default="RESTORE_PLACEHOLDER"
                                @selected="onRestoreBackupPicked"
                            />
                        </div>

                        <!-- Restore details (when restore is active) -->
                        <template v-if="actionPanel === 'restore'">
                            <!-- Backup info card -->
                            <div class="bk-sidebar__card">
                                <div class="bk-sidebar__card-row">
                                    <span class="bk-sidebar__card-label">Model</span>
                                    <span class="bk-sidebar__card-value">{{ restoreBackupData?.model }}</span>
                                </div>
                                <div class="bk-sidebar__card-row">
                                    <span class="bk-sidebar__card-label">Firmware</span>
                                    <span class="bk-sidebar__card-value">{{ restoreBackupData?.fwVersion }}</span>
                                </div>
                                <div class="bk-sidebar__card-row">
                                    <span class="bk-sidebar__card-label">Contains</span>
                                    <span class="bk-sidebar__card-value">{{ restoreBackupData?.contentsSummary || 'Base config' }}</span>
                                </div>
                            </div>

                            <!-- Content selection — only show items that exist in backup -->
                            <div class="bk-sidebar__group">
                                <h4 class="bk-sidebar__title">Content</h4>
                                <div class="bk-sidebar__grid">
                                    <Checkbox
                                        v-for="(label, key) in CONTENT_LABELS"
                                        :key="`rs-${key}`"
                                        v-model="restoreContents[key as keyof typeof restoreContents]"
                                        :label="label"
                                        :disabled="!backupHasContent(key as string)"
                                    />
                                </div>
                            </div>

                            <div class="bk-sidebar__warning">
                                <i class="fas fa-exclamation-triangle" /> Devices reboot after restore
                            </div>
                            <Button type="green" size="sm" :disabled="restoreTargets.size === 0" @click="executeRestore">
                                Restore ({{ restoreTargets.size }})
                            </Button>
                        </template>
                    </div>
                </BasicBlock>
            </div>
        </div>

        </ErrorBoundary>

        <!-- Selection actions live in the shared floating SelectionBar, not the header -->
        <SelectionBar
            v-if="!actionPanel && selectedCount > 0"
            :count="selectedCount"
            :all-selected="allSelected"
            @select-all="selectAll"
            @clear="clearSelection"
            @done="clearSelection"
        >
            <Button type="green" size="sm" @click="actionPanel = 'backup'">
                Back up
            </Button>
        </SelectionBar>

        <!-- ================================================================ -->
        <!-- Detail Modal (click on backup card) -->
        <!-- ================================================================ -->
        <BackupDetailModal
            :visible="detailModalVisible"
            :backup="detailBackup"
            @close="closeDetailModal"
            @action="detailAction"
        />

        <!-- ================================================================ -->
        <!-- Rename Modal -->
        <!-- ================================================================ -->
        <BackupRenameModal
            :visible="renameModalVisible"
            :backup-id="renameBackupId"
            :backup-name="renameBackupName"
            @close="closeRenameModal"
            @renamed="onRenameComplete"
        />

        <FilterModal
            :visible="deviceFilterVisible"
            :sections="deviceFilterSections"
            :initial-state="deviceFilterState"
            :match-count="filteredDevices.length"
            @close="deviceFilterVisible = false"
            @apply-generic="applyDeviceFilters"
        />
        <ConfirmationModal ref="confirmModalRef">
            <template #title><h3>{{ confirmTitle }}</h3></template>
        </ConfirmationModal>
    </div>
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, inject, onMounted, onUnmounted, reactive, ref, watch} from 'vue';
import BackupDetailModal from '@/components/backups/BackupDetailModal.vue';
import BackupRenameModal from '@/components/backups/BackupRenameModal.vue';
import DeviceFleetCard from '@/components/cards/DeviceFleetCard.vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import FilterSelect from '@/components/core/FilterSelect.vue';
import FormField from '@/components/core/FormField.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import SelectionBar from '@/components/core/SelectionBar.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import Spinner from '@/components/core/Spinner.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {useSortableTable} from '@/composables/useSortableTable';
import {useSubjectAssociations} from '@/composables/useSubjectAssociations';
import {useUrlState} from '@/composables/useUrlState';
import {
    BACKUP_CONTENT_LABELS,
    createEmptyBackupContents
} from '@/helpers/backupContents';
import {fwVersionAtLeast} from '@/helpers/device';
import {downloadCsv} from '@/helpers/exportCsv';
import {
    countByKey,
    type KindedLocation,
    locationIdsFromState,
    locationSectionsByKind,
    locationStateByKind,
    namedSection
} from '@/helpers/filter-sections';
import {formatBytes, formatDate} from '@/helpers/format';
import {
    type BackupDeviceInfo,
    type BackupMetadata,
    useBackupsStore
} from '@/stores/backups';
import {useDevicesStore} from '@/stores/devices';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import {useToastStore} from '@/stores/toast';
import type {shelly_device_t} from '@/types';
import type {RouteTab} from '@/types/page-template';

const operationsTabs = inject<RouteTab[]>('operationsTabs', [] as RouteTab[]);

interface ConfirmationModalHandle {
    storeAction(action: () => void | Promise<void>): void;
}

const backupColumns: DataColumn<BackupMetadata>[] = [
    {key: 'name', label: 'Name', role: 'primary', sortable: true},
    {key: 'deviceName', label: 'Device', role: 'secondary', sortable: true, accessor: (b) => b.deviceName || b.shellyID},
    {key: 'model', label: 'Model', role: 'meta', mono: true, sortable: true},
    {key: 'fwVersion', label: 'Firmware', role: 'meta', mono: true, sortable: true},
    {key: 'createdDateKey', label: 'Date', role: 'meta', sortable: true},
    {key: 'fileSize', label: 'Size', role: 'meta', mono: true, sortable: true},
    {key: 'contentsSummary', label: 'Contents', role: 'meta'}
];

const progressColumns = computed<DataColumn<BackupDeviceInfo>[]>(() => {
    const cols: DataColumn<BackupDeviceInfo>[] = [
        {key: 'deviceName', label: 'Device', role: 'primary'},
        {key: 'model', label: 'Model', role: 'meta', mono: true},
        {key: 'firmware', label: 'Firmware', role: 'meta', mono: true}
    ];
    if (isCreating.value || allComplete.value)
        cols.push({key: 'progress', label: 'Progress', role: 'status'});
    if (allComplete.value)
        cols.push({key: 'name', label: 'Name', role: 'meta'});
    return cols;
});

const restoreColumns: DataColumn<shelly_device_t>[] = [
    {key: 'select', label: '', role: 'action', width: '32px'},
    {key: 'deviceName', label: 'Device', role: 'primary'},
    {key: 'model', label: 'Model', role: 'meta', mono: true},
    {key: 'firmware', label: 'Firmware', role: 'meta', mono: true},
    {key: 'lastBackup', label: 'Last Backup', role: 'meta'},
    {key: 'status', label: 'Status', role: 'status'}
];

const backupsStore = useBackupsStore();
const groupsStore = useGroupsStore();
const tagsStore = useTagsStore();
const locationsStore = useLocationsStore();

// Device → tagIds[] / locationIds[] reverse index, derived from the device FKs.
const {tagsByDevice, locationsByDevice} = useSubjectAssociations();
const toastStore = useToastStore();
const confirmModalRef = ref<ConfirmationModalHandle>();
const confirmTitle = ref('Are you sure?');
const devicesStore = useDevicesStore();
const {
    backups,
    loading,
    selectedDevices,
    backupContents,
    backupsList,
    selectedCount,
    executableDevices,
    isCreating,
    progressList,
    successDevices,
    failedDevices,
    allComplete
} = storeToRefs(backupsStore);

const CONTENT_LABELS = BACKUP_CONTENT_LABELS;

const bkView = ref<'devices' | 'backups'>('devices');
const actionPanel = ref<'backup' | 'restore' | null>(null);
const showFilters = ref(false);
const deviceFilterVisible = ref(false);
const filterGroupIds = ref<number[]>([]);
const filterModels = ref<string[]>([]);
const filterTagIds = ref<number[]>([]);
const filterLocationIds = ref<number[]>([]);

// Backup naming state (after creation completes)
const backupNames = reactive<Record<string, string>>({});

// Pre-fill name inputs when backups complete
watch(allComplete, (done) => {
    if (done) {
        for (const info of successDevices.value) {
            const backup = backupsList.value.find(
                (b) => b.shellyID === info.shellyID
            );
            backupNames[info.shellyID] = backup?.name || info.deviceName;
        }
    }
});

// Restore panel state
const restoreBackupData = ref<BackupMetadata | null>(null);
const restoreTargets = reactive(new Set<string>());
const restoreContents = reactive(createEmptyBackupContents());
const urlState = useUrlState('backups-filters', {
    search: '',
    model: '',
    app: '',
    firmware: '',
    date: '',
    group: ''
});
const backupSearch = urlState.search;
const filterModel = urlState.model;
const filterApp = urlState.app;
const filterFirmware = urlState.firmware;
const filterDate = urlState.date;
const filterGroup = urlState.group;
const modelOptions = computed(() =>
    Array.from(
        new Set(backupsList.value.map((backup) => backup.model).filter(Boolean))
    ).sort()
);
const appOptions = computed(() =>
    Array.from(
        new Set(backupsList.value.map((backup) => backup.app).filter(Boolean))
    ).sort()
);
const firmwareOptions = computed(() =>
    Array.from(
        new Set(
            backupsList.value.map((backup) => backup.fwVersion).filter(Boolean)
        )
    ).sort()
);
const dateOptions = computed(() =>
    Array.from(
        new Set(
            backupsList.value
                .map((backup) => backup.createdDateKey)
                .filter(Boolean)
        )
    ).sort()
);
const groupFilterOptions = computed(() =>
    Array.from(
        new Set(backupsList.value.flatMap((backup) => backup.groupNames || []))
    ).sort()
);
const filteredBackupsList = computed(() => {
    const query = backupSearch.value.trim().toLowerCase();

    return backupsList.value.filter((backup) => {
        if (filterModel.value && backup.model !== filterModel.value) {
            return false;
        }
        if (filterApp.value && backup.app !== filterApp.value) {
            return false;
        }
        if (filterFirmware.value && backup.fwVersion !== filterFirmware.value) {
            return false;
        }
        if (filterDate.value && backup.createdDateKey !== filterDate.value) {
            return false;
        }
        if (
            filterGroup.value &&
            !(backup.groupNames || []).includes(filterGroup.value)
        ) {
            return false;
        }
        if (!query) {
            return true;
        }

        return [
            backup.name,
            backup.shellyID,
            backup.deviceName,
            backup.model,
            backup.app,
            backup.fwVersion,
            backup.createdDateKey,
            backup.contentsSummary,
            ...(backup.groupNames || [])
        ]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
    });
});

const {
    sortKey: bkSortKey,
    sortAsc: bkSortAsc,
    toggleSort: bkToggleSort,
    sorted: sortedBackups
} = useSortableTable(filteredBackupsList, 'createdAt', false, {
    name: (a, b) => a.name.localeCompare(b.name),
    device: (a, b) =>
        (a.deviceName || a.shellyID).localeCompare(b.deviceName || b.shellyID),
    model: (a, b) => a.model.localeCompare(b.model),
    fwVersion: (a, b) => a.fwVersion.localeCompare(b.fwVersion),
    createdAt: (a, b) => a.createdAt - b.createdAt,
    fileSize: (a, b) => a.fileSize - b.fileSize
});

function clearFilters() {
    backupSearch.value = '';
    filterModel.value = '';
    filterApp.value = '';
    filterFirmware.value = '';
    filterDate.value = '';
    filterGroup.value = '';
}

// Backups view shows inline filter strip; the device view opens the device filter modal.
function onFilterClick() {
    if (bkView.value === 'backups') {
        showFilters.value = !showFilters.value;
    } else {
        deviceFilterVisible.value = true;
    }
}

// ========================================================================
// Device selection helpers
// ========================================================================

function isSelected(shellyID: string) {
    return selectedDevices.value.has(shellyID);
}

// Restore panel helpers
const restoreCompatibleDevices = computed(() => {
    if (!restoreBackupData.value) return [];
    const model = restoreBackupData.value.model;
    const app = restoreBackupData.value.app;
    return Object.values(devicesStore.devices).filter(
        (d) =>
            d.online &&
            d.capabilities?.backup === true &&
            d.info?.model === model &&
            (!app || !d.info?.app || d.info.app === app) &&
            fwVersionAtLeast(d.info?.ver || '0.0.0', 1, 8, 0)
    );
});

function getLastBackupDate(shellyID: string): string {
    const deviceBackups = backupsList.value.filter(
        (b) => b.shellyID === shellyID
    );
    if (deviceBackups.length === 0) return 'Never';
    return deviceBackups[0].createdDateKey || 'Unknown';
}

function deviceDisplayName(device: any): string {
    return device.info?.name || device.shellyID || 'Unknown';
}

function backupHasContent(key: string): boolean {
    if (!restoreBackupData.value?.contents) return false;
    return restoreBackupData.value.contents[key] === true;
}

function toggleRestoreDevice(shellyID: string) {
    if (restoreTargets.has(shellyID)) restoreTargets.delete(shellyID);
    else restoreTargets.add(shellyID);
}

function openRestorePanel(backupId: string) {
    const backup = backups.value[backupId];
    if (!backup) return;
    restoreBackupData.value = backup;
    restoreTargets.clear();
    // Auto-select devices that were selected on the main page
    for (const id of selectedDevices.value) {
        if (restoreCompatibleDevices.value.some((d) => d.shellyID === id)) {
            restoreTargets.add(id);
        }
    }
    // Auto-check content that exists in the backup, uncheck what doesn't
    const empty = createEmptyBackupContents();
    for (const key of Object.keys(empty)) {
        (restoreContents as Record<string, boolean>)[key] =
            backup.contents?.[key] === true;
    }
    actionPanel.value = 'restore';
}

async function executeRestore() {
    if (!restoreBackupData.value || restoreTargets.size === 0) return;
    const backupId = restoreBackupData.value.id;
    const targets = Array.from(restoreTargets);
    const contentFilter = Object.values(restoreContents).some(Boolean)
        ? {...restoreContents}
        : undefined;

    confirmTitle.value = `Restore to ${targets.length} device(s)? They will reboot.`;
    confirmModalRef.value?.storeAction(async () => {
        let queuedCount = 0;
        for (const shellyID of targets) {
            try {
                await backupsStore.restoreBackup(
                    backupId,
                    shellyID,
                    contentFilter
                );
                queuedCount++;
                toastStore.success(
                    `Restore queued for ${deviceDisplayName(devicesStore.devices[shellyID])}`
                );
            } catch (error: any) {
                toastStore.error(
                    `Failed to restore ${shellyID}: ${error?.message || 'Unknown error'}`
                );
            }
        }
        if (queuedCount > 0) {
            toastStore.success(`${queuedCount} restore job(s) queued`);
        }
        actionPanel.value = null;
    });
}

// Backups compatible with selected devices (for restore flow)
const compatibleBackupsForSelected = computed(() => {
    if (selectedCount.value === 0) return [];
    const selectedModels = new Set<string>();
    for (const id of selectedDevices.value) {
        const device = devicesStore.devices[id];
        if (device?.info?.model) selectedModels.add(device.info.model);
    }
    return backupsList.value.filter((b) => selectedModels.has(b.model));
});

const RESTORE_PLACEHOLDER = 'Select a backup…';
const restoreDropdownOptions = computed(() => [
    RESTORE_PLACEHOLDER,
    ...compatibleBackupsForSelected.value.map(
        (b) => `${b.name} · ${b.createdDateKey}`
    )
]);
function onRestoreBackupPicked(_label: string, idx: number): void {
    if (idx <= 0) return;
    const picked = compatibleBackupsForSelected.value[idx - 1];
    if (picked) openRestorePanel(picked.id);
}

// Locations mapped to the shared per-kind shape so location sections + state
// helpers can be reused verbatim.
const kindedLocations = computed<KindedLocation[]>(() =>
    Object.values(locationsStore.locations).map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind
    }))
);

// One source of truth for the device filter modal — group, model, tag, and
// per-kind location, all reusing the shared section factories.
const deviceFilterSections = computed<FilterSection[]>(() => {
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
        namedSection('tag', 'Tags', 'fa-tag', tagItems, tagCounts),
        ...locationSectionsByKind(kindedLocations.value, locationCounts)
    ];
});

const deviceFilterState = computed<FilterState>(() => ({
    group: filterGroupIds.value.map(String),
    models: filterModels.value,
    tag: filterTagIds.value.map(String),
    ...locationStateByKind(filterLocationIds.value, kindedLocations.value)
}));

const hasDeviceFilters = computed(() => backupsActiveFilterCount.value > 0);
// Number shown on the filter chip so an active filter is obvious.
const backupsActiveFilterCount = computed(
    () =>
        filterGroupIds.value.length +
        filterModels.value.length +
        filterTagIds.value.length +
        filterLocationIds.value.length
);
const filteredDevices = computed(() => {
    let list = executableDevices.value;
    if (filterGroupIds.value.length > 0) {
        const ids = new Set<string>();
        for (const gid of filterGroupIds.value) {
            const g = groupsStore.groups[gid];
            if (g) for (const id of g.devices) ids.add(id);
        }
        list = list.filter((d) => ids.has(d.shellyID as string));
    }
    if (filterModels.value.length > 0) {
        const models = new Set(filterModels.value);
        list = list.filter((d) => models.has(d.info?.model || 'Unknown'));
    }
    if (filterTagIds.value.length > 0) {
        const tags = new Set(filterTagIds.value);
        const tagIx = tagsByDevice.value;
        list = list.filter((d) =>
            (tagIx[d.shellyID as string] ?? []).some((id) => tags.has(id))
        );
    }
    if (filterLocationIds.value.length > 0) {
        const locations = new Set(filterLocationIds.value);
        const locIx = locationsByDevice.value;
        list = list.filter((d) =>
            (locIx[d.shellyID as string] ?? []).some((id) => locations.has(id))
        );
    }
    const q = backupSearch.value.trim().toLowerCase();
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
function applyDeviceFilters(state: FilterState) {
    filterGroupIds.value = (state.group ?? []).map(Number);
    filterModels.value = state.models ?? [];
    filterTagIds.value = (state.tag ?? []).map(Number);
    filterLocationIds.value = Array.from(locationIdsFromState(state));
}

function toggleDevice(shellyID: string) {
    backupsStore.toggleDevice(shellyID);
}

function selectAll() {
    backupsStore.selectAll();
    toastStore.success(`Selected ${selectedDevices.value.size} devices`);
}

function clearSelection() {
    backupsStore.clearSelection();
}

// Drives the SelectionBar's "Select all / Deselect all" toggle.
const allSelected = computed(
    () =>
        executableDevices.value.length > 0 &&
        selectedCount.value >= executableDevices.value.length
);

// ========================================================================
// List view actions
// ========================================================================

async function refreshBackups() {
    await backupsStore.fetchBackups();
}

function exportBackups() {
    const headers = [
        'Name',
        'Device',
        'Model',
        'App',
        'Firmware',
        'Date',
        'Size (bytes)',
        'Contents'
    ];
    const rows = sortedBackups.value.map((b) => [
        b.name,
        b.deviceName || b.shellyID,
        b.model,
        b.app,
        b.fwVersion,
        b.createdDateKey,
        b.fileSize,
        b.contentsSummary || 'Base config'
    ]);
    downloadCsv('backups.csv', headers, rows);
}


// ========================================================================
// Backup creation
// ========================================================================

function startBackup() {
    confirmTitle.value = `Create backups for ${selectedCount.value} device(s)?`;
    confirmModalRef.value?.storeAction(() => {
        backupsStore.createBackups();
    });
}

async function retryFailed() {
    await backupsStore.retryFailed();
}

async function saveNamesAndFinish() {
    // Build a map of backupId → newName from the naming inputs
    const nameMap: Record<string, string> = {};
    for (const info of successDevices.value) {
        const name = backupNames[info.shellyID]?.trim();
        // Find the backup created for this device (most recent one)
        const backup = backupsList.value.find(
            (b) => b.shellyID === info.shellyID
        );
        if (backup && name && name !== backup.name) {
            nameMap[backup.id] = name;
        }
    }
    if (Object.keys(nameMap).length > 0) {
        await backupsStore.renameNewBackups(nameMap);
    }
    finishWithoutNaming();
}

function finishWithoutNaming() {
    backupsStore.finishNaming();
    for (const k of Object.keys(backupNames)) delete backupNames[k];
    actionPanel.value = null;
}

// ========================================================================
// Detail modal (click on backup card)
// ========================================================================

const detailBackup = ref<BackupMetadata | null>(null);
const detailModalVisible = computed(() => !!detailBackup.value);

function openDetailModal(backup: BackupMetadata) {
    detailBackup.value = backup;
}

function closeDetailModal() {
    detailBackup.value = null;
}

const DETAIL_ACTIONS: Record<string, (id: string) => void> = {
    restore: (id) => openRestorePanel(id),
    rename: (id) => openRenameModal(id),
    download: (id) => doDownload(id),
    delete: (id) => doDelete(id)
};

function detailAction(action: 'restore' | 'rename' | 'download' | 'delete') {
    if (!detailBackup.value) return;
    const id = detailBackup.value.id;
    closeDetailModal();
    DETAIL_ACTIONS[action]?.(id);
}

onMounted(() => {
    backupsStore.activateExecutableDevices();
});

onUnmounted(() => {
    backupsStore.deactivateExecutableDevices();
});

// ========================================================================
// Rename modal
// ========================================================================

const renameModalVisible = ref(false);
const renameBackupId = ref('');
const renameBackupName = ref('');

function openRenameModal(backupId: string) {
    const backup = backups.value[backupId];
    if (!backup) return;
    renameBackupId.value = backupId;
    renameBackupName.value = backup.name;
    renameModalVisible.value = true;
}

function closeRenameModal() {
    renameModalVisible.value = false;
    renameBackupId.value = '';
    renameBackupName.value = '';
}

function onRenameComplete() {
    // Rename modal handles its own toast messages; nothing else needed here.
}

// ========================================================================
// Download & Delete
// ========================================================================

async function doDownload(backupId: string) {
    try {
        await backupsStore.downloadBackupFile(backupId);
        toastStore.success('Backup download started');
    } catch (error: any) {
        toastStore.error(error?.message || 'Failed to download backup');
    }
}

function doDelete(backupId: string) {
    const backup = backups.value[backupId];
    if (!backup) return;

    confirmTitle.value = `Delete backup "${backup.name}"?`;
    confirmModalRef.value?.storeAction(async () => {
        try {
            await backupsStore.deleteBackup(backupId);
            toastStore.success('Backup deleted');
        } catch (error: any) {
            toastStore.error(error?.message || 'Failed to delete backup');
        }
    });
}
</script>

<style scoped>
.bk-action-shell {
    gap: var(--space-2);
}

.bk-action-header__left {
    flex: none;
}

/* ── Slider toggle — same as firmware ── */
/* Slider uses shared route-tabs from device-page.css */

/* ── Golden ratio split (same as firmware action panel) ── */
.bk-split {
    flex: 1;
    display: flex;
    overflow: hidden;
    gap: var(--space-3);
    padding: var(--space-3);
}
.bk-split__content {
    flex: 1.618;
    overflow-y: auto;
}
.bk-split__sidebar {
    flex: 1;
    overflow-y: auto;
}

/* Sidebar inside BasicBlock */
.bk-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-5); /* golden: 13 × 1.618 */
    padding: var(--space-3);
}
.bk-sidebar__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.bk-sidebar__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.bk-sidebar__title {
    margin-bottom: var(--space-2);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
}
.bk-sidebar__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
}
@media (max-width: 640px) {
    .bk-sidebar__grid {
        grid-template-columns: 1fr;
    }
}
/* ── Inline name input in table ── */
.bk-inline-name {
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--btn-radius);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: inherit;
}
.bk-inline-name:focus {
    outline: none;
    border-color: var(--color-border-focus);
}

/* ── Progress bar inside status cell ── */
.bk-progress-bar {
    width: 100%;
    height: var(--space-2);
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-top: var(--space-2);
}
.bk-progress-fill {
    height: 100%;
    width: 50%;
    background: var(--color-primary);
    border-radius: var(--radius-full);
    animation: bk-progress-pulse 1.5s ease-in-out infinite;
}
@keyframes bk-progress-pulse {
    0%, 100% { width: 30%; opacity: 1; }
    50% { width: 70%; opacity: 0.7; }
}

/* ── Online status dot ── */
.bk-online-dot {
    display: inline-block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-success);
    margin-right: var(--space-2);
}

/* Backup info card */
.bk-sidebar__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-lg);
}
.bk-sidebar__card-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
}
.bk-sidebar__card-label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.bk-sidebar__card-value {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    text-align: right;
}

.bk-sidebar__meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
}
/* Sidebar buttons: content-width, don't stretch */
.bk-sidebar :deep(.core-btn) {
    min-width: 0;
    align-self: flex-start;
}
.bk-sidebar__empty {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}
.bk-sidebar__warning {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-warning-text);
}

/* Status badges */
.bk-status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
}
.bk-status--success { color: var(--color-success-text); }
.bk-status--error { color: var(--color-danger-text); }
.bk-status--active { color: var(--color-text-secondary); }
.bk-status--waiting { color: var(--color-text-disabled); }

/* ── Backup filters ───────────────────────────────────────── */
.bk-filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.bk-filters__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-2);
}
.bk-filters__actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-2);
}

/* Responsive handled by shared device-page.css */
</style>
