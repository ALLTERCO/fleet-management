<template>
    <div class="h-full flex flex-col gap-2">
        <!-- ================================================================ -->
        <!-- VIEW: Backup List (default) -->
        <!-- ================================================================ -->
        <template v-if="currentStep === 'list'">
            <BasicBlock bordered blurred padding="sm">
                <div class="flex flex-row items-center justify-between">
                    <div class="flex items-center gap-4">
                        <span class="font-bold text-lg"
                            >Device Backups</span
                        >
                        <span class="text-sm text-[var(--color-text-tertiary)]">
                            {{ backupsList.length }} backup{{
                                backupsList.length !== 1 ? "s" : ""
                            }}
                        </span>
                    </div>
                    <div class="flex items-center gap-2">
                        <Button
                            type="blue"
                            size="sm"
                            narrow
                            data-track="backups_refresh"
                            @click="refreshBackups"
                        >
                            <i class="fas fa-refresh mr-1"></i> Refresh
                        </Button>
                        <Button
                            type="green"
                            size="sm"
                            data-track="backups_create"
                            @click="startCreateFlow"
                        >
                            <i class="fas fa-plus mr-1"></i> Create New
                            Backup
                        </Button>
                    </div>
                </div>
            </BasicBlock>

            <div class="flex-1 overflow-auto">
                <!-- Loading State -->
                <div
                    v-if="loading"
                    class="widget-grid p-4"
                >
                    <Skeleton v-for="n in 6" :key="n" variant="card" />
                </div>

                <!-- Empty State -->
                <div
                    v-else-if="backupsList.length === 0"
                    class="flex flex-col items-center justify-center h-full gap-4"
                >
                    <i
                        class="fas fa-database text-5xl text-[var(--color-text-disabled)]"
                    ></i>
                    <span class="text-[var(--color-text-tertiary)] text-lg"
                        >No backups yet</span
                    >
                    <span class="text-[var(--color-text-disabled)] text-sm"
                        >Create your first backup to get
                        started</span
                    >
                    <Button type="green" @click="startCreateFlow">
                        <i class="fas fa-plus mr-1"></i> Create
                        Backup
                    </Button>
                </div>

                <!-- Backup Grid -->
                <div v-else class="widget-grid">
                    <BackupWidget
                        v-for="backup in backupsList"
                        :key="backup.id"
                        :backup="backup"
                        @select="openDetailModal(backup)"
                    />
                </div>
            </div>
        </template>

        <!-- ================================================================ -->
        <!-- VIEW: Device Selection (step 1 of creation) -->
        <!-- ================================================================ -->
        <template v-else-if="currentStep === 'select'">
            <BasicBlock bordered blurred padding="sm">
                <div class="flex flex-row items-center justify-between">
                    <div class="flex items-center gap-4">
                        <span class="font-bold text-lg"
                            >Create Backup</span
                        >
                        <div class="flex items-center gap-2">
                            <span
                                class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-[var(--color-primary)] text-[var(--color-text-primary)]"
                            >
                                <span
                                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[var(--color-primary)]"
                                    >1</span
                                >
                                Select
                            </span>
                            <span
                                class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]"
                            >
                                <span
                                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[var(--color-surface-4)]"
                                    >2</span
                                >
                                Backup
                            </span>
                            <span
                                class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]"
                            >
                                <span
                                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[var(--color-surface-4)]"
                                    >3</span
                                >
                                Name
                            </span>
                        </div>
                    </div>
                    <span class="text-sm text-[var(--color-text-tertiary)]">
                        {{ selectedCount }} device{{
                            selectedCount !== 1 ? "s" : ""
                        }}
                        selected
                    </span>
                </div>
            </BasicBlock>

            <BasicBlock
                bordered
                blurred
                padding="sm"
                class="relative z-[var(--z-raised)]"
            >
                <div class="flex flex-row gap-2 items-center justify-between">
                    <div class="flex flex-row gap-2 items-center">
                        <Dropdown
                            :options="groupOptions"
                            label="Add Group"
                            :inline-label="true"
                            @selected="handleGroupSelect"
                        />
                        <Button
                            type="blue"
                            size="sm"
                            narrow
                            @click="selectAll"
                        >
                            Select All
                        </Button>
                        <Button
                            type="red"
                            size="sm"
                            narrow
                            @click="clearSelection"
                        >
                            Clear
                        </Button>
                    </div>
                    <div class="flex gap-2">
                        <Button
                            type="blue-hollow"
                            size="sm"
                            @click="cancelCreateFlow"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="green"
                            size="sm"
                            :disabled="!hasSelectedDevices"
                            @click="startBackup"
                        >
                            Start Backup
                            <i class="fas fa-arrow-right ml-1"></i>
                        </Button>
                    </div>
                </div>
            </BasicBlock>

            <div class="flex-1 overflow-auto">
                <div
                    v-if="executableDevices.length === 0"
                    class="text-center py-8"
                >
                    <p class="text-[var(--color-text-tertiary)]">
                        No online devices available with execute
                        permission.
                    </p>
                </div>
                <div v-else class="widget-grid-devices">
                    <DeviceCard
                        v-for="device in executableDevices"
                        :key="device.shellyID"
                        :selected="isSelected(device.shellyID)"
                        :online="!!device.online"
                        :accent-color="device.online ? '#22D3A0' : '#F04E5E'"
                        @select="toggleDevice(device.shellyID)"
                    >
                        <template #upper-corner>
                            {{ device.info?.app || 'Device' }}
                        </template>
                        <template #image>
                            <img
                                :src="getLogo(device)"
                                alt="Device"
                                @error="handleImgError"
                            />
                        </template>
                        <template #name>
                            {{ getDeviceName(device.info, device.shellyID) }}
                        </template>
                        <template #description>
                            {{ device.info?.model || "Unknown" }} &middot; {{ device.info?.ver || "Unknown version" }}
                        </template>
                    </DeviceCard>
                </div>
            </div>
        </template>

        <!-- ================================================================ -->
        <!-- VIEW: Backup Progress (step 2 of creation) -->
        <!-- ================================================================ -->
        <template v-else-if="currentStep === 'progress'">
            <BasicBlock bordered blurred padding="sm">
                <div class="flex flex-row items-center justify-between">
                    <div class="flex items-center gap-4">
                        <span class="font-bold text-lg"
                            >Create Backup</span
                        >
                        <div class="flex items-center gap-2">
                            <span
                                class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-[var(--color-success-subtle)] text-[var(--color-success-text)]"
                            >
                                <span
                                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[var(--color-success)]"
                                >
                                    <i
                                        class="fas fa-check text-xs"
                                    ></i>
                                </span>
                                Select
                            </span>
                            <span
                                class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-[var(--color-primary)] text-[var(--color-text-primary)]"
                            >
                                <span
                                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[var(--color-primary)]"
                                    >2</span
                                >
                                Backup
                            </span>
                            <span
                                class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]"
                            >
                                <span
                                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[var(--color-surface-4)]"
                                    >3</span
                                >
                                Name
                            </span>
                        </div>
                    </div>
                    <span class="text-sm text-[var(--color-text-tertiary)]">
                        {{ successDevices.length }} done,
                        {{ failedDevices.length }} failed
                    </span>
                </div>
            </BasicBlock>

            <BasicBlock
                bordered
                blurred
                padding="sm"
                class="flex-1 overflow-hidden flex flex-col"
            >
                <div class="flex-1 overflow-auto">
                    <table class="w-full text-sm">
                        <thead class="sticky top-0 bg-[var(--table-header-bg)]">
                            <tr
                                class="text-left text-[var(--color-text-tertiary)] border-b border-[var(--table-border)]"
                            >
                                <th scope="col" class="py-2 px-2">Device</th>
                                <th scope="col" class="py-2 px-2">Model</th>
                                <th scope="col" class="py-2 px-2">Progress</th>
                                <th scope="col" class="py-2 px-2">Status</th>
                                <th scope="col" class="py-2 px-2">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="info in progressList"
                                :key="info.shellyID"
                                class="border-b border-[var(--table-border)]/50"
                            >
                                <td class="py-2 px-2 font-medium">
                                    {{ info.deviceName }}
                                </td>
                                <td
                                    class="py-2 px-2 text-xs text-[var(--color-text-tertiary)]"
                                >
                                    {{ info.model }}
                                </td>
                                <td class="py-2 px-2 w-1/4">
                                    <div
                                        class="w-full bg-[var(--color-surface-3)] rounded-full h-2"
                                    >
                                        <div
                                            class="h-2 rounded-full transition-all duration-300"
                                            :class="
                                                getProgressBarClass(
                                                    info.status,
                                                )
                                            "
                                        ></div>
                                    </div>
                                </td>
                                <td class="py-2 px-2">
                                    <span
                                        v-if="
                                            info.status === 'creating'
                                        "
                                        class="text-[var(--color-primary-text)] flex items-center gap-1"
                                    >
                                        <Spinner size="xs" />
                                        Creating...
                                    </span>
                                    <span
                                        v-else-if="
                                            info.status === 'rebooting'
                                        "
                                        class="text-[var(--color-warning-text)] flex items-center gap-1"
                                    >
                                        <Spinner size="xs" />
                                        Rebooting...
                                    </span>
                                    <span
                                        v-else-if="
                                            info.status ===
                                            'downloading'
                                        "
                                        class="text-[var(--color-primary-text)] flex items-center gap-1"
                                    >
                                        <Spinner size="xs" />
                                        Downloading...
                                    </span>
                                    <span
                                        v-else-if="
                                            info.status === 'success'
                                        "
                                        class="text-[var(--color-success-text)]"
                                    >
                                        <i
                                            class="fas fa-check mr-1"
                                        ></i>
                                        Done
                                    </span>
                                    <span
                                        v-else-if="
                                            info.status === 'failed'
                                        "
                                        class="text-[var(--color-danger-text)]"
                                        :title="info.error"
                                    >
                                        <i
                                            class="fas fa-times mr-1"
                                        ></i>
                                        {{ info.error || "Failed" }}
                                    </span>
                                    <span
                                        v-else
                                        class="text-[var(--color-text-disabled)]"
                                    >
                                        Waiting...
                                    </span>
                                </td>
                                <td class="py-2 px-2">
                                    <!-- No per-device retry in backup (would need to re-trigger entire flow) -->
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div
                    class="flex items-center justify-between pt-2 border-t border-[var(--table-border)]"
                >
                    <Button
                        v-if="
                            allComplete && failedDevices.length > 0
                        "
                        type="blue"
                        size="sm"
                        @click="retryFailed"
                    >
                        <i class="fas fa-redo mr-1"></i>
                        Retry Failed ({{ failedDevices.length }})
                    </Button>
                    <div v-else></div>
                    <Button
                        v-if="allComplete"
                        type="green"
                        size="sm"
                        @click="proceedToNaming"
                    >
                        <i class="fas fa-arrow-right mr-1"></i>
                        Name Backups
                    </Button>
                </div>
            </BasicBlock>
        </template>

        <!-- ================================================================ -->
        <!-- VIEW: Naming (step 3 of creation) -->
        <!-- ================================================================ -->
        <template v-else-if="currentStep === 'naming'">
            <BasicBlock bordered blurred padding="sm">
                <div class="flex flex-row items-center justify-between">
                    <div class="flex items-center gap-4">
                        <span class="font-bold text-lg"
                            >Create Backup</span
                        >
                        <div class="flex items-center gap-2">
                            <span
                                class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-[var(--color-success-subtle)] text-[var(--color-success-text)]"
                            >
                                <span
                                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[var(--color-success)]"
                                >
                                    <i
                                        class="fas fa-check text-xs"
                                    ></i>
                                </span>
                                Select
                            </span>
                            <span
                                class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-[var(--color-success-subtle)] text-[var(--color-success-text)]"
                            >
                                <span
                                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[var(--color-success)]"
                                >
                                    <i
                                        class="fas fa-check text-xs"
                                    ></i>
                                </span>
                                Backup
                            </span>
                            <span
                                class="flex items-center gap-1 px-3 py-1 rounded-lg text-sm bg-[var(--color-primary)] text-[var(--color-text-primary)]"
                            >
                                <span
                                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs bg-[var(--color-primary)]"
                                    >3</span
                                >
                                Name
                            </span>
                        </div>
                    </div>
                </div>
            </BasicBlock>

            <BasicBlock
                bordered
                blurred
                padding="sm"
                class="flex-1 overflow-hidden flex flex-col"
            >
                <div class="mb-2">
                    <span class="text-sm text-[var(--color-text-tertiary)]">
                        Customize backup names or keep the defaults.
                        If a backup with the same name already exists,
                        it will be overwritten.
                    </span>
                </div>

                <div class="flex-1 overflow-auto">
                    <table class="w-full text-sm">
                        <thead class="sticky top-0 bg-[var(--table-header-bg)]">
                            <tr
                                class="text-left text-[var(--color-text-tertiary)] border-b border-[var(--table-border)]"
                            >
                                <th scope="col" class="py-2 px-2">Device</th>
                                <th scope="col" class="py-2 px-2">Model</th>
                                <th scope="col" class="py-2 px-2">
                                    Backup Name
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="backup in newBackups"
                                :key="backup.id"
                                class="border-b border-[var(--table-border)]/50"
                            >
                                <td class="py-2 px-2 font-medium">
                                    {{ backup.shellyID }}
                                </td>
                                <td
                                    class="py-2 px-2 text-xs text-[var(--color-text-tertiary)]"
                                >
                                    {{ backup.model }}
                                </td>
                                <td class="py-2 px-2">
                                    <input
                                        v-model="
                                            nameInputs[backup.id]
                                        "
                                        type="text"
                                        class="w-full bg-[var(--color-surface-3)] border border-[var(--color-border-strong)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focus)] focus:outline-none"
                                        :placeholder="backup.name"
                                    />
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div
                    class="flex items-center justify-end gap-2 pt-2 border-t border-[var(--table-border)]"
                >
                    <Button
                        type="blue-hollow"
                        size="sm"
                        @click="finishWithoutRenaming"
                    >
                        Keep Defaults
                    </Button>
                    <Button
                        type="green"
                        size="sm"
                        @click="saveNames"
                    >
                        <i class="fas fa-save mr-1"></i> Save Names
                    </Button>
                </div>
            </BasicBlock>
        </template>

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
        <!-- Restore Modal (multi-device) -->
        <!-- ================================================================ -->
        <BackupRestoreModal
            :visible="restoreModalVisible"
            :backup="restoreBackupData"
            @close="closeRestoreModal"
            @restored="onRestoreComplete"
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
    </div>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {computed, onMounted, onUnmounted, reactive, ref} from 'vue';
