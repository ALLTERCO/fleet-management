import {defineStore} from 'pinia';
import {computed, reactive, ref} from 'vue';
import {useDeviceSelection} from '@/composables/useDeviceSelection';
import {getDeviceName} from '@/helpers/device';
import {triggerDownload} from '@/helpers/download';
import {clearObject, sleep} from '@/helpers/objects';
import {trackInteraction} from '@/tools/observability';
import * as ws from '../tools/websocket';
import {useDevicesStore} from './devices';

export interface BackupMetadata {
    id: string;
    name: string;
    shellyID: string;
    model: string;
    app: string;
    fwVersion: string;
    createdAt: number;
    fileSize: number;
    contents: Record<string, boolean>;
    metadata: Record<string, any>;
}

export type BackupDeviceStatus =
    | 'idle'
    | 'creating'
    | 'rebooting'
    | 'downloading'
    | 'success'
    | 'failed';

export interface BackupDeviceInfo {
    shellyID: string;
    deviceName: string;
    model: string;
    status: BackupDeviceStatus;
    error?: string;
}

// Polling configuration
const REBOOT_POLL_INTERVAL = 5000; // 5 seconds
const REBOOT_TIMEOUT = 120_000; // 2 minutes
const BATCH_SIZE = 3;

export const useBackupsStore = defineStore('backups', () => {
    const devicesStore = useDevicesStore();

    // ========================================================================
    // State — Stored backups
    // ========================================================================

    const backups = reactive<Record<string, BackupMetadata>>({});
    const loading = ref(false);

    // ========================================================================
    // State — Backup creation wizard
    // ========================================================================

    // Device selection via shared composable (Sys.CreateBackup available on all Gen2+ devices)
    const selection = useDeviceSelection();
    const {
        selectedDevices,
        executableDevices,
        selectedCount,
        hasSelectedDevices,
        activate: activateExecutableDevices,
        deactivate: deactivateExecutableDevices,
        toggleDevice,
        selectGroup,
        selectAll,
        clearSelection
    } = selection;

    const backupProgress = reactive<Record<string, BackupDeviceInfo>>({});
    const currentStep = ref<'list' | 'select' | 'progress' | 'naming'>('list');
    const isCreating = ref(false);

    // ========================================================================
    // State — Restore
    // ========================================================================

    const restoreInProgress = ref(false);
    const restoreStatus = ref<{
        shellyID: string;
        status: string;
        error?: string;
    } | null>(null);

    // ========================================================================
    // Computed
    // ========================================================================

    const backupsList = computed(() =>
        Object.values(backups).sort((a, b) => b.createdAt - a.createdAt)
    );

    const progressList = computed(() => Object.values(backupProgress));

    const successDevices = computed(() =>
        progressList.value.filter((d) => d.status === 'success')
    );

    const failedDevices = computed(() =>
        progressList.value.filter((d) => d.status === 'failed')
    );

    const allComplete = computed(() => {
        if (!isCreating.value) return false;
        return progressList.value.every(
            (d) => d.status === 'success' || d.status === 'failed'
        );
    });

    // ========================================================================
    // Actions — Backup list management
    // ========================================================================

    async function fetchBackups() {
        loading.value = true;
        try {
            const result = await ws.sendRPC<BackupMetadata[]>(
                'FLEET_MANAGER',
                'Backup.List',
                {}
            );
            // Clear and repopulate
            clearObject(backups);
            if (Array.isArray(result)) {
                for (const backup of result) {
                    backups[backup.id] = backup;
                }
            }
        } catch (error) {
            console.error('Failed to fetch backups:', error);
        } finally {
            loading.value = false;
        }
    }

    async function renameBackup(id: string, name: string) {
        try {
            const result = await ws.sendRPC<BackupMetadata>(
                'FLEET_MANAGER',
                'Backup.Rename',
                {id, name}
            );
            if (result) {
                backups[id] = result;
            }
        } catch (error) {
            console.error('Failed to rename backup:', error);
            throw error;
        }
    }

    async function deleteBackup(id: string) {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Backup.Delete', {id});
            delete backups[id];
        } catch (error) {
            console.error('Failed to delete backup:', error);
            throw error;
        }
    }

    /** Query: fetch raw backup file data from the server (no side-effects). */
    async function fetchBackupFile(id: string) {
        return ws.sendRPC<{data: string; name: string; size: number}>(
            'FLEET_MANAGER',
            'Backup.GetFile',
            {id}
        );
    }

    /** Convert a base64 string to a Blob. */
    function base64ToBlob(base64: string, type: string): Blob {
        const byteChars = atob(base64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
        }
        return new Blob([new Uint8Array(byteNumbers)], {type});
    }

    async function downloadBackupFile(id: string) {
        try {
            const result = await fetchBackupFile(id);

            if (result?.data) {
                const blob = base64ToBlob(result.data, 'application/zip');
                triggerDownload(blob, result.name || 'backup.zip');
            }
        } catch (error) {
            console.error('Failed to download backup file:', error);
            throw error;
        }
    }

    // ========================================================================
    // Actions — Backup creation flow
    // ========================================================================

    function resetWizardState() {
        clearSelection();
        clearObject(backupProgress);
        isCreating.value = false;
    }

    function startCreateFlow() {
        resetWizardState();
        currentStep.value = 'select';
    }

    function cancelCreateFlow() {
        resetWizardState();
        currentStep.value = 'list';
    }

    async function createBackups() {
        trackInteraction('backups', 'create', `${selectedDevices.value.size} devices`);
        isCreating.value = true;
        currentStep.value = 'progress';

        // Initialize progress for each device
        for (const shellyID of selectedDevices.value) {
            const device = devicesStore.devices[shellyID];
            if (!device) continue;

            backupProgress[shellyID] = {
                shellyID,
                deviceName: getDeviceName(device.info, shellyID) || shellyID,
                model: device.info?.model || 'Unknown',
                status: 'idle'
            };
        }

        // Process devices in batches
        const shellyIDs = Array.from(selectedDevices.value);

        for (let i = 0; i < shellyIDs.length; i += BATCH_SIZE) {
            const batch = shellyIDs.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map((shellyID) => createSingleBackup(shellyID))
            );
        }

        // Auto-advance to naming step when all complete
        if (successDevices.value.length > 0) {
            currentStep.value = 'naming';
        }
    }

    async function createSingleBackup(shellyID: string) {
        if (!backupProgress[shellyID]) return;

        try {
            // Step 1: Trigger Sys.CreateBackup on device (causes reboot)
            backupProgress[shellyID].status = 'creating';
            try {
                await devicesStore.sendRPC(shellyID, 'Sys.CreateBackup', {});
            } catch {
                // Device may disconnect during reboot — that's expected
            }

            // Step 2: Wait for device to come back online with backup ready
            backupProgress[shellyID].status = 'rebooting';
            await waitForDeviceOnline(shellyID);

            // Step 3: Tell backend to download the backup from the device
            backupProgress[shellyID].status = 'downloading';
            const result = await ws.sendRPC<BackupMetadata>(
                'FLEET_MANAGER',
                'Backup.DownloadFromDevice',
                {shellyID}
            );

            // Store the new backup in our local state
            if (result) {
                backups[result.id] = result;
            }

            backupProgress[shellyID].status = 'success';
        } catch (error: any) {
            backupProgress[shellyID].status = 'failed';
            backupProgress[shellyID].error = error?.message || String(error);
        }
    }

    async function waitForDeviceOnline(shellyID: string): Promise<void> {
        const startTime = Date.now();

        while (Date.now() - startTime < REBOOT_TIMEOUT) {
            await sleep(REBOOT_POLL_INTERVAL);

            try {
                const response = await devicesStore.sendRPC(
                    shellyID,
                    'Sys.GetStatus',
                    {}
                );

                if (response?.backup?.created) {
                    return; // Backup is ready
                }
            } catch {
                // Device still rebooting
            }
        }

        throw new Error('Timeout waiting for device to come back online');
    }

    async function retryFailed() {
        const devicesToRetry = failedDevices.value.map((d) => d.shellyID);

        for (const shellyID of devicesToRetry) {
            if (backupProgress[shellyID]) {
                backupProgress[shellyID].status = 'idle';
                backupProgress[shellyID].error = undefined;
            }
        }

        currentStep.value = 'progress';

        for (let i = 0; i < devicesToRetry.length; i += BATCH_SIZE) {
            const batch = devicesToRetry.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map((shellyID) => createSingleBackup(shellyID))
            );
        }

        if (successDevices.value.length > 0) {
            currentStep.value = 'naming';
        }
    }

    // ========================================================================
    // Actions — Naming (step 3)
    // ========================================================================

    async function renameNewBackups(nameMap: Record<string, string>) {
        const promises: Promise<void>[] = [];

        for (const [backupId, newName] of Object.entries(nameMap)) {
            if (!newName || !backups[backupId]) continue;
            if (backups[backupId].name === newName) continue;

            promises.push(
                renameBackup(backupId, newName).catch((e) => {
                    console.error(`Failed to rename backup ${backupId}:`, e);
                })
            );
        }

        await Promise.all(promises);
        currentStep.value = 'list';
        isCreating.value = false;
    }

    function finishNaming() {
        currentStep.value = 'list';
        isCreating.value = false;
    }

    // ========================================================================
    // Actions — Restore
    // ========================================================================

    async function restoreBackup(
        backupId: string,
        targetShellyID: string,
        contentFilter?: Record<string, boolean>
    ) {
        trackInteraction('backups', 'restore', targetShellyID);
        restoreInProgress.value = true;
        restoreStatus.value = {
            shellyID: targetShellyID,
            status: 'restoring'
        };

        try {
            await ws.sendRPC('FLEET_MANAGER', 'Backup.RestoreToDevice', {
                id: backupId,
                shellyID: targetShellyID,
                restore: contentFilter
            });

            restoreStatus.value = {
                shellyID: targetShellyID,
                status: 'success'
            };
        } catch (error: any) {
            restoreStatus.value = {
                shellyID: targetShellyID,
                status: 'failed',
                error: error?.message || String(error)
            };
            throw error;
        } finally {
            restoreInProgress.value = false;
        }
    }

    function clearRestoreStatus() {
        restoreStatus.value = null;
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    function reset() {
        resetWizardState();
        currentStep.value = 'list';
        restoreInProgress.value = false;
        restoreStatus.value = null;
    }

    // Fetch backups on store creation
    fetchBackups();

    return {
        // State
        backups,
        loading,
        selectedDevices,
        backupProgress,
        currentStep,
        isCreating,
        restoreInProgress,
        restoreStatus,

        // Computed
        backupsList,
        selectedCount,
        hasSelectedDevices,
        executableDevices,
        activateExecutableDevices,
        deactivateExecutableDevices,
        progressList,
        successDevices,
        failedDevices,
        allComplete,

        // Actions — list
        fetchBackups,
        renameBackup,
        deleteBackup,
        downloadBackupFile,

        // Actions — device selection
        toggleDevice,
        selectGroup,
        selectAll,
        clearSelection,

        // Actions — creation flow
        startCreateFlow,
        cancelCreateFlow,
        createBackups,
        retryFailed,

        // Actions — naming
        renameNewBackups,
        finishNaming,

        // Actions — restore
        restoreBackup,
        clearRestoreStatus,

        // Actions — general
        reset
    };
});
