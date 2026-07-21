import type {FirmwareCheckForUpdateBulkResponse} from '@api/firmware';
import {defineStore} from 'pinia';
import {computed, reactive, ref} from 'vue';
import {useDeviceSelection} from '@/composables/useDeviceSelection';
import {getDeviceName} from '@/helpers/device';
import {toastRpcError} from '@/helpers/domainErrors';
import {clearObject} from '@/helpers/objects';
import {trackInteraction} from '@/tools/observability';
import * as ws from '../tools/websocket';
import {JOB_EVENT} from '../tools/wsEvents';
import {useDevicesStore} from './devices';
import {useJobsStore} from './jobs';
import {createStaleGuard} from './staleGuard';
import {useToastStore} from './toast';

export interface FirmwareVersion {
    version: string;
    build_id?: string;
}

export type AutoUpdateMode = 'off' | 'stable' | 'beta';

type UpdateRequest =
    | {type: 'channel'; value: 'stable' | 'beta'}
    | {type: 'url'; value: string; targetBuildIdHint?: string};

export type UpdatePhase =
    | 'idle'
    | 'downloading'
    | 'rebooting'
    | 'verifying'
    | 'success'
    | 'failed';

export interface FirmwareDeviceInfo {
    shellyID: string;
    deviceName: string;
    currentVersion: string;
    currentFwId?: string;
    autoUpdateMode: AutoUpdateMode;
    availableStable?: FirmwareVersion;
    availableBeta?: FirmwareVersion;
    checkStatus: 'pending' | 'checking' | 'checked' | 'error';
    updateStatus: UpdatePhase;
    progressPercent: number;
    previousVersion?: string;
    previousFwId?: string;
    error?: string;
    resultMessage?: string;
    sawOtaSuccess?: boolean;
}

// Devices per Firmware.CheckForUpdateBulk call. Chunked so each call returns
// under the WS timeout and one slow chunk can't fail the whole check.
const FIRMWARE_CHECK_BULK_CHUNK = 150;
const FIRMWARE_CHECK_BULK_TIMEOUT_MS = 60_000;
const FIRMWARE_UPDATE_SESSION_KEY = 'fm:firmware-update-session';
const FIRMWARE_UPDATE_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

type PersistedFirmwareUpdateSession = {
    version: 1;
    updatedAt: number;
    activeJobId: string | null;
    currentUpdateRequest: UpdateRequest | null;
    committedDeviceIds: string[];
    firmwareInfo: FirmwareDeviceInfo[];
};

function getBrowserStorage(kind: 'local' | 'session'): Storage | undefined {
    try {
        return kind === 'local'
            ? globalThis.localStorage
            : globalThis.sessionStorage;
    } catch {
        return undefined;
    }
}

function isActiveUpdatePhase(phase?: UpdatePhase): boolean {
    return (
        phase === 'downloading' ||
        phase === 'rebooting' ||
        phase === 'verifying'
    );
}

function sessionHasActiveUpdates(
    session: Pick<PersistedFirmwareUpdateSession, 'firmwareInfo'>
): boolean {
    return session.firmwareInfo.some((info) =>
        isActiveUpdatePhase(info.updateStatus)
    );
}

function parsePersistedUpdateSession(
    raw: string | null
): PersistedFirmwareUpdateSession | null {
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (parsed?.version !== 1) return null;
        if (
            typeof parsed.updatedAt !== 'number' ||
            !Number.isFinite(parsed.updatedAt)
        ) {
            return null;
        }
        if (
            Date.now() - parsed.updatedAt >
            FIRMWARE_UPDATE_SESSION_MAX_AGE_MS
        ) {
            return null;
        }
        if (!Array.isArray(parsed.committedDeviceIds)) return null;
        if (!Array.isArray(parsed.firmwareInfo)) return null;

        return {
            version: 1,
            updatedAt: parsed.updatedAt,
            currentUpdateRequest:
                parsed.currentUpdateRequest &&
                typeof parsed.currentUpdateRequest === 'object'
                    ? parsed.currentUpdateRequest
                    : null,
            committedDeviceIds: parsed.committedDeviceIds.filter(
                (value: unknown): value is string =>
                    typeof value === 'string' && value.length > 0
            ),
            activeJobId:
                typeof parsed.activeJobId === 'string' &&
                parsed.activeJobId.length > 0
                    ? parsed.activeJobId
                    : null,
            firmwareInfo: parsed.firmwareInfo.filter(
                (value: unknown): value is FirmwareDeviceInfo =>
                    typeof value === 'object' &&
                    value !== null &&
                    typeof (value as FirmwareDeviceInfo).shellyID === 'string'
            )
        };
    } catch {
        return null;
    }
}