import BackupDetailModal from '@/components/backups/BackupDetailModal.vue';
import BackupRenameModal from '@/components/backups/BackupRenameModal.vue';
import BackupRestoreModal from '@/components/backups/BackupRestoreModal.vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import Spinner from '@/components/core/Spinner.vue';
import BackupWidget from '@/components/widgets/BackupWidget.vue';
import DeviceCard from '@/components/widgets/WidgetsTemplates/DeviceWidget.vue';
import {getDeviceName, getLogo} from '@/helpers/device';
import {
    type BackupDeviceStatus,
    type BackupMetadata,
    useBackupsStore
} from '@/stores/backups';
import {useGroupsStore} from '@/stores/groups';
import {useToastStore} from '@/stores/toast';

const backupsStore = useBackupsStore();
const groupsStore = useGroupsStore();
const toastStore = useToastStore();

const {
    backups,
    loading,
    selectedDevices,
    currentStep,
    backupsList,
    selectedCount,
    hasSelectedDevices,
    executableDevices,
    progressList,
    successDevices,
    failedDevices,
    allComplete
} = storeToRefs(backupsStore);

// ========================================================================
// Group selection for device picker
// ========================================================================

const groupOptions = computed(() => {
    const groups = Object.values(groupsStore.groups);
    return ['-- Select Group --', ...groups.map((g) => g.name)];
});

