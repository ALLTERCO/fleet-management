import {defineStore} from 'pinia';
import {computed, reactive, ref} from 'vue';
import {useDeviceSelection} from '@/composables/useDeviceSelection';
import {
    createEmptyBackupContents,
    filterEnabledBackupContents,
    summarizeBackupContents
} from '@/helpers/backupContents';
import {getDeviceName} from '@/helpers/device';
import {triggerDownload} from '@/helpers/download';
import {clearObject} from '@/helpers/objects';
import {trackInteraction} from '@/tools/observability';
import * as ws from '../tools/websocket';
import {useDevicesStore} from './devices';
import {useJobsStore} from './jobs';
import {createRefreshCoordinator} from './refreshCoordinator';

export interface BackupMetadata {
    id: string;
    name: string;
    shellyID: string;
    deviceName?: string;
    model: string;
    app: string;
    fwVersion: string;
    createdAt: number;
    createdDateKey?: string;
    fileSize: number;
    contents: Record<string, boolean>;
    contentsSummary?: string;
    groupIds?: number[];
    groupNames?: string[];
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

type BackupMutationResult = BackupMetadata & {
    replacedBackupId?: string;
};

type BackupJobResponse = {
    jobId: string;
};

function newBackupJobIdempotencyKey(): string {
    return (
        globalThis.crypto?.randomUUID?.() ??
        `backup-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
}

function normalizeBackupMetadata(backup: BackupMetadata): BackupMetadata {
    const createdAt =
        typeof backup.createdAt === 'number' ? backup.createdAt : Date.now();
    const metadata =
        backup.metadata && typeof backup.metadata === 'object'
            ? backup.metadata
            : {};
    const groupIds = Array.isArray(backup.groupIds)
        ? backup.groupIds
        : Array.isArray(metadata.group_ids)
          ? metadata.group_ids
                .map((value: unknown) => Number(value))
                .filter((value: number) => Number.isFinite(value))
          : [];
    const groupNames = Array.isArray(backup.groupNames)
        ? backup.groupNames
        : Array.isArray(metadata.group_names)
          ? metadata.group_names
                .map((value: unknown) => String(value))
                .filter(Boolean)
          : [];

    return {
        ...backup,
        deviceName:
            backup.deviceName ||
            (typeof metadata.device_name === 'string'
                ? metadata.device_name
                : backup.shellyID),
        createdDateKey:
            backup.createdDateKey ||
            new Date(createdAt).toISOString().slice(0, 10),
        contentsSummary:
            backup.contentsSummary ||
            (typeof metadata.actual_contents === 'string'
                ? metadata.actual_contents
                : summarizeBackupContents(backup.contents || {})),
        groupIds,
        groupNames
    };
}

export const useBackupsStore = defineStore('backups', () => {
    const devicesStore = useDevicesStore();

    // ========================================================================
    // State — Stored backups
    // ========================================================================

    const backups = reactive<Record<string, BackupMetadata>>({});
    const loading = ref(false);

    function applyBackupMutation(
        result: BackupMutationResult | null | undefined
    ) {
        if (!result) return;
        if (result.replacedBackupId) {
            delete backups[result.replacedBackupId];
        }
        backups[result.id] = normalizeBackupMetadata(result);
    }

    // ========================================================================
    // State — Backup creation wizard
    // ========================================================================

    // Only show devices that support backup (have Sys.CreateBackup in ListMethods)
    const selection = useDeviceSelection(
        (device) => device.capabilities?.backup === true
    );
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

    let activeBackupJobId: string | null = null;
    const jobsStore = useJobsStore();

    ws.onComponentStatus('backup', applyBackupStatusEvent);
    ws.onJobEvent(applyBackupJobEvent);

    // Content selection for backup creation (extras beyond base config)
    const backupContents = reactive(createEmptyBackupContents());

    function applyBackupStatusEvent(event: any): void {
        const p = event?.backupProgress;
        if (!p?.shellyID || !backupProgress[p.shellyID]) return;
        const info = backupProgress[p.shellyID];
        if (info.status === 'success' || info.status === 'failed') return;
        if (
            p.phase === 'creating' ||
            p.phase === 'rebooting' ||
            p.phase === 'downloading'
        ) {
            info.status = p.phase;
        }
    }

    function applyBackupJobEvent(event: ws.NamespacedEvent): void {
        if (event.method === 'Job.UnitUpdated') {
            applyBackupUnitEvent(event.params);
            return;
        }
        if (event.method === 'Job.Updated') {
            applyBackupTerminalEvent(event.params);
        }
    }

    function applyBackupUnitEvent(params: Record<string, unknown>): void {
        if (params.kind !== 'backup') return;
        if (params.jobId !== activeBackupJobId) return;
        const shellyID =
            typeof params.deviceId === 'string' ? params.deviceId : undefined;
        if (!shellyID || !backupProgress[shellyID]) return;
        if (params.status === 'done') {
            backupProgress[shellyID].status = 'success';
            applyBackupMutation(params.result as BackupMutationResult);
            return;
        }
        if (params.status === 'failed') {
            backupProgress[shellyID].status = 'failed';
            backupProgress[shellyID].error =
                typeof params.error === 'string'
                    ? params.error
                    : 'Backup failed';
        }
    }

    function applyBackupTerminalEvent(params: Record<string, unknown>): void {
        const job = params.job as
            | {id?: string; kind?: string; status?: string}
            | undefined;
        if (
            !job ||
            job.kind !== 'backup' ||
            job.id !== activeBackupJobId ||
            (job.status !== 'done' && job.status !== 'failed')
        ) {
            return;
        }
        activeBackupJobId = null;
        if (successDevices.value.length > 0) {
            currentStep.value = 'naming';
        }
    }

    // ========================================================================
    // State — Restore (per-device progress tracked by BackupRestoreModal)
    // ========================================================================

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

    const backupsRefresh = createRefreshCoordinator(refreshBackups);

    async function fetchBackups() {
        await backupsRefresh.request();
    }

    async function refreshBackups(): Promise<void> {
        loading.value = true;
        try {
            const result = await ws.sendRPC<{items: BackupMetadata[]}>(
                'FLEET_MANAGER',
                'Backup.List',
                {}
            );
            const items =
                result?.items ?? (Array.isArray(result) ? result : []);
            const next: Record<string, BackupMetadata> = {};
            for (const backup of items) {
                next[backup.id] = normalizeBackupMetadata(backup);
            }
            clearObject(backups);
            for (const id of Object.keys(next)) backups[id] = next[id];
        } catch (error) {
            console.error('Failed to fetch backups:', error);
        } finally {
            loading.value = false;
        }
    }

    async function renameBackup(id: string, name: string) {
        try {
            const result = await ws.sendRPC<BackupMutationResult>(
                'FLEET_MANAGER',
                'Backup.Rename',
                {id, name}
            );
            applyBackupMutation(result);
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
        activeBackupJobId = null;
        clearSelection();
        clearObject(backupProgress);
        isCreating.value = false;
        Object.assign(backupContents, createEmptyBackupContents());
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
        trackInteraction(
            'backups',
            'create',
            `${selectedDevices.value.size} devices`
        );
        isCreating.value = true;
        currentStep.value = 'progress';
        const shellyIDsForJob = Array.from(selectedDevices.value);

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

        await startBackupJob(shellyIDsForJob, 'Backup');
    }

    async function startBackupJob(shellyIDs: string[], labelPrefix: string) {
        if (shellyIDs.length === 0) return;
        for (const shellyID of shellyIDs) {
            if (!backupProgress[shellyID]) continue;
            backupProgress[shellyID].status = 'creating';
            backupProgress[shellyID].error = undefined;
        }
        try {
            const response = await ws.sendRPC<BackupJobResponse>(
                'FLEET_MANAGER',
                'Backup.StartDownloadJob',
                {
                    shellyIDs,
                    contents: {...backupContents},
                    idempotencyKey: newBackupJobIdempotencyKey()
                }
            );
            activeBackupJobId = response.jobId;
            jobsStore.track({
                jobId: response.jobId,
                kind: 'backup',
                label: `${labelPrefix} — ${shellyIDs.length} device${shellyIDs.length === 1 ? '' : 's'}`,
                total: shellyIDs.length,
                status: 'queued',
                metadata: {mode: 'create'}
            });
        } catch (error: any) {
            const message = error?.message || String(error);
            for (const shellyID of shellyIDs) {
                if (!backupProgress[shellyID]) continue;
                backupProgress[shellyID].status = 'failed';
                backupProgress[shellyID].error = message;
            }
            throw error;
        }
    }

    async function retryFailed() {
        const devicesToRetry = failedDevices.value.map((d) => d.shellyID);

        // Reset wizard state for retry: mark as active creation
        isCreating.value = true;

        for (const shellyID of devicesToRetry) {
            if (backupProgress[shellyID]) {
                backupProgress[shellyID].status = 'idle';
                backupProgress[shellyID].error = undefined;
            }
        }

        currentStep.value = 'progress';
        await startBackupJob(devicesToRetry, 'Backup retry');
    }

    // ========================================================================
    // Actions — Naming (step 3)
    // ========================================================================

    async function renameNewBackups(nameMap: Record<string, string>) {
        const entries = Object.entries(nameMap).filter(
            ([backupId, newName]) =>
                newName &&
                backups[backupId] &&
                backups[backupId].name !== newName
        );

        const RENAME_BATCH_SIZE = 5;
        for (let i = 0; i < entries.length; i += RENAME_BATCH_SIZE) {
            const batch = entries.slice(i, i + RENAME_BATCH_SIZE);
            await Promise.all(
                batch.map(([backupId, newName]) =>
                    renameBackup(backupId, newName).catch((e) => {
                        console.error(
                            `Failed to rename backup ${backupId}:`,
                            e
                        );
                    })
                )
            );
        }

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
    ): Promise<BackupJobResponse> {
        trackInteraction('backups', 'restore', targetShellyID);

        const response = await ws.sendRPC<BackupJobResponse>(
            'FLEET_MANAGER',
            'Backup.StartRestoreJob',
            {
                id: backupId,
                shellyID: targetShellyID,
                restore: filterEnabledBackupContents(contentFilter),
                idempotencyKey: newBackupJobIdempotencyKey()
            }
        );
        jobsStore.track({
            jobId: response.jobId,
            kind: 'backup',
            label: `Restore backup — ${targetShellyID}`,
            total: 1,
            status: 'queued',
            metadata: {
                mode: 'restore',
                backupId,
                deviceIds: [targetShellyID]
            }
        });
        return response;
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    function reset() {
        resetWizardState();
        currentStep.value = 'list';
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
        backupContents,

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

        // Actions — general
        reset
    };
});