export const useFirmwareStore = defineStore('firmware', () => {
    const devicesStore = useDevicesStore();
    const toast = useToastStore();

    // Only show devices that support high-level OTA.
    const selection = useDeviceSelection(
        (device) => device.capabilities?.firmwareUpdate === true
    );
    const {
        selectedDevices,
        executableDevices,
        selectedCount,
        hasSelectedDevices,
        activate: activateExecutableDevices,
        deactivate: deactivateExecutableDevices,
        toggleDevice,
        selectDevice,
        deselectDevice,
        selectGroup,
        selectAll,
        clearSelection
    } = selection;

    // State
    const firmwareInfo = reactive<Record<string, FirmwareDeviceInfo>>({});
    const jobsStore = useJobsStore();
    let activeFirmwareJobId: string | null = null;

    ws.onJobEvent(applyFirmwareJobEvent);

    const currentStep = ref<1 | 2>(1);
    const isUpdating = ref(false);
    const isCheckingFirmware = ref(false);
    const autoUpdateModes = ref<Record<string, AutoUpdateMode>>({});
    // Guards autoUpdateModes: user toggles bump, a stale bulk fetch discards itself.
    const autoUpdateGuard = createStaleGuard();
    const currentUpdateRequest = ref<UpdateRequest | null>(null);
    // Snapshot of device IDs committed to an update — survives device
    // going offline during reboot so progress rows don't disappear.
    const committedDeviceIds = ref<string[]>([]);
    let cleanupUpdateSessionSync: (() => void) | null = null;
    let lastPersistedUpdateSessionAt = 0;

    // Computed
    const selectedDevicesList = computed(() =>
        Array.from(selectedDevices.value)
    );

    const firmwareInfoList = computed(() => {
        // During/after an update, use the committed snapshot so devices
        // that go offline during reboot still appear in the table.
        if (committedDeviceIds.value.length > 0) {
            return committedDeviceIds.value
                .map((id) => firmwareInfo[id])
                .filter(Boolean);
        }
        // Show ALL executable devices (merged table view)
        return executableDevices.value
            .map((d) => firmwareInfo[d.shellyID as string])
            .filter(Boolean);
    });

    const devicesWithUpdates = computed(() => {
        return firmwareInfoList.value.filter(
            (info) => info.availableStable || info.availableBeta
        );
    });

    const failedDevices = computed(() => {
        return firmwareInfoList.value.filter(
            (info) => info.updateStatus === 'failed'
        );
    });

    const successDevices = computed(() => {
        return firmwareInfoList.value.filter(
            (info) => info.updateStatus === 'success'
        );
    });

    const updatingDevices = computed(() => {
        return firmwareInfoList.value.filter((info) =>
            isActiveUpdatePhase(info.updateStatus)
        );
    });

    // Actions
    function goToStep(step: 1 | 2) {
        if (step !== 2 && !hasActiveDevices()) {
            committedDeviceIds.value = [];
            currentUpdateRequest.value = null;
            clearPersistedUpdateSession();
        }
        currentStep.value = step;
    }

    function reset() {
        stopUpdateSessionSync();
        clearSelection();
        clearObject(firmwareInfo);
        committedDeviceIds.value = [];
        activeFirmwareJobId = null;
        currentStep.value = 1;
        isUpdating.value = false;
        isCheckingFirmware.value = false;
        currentUpdateRequest.value = null;
        clearPersistedUpdateSession();
    }

    function buildPersistedUpdateSession(): PersistedFirmwareUpdateSession | null {
        const infoItems = committedDeviceIds.value
            .map((shellyID) => firmwareInfo[shellyID])
            .filter(
                (info): info is FirmwareDeviceInfo =>
                    Boolean(info) &&
                    (info.updateStatus !== 'idle' ||
                        info.progressPercent > 0 ||
                        Boolean(info.error) ||
                        Boolean(info.resultMessage))
            )
            .map((info) => ({...info}));

        const hasActiveUpdates = infoItems.some((info) =>
            isActiveUpdatePhase(info.updateStatus)
        );

        if (committedDeviceIds.value.length === 0 && infoItems.length === 0) {
            return null;
        }

        if (infoItems.length === 0) return null;
        if (!hasActiveUpdates) return null;

        return {
            version: 1,
            updatedAt: Date.now(),
            activeJobId: activeFirmwareJobId,
            currentUpdateRequest: currentUpdateRequest.value,
            committedDeviceIds: [...committedDeviceIds.value],
            firmwareInfo: infoItems
        };
    }

    function clearPersistedUpdateSession() {
        getBrowserStorage('local')?.removeItem(FIRMWARE_UPDATE_SESSION_KEY);
        lastPersistedUpdateSessionAt = 0;
    }

    function persistUpdateSession() {
        const storage = getBrowserStorage('local');
        if (!storage) return;

        const nextSession = buildPersistedUpdateSession();
        if (!nextSession) {
            clearPersistedUpdateSession();
            return;
        }

        lastPersistedUpdateSessionAt = nextSession.updatedAt;
        storage.setItem(
            FIRMWARE_UPDATE_SESSION_KEY,
            JSON.stringify(nextSession)
        );
    }

    function applyPersistedUpdateSession(
        session: PersistedFirmwareUpdateSession
    ) {
        lastPersistedUpdateSessionAt = session.updatedAt;
        activeFirmwareJobId = session.activeJobId;
        currentUpdateRequest.value = session.currentUpdateRequest;
        committedDeviceIds.value = [...session.committedDeviceIds];

        for (const persisted of session.firmwareInfo) {
            const device = devicesStore.devices[persisted.shellyID];
            const existing = firmwareInfo[persisted.shellyID];
            firmwareInfo[persisted.shellyID] = {
                ...persisted,
                deviceName:
                    persisted.deviceName ||
                    existing?.deviceName ||
                    getDeviceName(device?.info, persisted.shellyID) ||
                    persisted.shellyID,
                currentVersion:
                    persisted.currentVersion ||
                    existing?.currentVersion ||
                    device?.info?.ver ||
                    'Unknown',
                currentFwId:
                    persisted.currentFwId ??
                    existing?.currentFwId ??
                    (typeof device?.info?.fw_id === 'string'
                        ? device.info.fw_id
                        : undefined),
                autoUpdateMode:
                    autoUpdateModes.value[persisted.shellyID] ??
                    persisted.autoUpdateMode ??
                    existing?.autoUpdateMode ??
                    'off',
                checkStatus:
                    persisted.checkStatus ?? existing?.checkStatus ?? 'pending',
                progressPercent: persisted.progressPercent ?? 0,
                updateStatus: persisted.updateStatus ?? 'idle',
                sawOtaSuccess: persisted.sawOtaSuccess ?? false
            };
        }

        isUpdating.value = session.firmwareInfo.some((info) =>
            isActiveUpdatePhase(info.updateStatus)
        );
    }

    function restorePersistedUpdateSession() {
        const session = parsePersistedUpdateSession(
            getBrowserStorage('local')?.getItem(FIRMWARE_UPDATE_SESSION_KEY) ??
                null
        );

        if (!session) {
            clearPersistedUpdateSession();
            return;
        }

        if (!sessionHasActiveUpdates(session)) {
            currentUpdateRequest.value = null;
            committedDeviceIds.value = [];
            activeFirmwareJobId = null;
            clearPersistedUpdateSession();
            return;
        }

        applyPersistedUpdateSession(session);
    }

    function handleUpdateSessionStorage(event: StorageEvent) {
        if (event.key !== FIRMWARE_UPDATE_SESSION_KEY) return;

        const session = parsePersistedUpdateSession(event.newValue);
        if (!session) {
            return;
        }
        if (session.updatedAt <= lastPersistedUpdateSessionAt) {
            return;
        }

        lastPersistedUpdateSessionAt = session.updatedAt;
        if (!sessionHasActiveUpdates(session)) {
            return;
        }

        applyPersistedUpdateSession(session);
    }

    function startUpdateSessionSync() {
        restorePersistedUpdateSession();
        if (cleanupUpdateSessionSync || typeof window === 'undefined') return;

        const handler = (event: StorageEvent) => {
            handleUpdateSessionStorage(event);
        };

        window.addEventListener('storage', handler);
        cleanupUpdateSessionSync = () => {
            window.removeEventListener('storage', handler);
        };
    }

    function stopUpdateSessionSync() {
        if (cleanupUpdateSessionSync) {
            cleanupUpdateSessionSync();
            cleanupUpdateSessionSync = null;
        }
    }

    // One home for the firmware-info row so the selected and all-devices
    // initializers cannot drift.
    function buildFirmwareInfo(
        device: any,
        shellyID: string
    ): FirmwareDeviceInfo {
        const cachedUpdates = readCachedAvailableUpdates(device);
        return {
            shellyID,
            deviceName: getDeviceName(device.info, shellyID) || shellyID,
            currentVersion: device.info?.ver || 'Unknown',
            currentFwId:
                typeof device.info?.fw_id === 'string'
                    ? device.info.fw_id
                    : undefined,
            autoUpdateMode: autoUpdateModes.value[shellyID] ?? 'off',
            checkStatus:
                device.status?.sys?.available_updates != null
                    ? 'checked'
                    : 'pending',
            updateStatus: 'idle',
            progressPercent: 0,
            availableStable: cachedUpdates.stable,
            availableBeta: cachedUpdates.beta,
            sawOtaSuccess: false
        };
    }

    // Initialize firmware info for selected devices
    function initializeFirmwareInfo() {
        for (const shellyID of selectedDevices.value) {
            const device = devicesStore.devices[shellyID];
            if (!device) continue;
            firmwareInfo[shellyID] = buildFirmwareInfo(device, shellyID);
        }
    }

    // Initialize firmware info for ALL executable devices (merged table view)
    function initializeAllFirmwareInfo() {
        const devices = executableDevices.value;
        for (const device of devices) {
            const shellyID = device.shellyID as string;
            if (firmwareInfo[shellyID]) continue;
            firmwareInfo[shellyID] = buildFirmwareInfo(device, shellyID);
        }
    }

    function readCachedAvailableUpdates(device: any): {
        stable?: FirmwareVersion;
        beta?: FirmwareVersion;
    } {
        const updates = device?.status?.sys?.available_updates;
        if (!updates || typeof updates !== 'object') {
            return {};
        }

        return {
            stable: updates.stable?.version
                ? {
                      version: updates.stable.version,
                      build_id: updates.stable.build_id
                  }
                : undefined,
            beta: updates.beta?.version
                ? {
                      version: updates.beta.version,
                      build_id: updates.beta.build_id
                  }
                : undefined
        };
    }

    function applyCachedAvailableUpdates(
        shellyID: string,
        options?: {markChecked?: boolean}
    ) {
        const info = firmwareInfo[shellyID];
        const device = devicesStore.devices[shellyID];
        if (!info || !device) return;

        const cached = readCachedAvailableUpdates(device);
        if (cached.stable) {
            info.availableStable = cached.stable;
        } else {
            info.availableStable = undefined;
        }

        if (cached.beta) {
            info.availableBeta = cached.beta;
        } else {
            info.availableBeta = undefined;
        }

        if (
            options?.markChecked !== false &&
            device.status?.sys?.available_updates != null
        ) {
            info.checkStatus = 'checked';
        }
    }

    function clearCachedAvailableUpdates(shellyID: string) {
        const device = devicesStore.devices[shellyID];
        if (!device?.status?.sys) return;
        device.status.sys.available_updates = undefined;
    }

    // Check firmware for all selected devices
    async function checkFirmwareForSelected(force = false) {
        trackInteraction(
            'firmware',
            'check',
            `${selectedDevices.value.size} devices${force ? ' forced' : ''}`
        );
        isCheckingFirmware.value = true;
        initializeFirmwareInfo();

        const shellyIDs = Array.from(selectedDevices.value).filter(
            (shellyID) => {
                if (force) return true;
                const device = devicesStore.devices[shellyID];
                return device?.status?.sys?.available_updates == null;
            }
        );

        await checkFirmwareBulk(shellyIDs);
        isCheckingFirmware.value = false;
    }

    // Check firmware for ALL executable devices (merged table view)
    async function checkFirmwareForAll(force = false) {
        initializeAllFirmwareInfo();
        isCheckingFirmware.value = true;

        const shellyIDs = executableDevices.value
            .map((d) => d.shellyID as string)
            .filter((shellyID) => {
                if (force) return true;
                return firmwareInfo[shellyID]?.checkStatus !== 'checked';
            });

        await checkFirmwareBulk(shellyIDs);
        isCheckingFirmware.value = false;
    }

    function isValidShellyID(shellyID: string): boolean {
        return typeof shellyID === 'string' && shellyID.length > 0;
    }

    // Check many devices in a few chunked FLEET_MANAGER RPCs instead of one per
    // device. Shelly.CheckForUpdate is a per-device API we proxy, so the backend
    // still loops device-by-device; the win is fewer browser round-trips. The
    // fleet is chunked so each call returns under the WS timeout and one slow
    // chunk never sinks the rest (partial progress survives). Devices with no
    // device-side check resolve from cache (no RPC), same as the single path.
    async function checkFirmwareBulk(shellyIDs: string[]) {
        const capable: string[] = [];
        for (const shellyID of shellyIDs) {
            const info = firmwareInfo[shellyID];
            if (!info) continue;
            applyCachedAvailableUpdates(shellyID);
            info.error = undefined;
            if (devicesStore.devices[shellyID]?.capabilities?.firmwareCheck) {
                info.checkStatus = 'checking';
                capable.push(shellyID);
            } else {
                info.checkStatus = 'checked';
            }
        }

        for (let i = 0; i < capable.length; i += FIRMWARE_CHECK_BULK_CHUNK) {
            const slice = capable.slice(i, i + FIRMWARE_CHECK_BULK_CHUNK);
            try {
                const resp =
                    await ws.sendRPC<FirmwareCheckForUpdateBulkResponse>(
                        'FLEET_MANAGER',
                        'Firmware.CheckForUpdateBulk',
                        {shellyIDs: slice},
                        {timeoutMs: FIRMWARE_CHECK_BULK_TIMEOUT_MS}
                    );
                const byId = new Map(resp.items.map((r) => [r.shellyID, r]));
                for (const shellyID of slice) {
                    const info = firmwareInfo[shellyID];
                    if (!info) continue;
                    const r = byId.get(shellyID);
                    if (r?.status === 'checked') {
                        info.checkStatus = 'checked';
                        info.availableStable = r.stable
                            ? {
                                  version: r.stable.version,
                                  build_id: r.stable.build_id
                              }
                            : undefined;
                        info.availableBeta = r.beta
                            ? {
                                  version: r.beta.version,
                                  build_id: r.beta.build_id
                              }
                            : undefined;
                    } else {
                        // offline / error / missing — keep cache, not checked.
                        info.checkStatus = 'error';
                        info.error =
                            r?.status === 'offline'
                                ? 'Device offline'
                                : (r?.error ?? 'Firmware check failed');
                        applyCachedAvailableUpdates(shellyID, {
                            markChecked: false
                        });
                    }
                }
            } catch (error: any) {
                for (const shellyID of slice) {
                    const info = firmwareInfo[shellyID];
                    if (!info) continue;
                    info.checkStatus = 'error';
                    info.error = error?.message || String(error);
                    applyCachedAvailableUpdates(shellyID, {markChecked: false});
                }
            }
        }
    }

    function requireCurrentUpdateRequest(): UpdateRequest {
        if (!currentUpdateRequest.value) {
            throw new Error(
                'Cannot retry because the original update request is no longer available. Start a new update instead.'
            );
        }
        return currentUpdateRequest.value;
    }

    // Update selected devices to a specific channel
    async function updateSelected(channel: 'stable' | 'beta') {
        await runSelectedUpdates(
            {type: 'channel', value: channel},
            Array.from(selectedDevices.value)
        );
    }

    async function updateSelectedByUrl(
        url: string,
        targetBuildIdHint?: string
    ) {
        await runSelectedUpdates(
            {
                type: 'url',
                value: url,
                targetBuildIdHint
            },
            Array.from(selectedDevices.value)
        );
    }

    async function updateDeviceIdsByUrl(
        shellyIDs: string[],
        url: string,
        targetBuildIdHint?: string
    ) {
        await runSelectedUpdates(
            {
                type: 'url',
                value: url,
                targetBuildIdHint
            },
            shellyIDs
        );
    }

    function createFirmwareIdempotencyKey(request: UpdateRequest): string {
        const randomPart =
            globalThis.crypto?.randomUUID?.() ||
            `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return `firmware:${request.type}:${randomPart}`;
    }

    function applyFirmwareJobEvent(event: ws.NamespacedEvent): void {
        if (event.method === JOB_EVENT.UNIT_UPDATED) {
            applyFirmwareUnitEvent(event.params);
            return;
        }
        if (event.method === JOB_EVENT.UPDATED) {
            applyFirmwareTerminalEvent(event.params);
        }
    }

    function applyFirmwareUnitEvent(params: Record<string, unknown>): void {
        if (params.kind !== 'firmware') return;
        if (params.jobId !== activeFirmwareJobId) return;
        const shellyID =
            typeof params.deviceId === 'string' ? params.deviceId : undefined;
        if (!shellyID || !firmwareInfo[shellyID]) return;
        const info = firmwareInfo[shellyID];

        if (params.status === 'running') {
            info.updateStatus =
                params.phase === 'rebooting' ? 'rebooting' : 'downloading';
            if (typeof params.progressPercent === 'number') {
                info.progressPercent = params.progressPercent;
            }
            persistUpdateSession();
            return;
        }

        if (params.status === 'done') {
            applyFirmwareSuccess(info, params.result);
            persistUpdateSession();
            return;
        }

        if (params.status === 'failed') {
            info.updateStatus = 'failed';
            info.error =
                typeof params.error === 'string'
                    ? params.error
                    : 'Firmware update failed';
            persistUpdateSession();
        }
    }

    function applyFirmwareSuccess(info: FirmwareDeviceInfo, result: unknown) {
        const payload =
            result && typeof result === 'object'
                ? (result as Record<string, unknown>)
                : {};
        const finalVersion =
            typeof payload.finalVersion === 'string'
                ? payload.finalVersion
                : undefined;
        const finalFwId =
            typeof payload.finalFwId === 'string'
                ? payload.finalFwId
                : undefined;
        info.updateStatus = 'success';
        info.progressPercent = 100;
        info.currentVersion = finalVersion ?? info.currentVersion;
        info.currentFwId = finalFwId ?? info.currentFwId;
        info.resultMessage =
            typeof payload.message === 'string' ? payload.message : undefined;
        const device = devicesStore.devices[info.shellyID];
        if (device?.info) {
            if (finalVersion) device.info.ver = finalVersion;
            if (finalFwId) device.info.fw_id = finalFwId;
        }
        clearCachedAvailableUpdates(info.shellyID);
        info.availableStable = undefined;
        info.availableBeta = undefined;
    }

    function applyFirmwareTerminalEvent(params: Record<string, unknown>): void {
        const job = params.job as
            | {id?: string; kind?: string; status?: string}
            | undefined;
        if (
            !job ||
            job.kind !== 'firmware' ||
            job.id !== activeFirmwareJobId ||
            (job.status !== 'done' && job.status !== 'failed')
        ) {
            return;
        }
        finalizeIfComplete();
    }

    async function runSelectedUpdates(
        request: UpdateRequest,
        shellyIDs: string[]
    ) {
        if (hasActiveDevices()) {
            throw new Error('A firmware update is already in progress');
        }

        trackInteraction(
            'firmware',
            'update',
            `${request.type}:${request.value} ${shellyIDs.length} devices`
        );

        const devicesToUpdate: string[] = [];

        for (const shellyID of shellyIDs) {
            if (!firmwareInfo[shellyID]) continue;

            firmwareInfo[shellyID].error = undefined;
            firmwareInfo[shellyID].resultMessage = undefined;
            firmwareInfo[shellyID].sawOtaSuccess = false;

            if (
                request.type === 'channel' &&
                !(request.value === 'stable'
                    ? firmwareInfo[shellyID].availableStable
                    : firmwareInfo[shellyID].availableBeta)
            ) {
                firmwareInfo[shellyID].updateStatus = 'idle';
                continue;
            }

            devicesToUpdate.push(shellyID);
        }

        if (devicesToUpdate.length === 0) {
            throw new Error('No selected devices are eligible for this update');
        }

        currentUpdateRequest.value = request;
        isUpdating.value = true;
        committedDeviceIds.value = [...devicesToUpdate];

        for (const shellyID of devicesToUpdate) {
            if (!firmwareInfo[shellyID]) continue;
            firmwareInfo[shellyID].previousVersion =
                firmwareInfo[shellyID].currentVersion;
            firmwareInfo[shellyID].previousFwId =
                firmwareInfo[shellyID].currentFwId;
            firmwareInfo[shellyID].updateStatus = 'downloading';
            firmwareInfo[shellyID].progressPercent = 0;
        }
        persistUpdateSession();

        const response = await ws.sendRPC<{jobId: string}>(
            'FLEET_MANAGER',
            'Firmware.StartUpdateJob',
            {
                shellyIDs: devicesToUpdate,
                ...(request.type === 'channel'
                    ? {channel: request.value}
                    : {
                          url: request.value,
                          targetBuildIdHint: request.targetBuildIdHint
                      }),
                idempotencyKey: createFirmwareIdempotencyKey(request)
            }
        );
        activeFirmwareJobId = response.jobId;
        jobsStore.track({
            kind: 'firmware',
            jobId: response.jobId,
            label: `Firmware update — ${devicesToUpdate.length} device${devicesToUpdate.length === 1 ? '' : 's'}`,
            total: devicesToUpdate.length
        });
        persistUpdateSession();
    }

    function hasActiveDevices(): boolean {
        return Object.values(firmwareInfo).some((info) =>
            isActiveUpdatePhase(info.updateStatus)
        );
    }

    function finalizeIfComplete() {
        if (!hasActiveDevices()) {
            isUpdating.value = false;
            activeFirmwareJobId = null;
            persistUpdateSession();
        }
    }

    async function retryFailed() {
        const devicesToRetry = failedDevices.value.map((info) => info.shellyID);
        const request = requireCurrentUpdateRequest();
        if (devicesToRetry.length === 0) return;
        if (isUpdating.value) return;

        await runSelectedUpdates(request, devicesToRetry);
    }

    async function retryDevice(shellyID: string) {
        if (!firmwareInfo[shellyID]) return;
        if (isUpdating.value) return;
        const request = requireCurrentUpdateRequest();
        await runSelectedUpdates(request, [shellyID]);
    }

    // Auto-update management
    async function fetchAutoUpdateModes() {
        const token = autoUpdateGuard.bump();
        try {
            const response = await ws.sendRPC<{
                items: Array<{shellyID: string; mode: AutoUpdateMode}>;
            }>('FLEET_MANAGER', 'Firmware.GetAutoUpdateModes', {});
            if (autoUpdateGuard.isStale(token)) return;
            const nextModes: Record<string, AutoUpdateMode> = {};
            const items =
                response?.items ?? (Array.isArray(response) ? response : []);
            for (const item of items) {
                if (!item?.shellyID) continue;
                nextModes[item.shellyID] = item.mode ?? 'off';
            }
            autoUpdateModes.value = nextModes;

            // Update firmwareInfo if already populated
            for (const shellyID of Object.keys(firmwareInfo)) {
                firmwareInfo[shellyID].autoUpdateMode =
                    autoUpdateModes.value[shellyID] ?? 'off';
            }
        } catch (error) {
            // Superseded fetch: the newer one owns the outcome (and the toast).
            if (autoUpdateGuard.isStale(token)) return;
            toastRpcError(toast, error, 'Failed to load auto-update modes');
        }
    }

    async function setAutoUpdateMode(shellyID: string, mode: AutoUpdateMode) {
        if (!isValidShellyID(shellyID)) return;
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Firmware.SetAutoUpdateMode', {
                shellyID,
                mode
            });
            autoUpdateModes.value = {
                ...autoUpdateModes.value,
                [shellyID]: mode
            };

            if (firmwareInfo[shellyID]) {
                firmwareInfo[shellyID].autoUpdateMode = mode;
            }
            autoUpdateGuard.bump();
        } catch (error) {
            console.error('Failed to set auto-update mode:', error);
            throw error;
        }
    }

    async function setAutoUpdateModeBulk(
        shellyIDs: string[],
        mode: AutoUpdateMode
    ) {
        try {
            await ws.sendRPC(
                'FLEET_MANAGER',
                'Firmware.SetAutoUpdateModeBulk',
                {
                    shellyIDs,
                    mode
                }
            );

            const nextModes = {...autoUpdateModes.value};
            for (const shellyID of shellyIDs) {
                nextModes[shellyID] = mode;

                if (firmwareInfo[shellyID]) {
                    firmwareInfo[shellyID].autoUpdateMode = mode;
                }
            }
            autoUpdateModes.value = nextModes;
            autoUpdateGuard.bump();
        } catch (error) {
            console.error('Failed to bulk set auto-update mode:', error);
            throw error;
        }
    }

    async function enableAutoUpdateStableForSelected() {
        await setAutoUpdateModeBulk(
            Array.from(selectedDevices.value),
            'stable'
        );
    }

    async function enableAutoUpdateBetaForSelected() {
        await setAutoUpdateModeBulk(Array.from(selectedDevices.value), 'beta');
    }

    async function disableAutoUpdateForSelected() {
        await setAutoUpdateModeBulk(Array.from(selectedDevices.value), 'off');
    }

    // Initialize auto-update devices and cross-tab session sync on store creation
    fetchAutoUpdateModes();
    startUpdateSessionSync();

    return {
        // State
        selectedDevices,
        firmwareInfo,
        currentStep,
        isUpdating,
        isCheckingFirmware,
        autoUpdateModes,
        committedDeviceIds,

        // Computed
        selectedCount,
        selectedDevicesList,
        executableDevices,
        hasSelectedDevices,
        activateExecutableDevices,
        deactivateExecutableDevices,
        firmwareInfoList,
        devicesWithUpdates,
        failedDevices,
        successDevices,
        updatingDevices,

        // Actions
        toggleDevice,
        selectDevice,
        deselectDevice,
        selectGroup,
        selectAll,
        clearSelection,
        goToStep,
        reset,
        initializeFirmwareInfo,
        initializeAllFirmwareInfo,
        checkFirmwareForSelected,
        checkFirmwareForAll,
        updateSelected,
        updateSelectedByUrl,
        updateDeviceIdsByUrl,
        retryFailed,
        retryDevice,
        fetchAutoUpdateModes,
        setAutoUpdateMode,
        setAutoUpdateModeBulk,
        enableAutoUpdateStableForSelected,
        enableAutoUpdateBetaForSelected,
        disableAutoUpdateForSelected
    };
});