function handleGroupSelect(groupName: string) {
    if (groupName === '-- Select Group --') return;

    const group = Object.values(groupsStore.groups).find(
        (g) => g.name === groupName
    );
    if (group) {
        backupsStore.selectGroup(group.id);
        toastStore.success(
            `Added ${group.devices.length} device(s) from "${group.name}"`
        );
    }
}

// ========================================================================
// Device selection helpers
// ========================================================================

function isSelected(shellyID: string) {
    return selectedDevices.value.has(shellyID);
}

function toggleDevice(shellyID: string) {
    backupsStore.toggleDevice(shellyID);
}

function selectAll() {
    backupsStore.selectAll();
}

function clearSelection() {
    backupsStore.clearSelection();
}

function handleImgError(e: Event) {
    const target = e.target as HTMLImageElement;
    target.src = '/shelly_logo_black.jpg';
}

// ========================================================================
// List view actions
// ========================================================================

async function refreshBackups() {
    await backupsStore.fetchBackups();
}

function startCreateFlow() {
    backupsStore.startCreateFlow();
}

function cancelCreateFlow() {
    backupsStore.cancelCreateFlow();
}

// ========================================================================
// Backup creation
// ========================================================================

async function startBackup() {
    const count = selectedCount.value;
    const confirmed = confirm(
        `You are about to create backups for ${count} device(s). Each device will reboot during the process. Continue?`
    );
    if (!confirmed) return;

    await backupsStore.createBackups();
}

async function retryFailed() {
    await backupsStore.retryFailed();
}

function proceedToNaming() {
    currentStep.value = 'naming';
    // Initialize name inputs with current names
    for (const backup of newBackups.value) {
        nameInputs[backup.id] = backup.name;
    }
}

// ========================================================================
// Progress bar helper
// ========================================================================

function getProgressBarClass(status: BackupDeviceStatus): string {
    switch (status) {
        case 'creating':
            return 'bg-[var(--color-primary)] animate-pulse w-1/4';
        case 'rebooting':
            return 'bg-[var(--color-warning)] animate-pulse w-1/2';
        case 'downloading':
            return 'bg-[var(--color-primary)] animate-pulse w-3/4';
        case 'success':
            return 'bg-[var(--color-success)] w-full';
        case 'failed':
            return 'bg-[var(--color-danger)] w-full';
        default:
            return 'bg-[var(--color-surface-4)] w-0';
    }
}

// ========================================================================
// Naming step
// ========================================================================

const nameInputs = reactive<Record<string, string>>({});

const newBackups = computed(() => {
    // Get backups that were just created (matching devices in progress with success)
    return backupsStore.successDevices
        .map((d) => {
            // Find the backup for this device (most recent by createdAt)
            return backupsStore.backupsList.find(
                (b) => b.shellyID === d.shellyID
            );
        })
        .filter(Boolean) as BackupMetadata[];
});

async function saveNames() {
    const nameMap: Record<string, string> = {};
    for (const backup of newBackups.value) {
        const customName = nameInputs[backup.id]?.trim();
        if (customName && customName !== backup.name) {
            nameMap[backup.id] = customName;
        }
    }

    if (Object.keys(nameMap).length > 0) {
        await backupsStore.renameNewBackups(nameMap);
        toastStore.success('Backup names saved');
    } else {
        backupsStore.finishNaming();
    }
}

function finishWithoutRenaming() {
    backupsStore.finishNaming();
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

function detailAction(action: 'restore' | 'rename' | 'download' | 'delete') {
    if (!detailBackup.value) return;
    const id = detailBackup.value.id;
    closeDetailModal();

    switch (action) {
        case 'restore':
            openRestoreModal(id);
            break;
        case 'rename':
            openRenameModal(id);
            break;
        case 'download':
            doDownload(id);
            break;
        case 'delete':
            doDelete(id);
            break;
    }
}

// ========================================================================
// Restore modal (multi-device)
// ========================================================================

const restoreModalVisible = ref(false);
const restoreBackupData = ref<BackupMetadata | null>(null);

onMounted(() => {
    backupsStore.activateExecutableDevices();
});

onUnmounted(() => {
    backupsStore.deactivateExecutableDevices();
});

function openRestoreModal(backupId: string) {
    const backup = backups.value[backupId];
    if (!backup) return;
    restoreBackupData.value = backup;
    restoreModalVisible.value = true;
}

function closeRestoreModal() {
    restoreModalVisible.value = false;
    restoreBackupData.value = null;
}

function onRestoreComplete() {
    // Restore modal handles its own toast messages; nothing else needed here.
}

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

async function doDelete(backupId: string) {
    const backup = backups.value[backupId];
    if (!backup) return;

    const confirmed = confirm(
        `Delete backup "${backup.name}"? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
        await backupsStore.deleteBackup(backupId);
        toastStore.success('Backup deleted');
    } catch (error: any) {
        toastStore.error(error?.message || 'Failed to delete backup');
    }
}
</script>
