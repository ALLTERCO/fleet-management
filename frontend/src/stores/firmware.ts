import {defineStore} from 'pinia';
import {computed, reactive, ref} from 'vue';
import {useDeviceSelection} from '@/composables/useDeviceSelection';
import {getDeviceName} from '@/helpers/device';
import {clearObject, sleep} from '@/helpers/objects';
import {trackInteraction} from '@/tools/observability';
import * as ws from '../tools/websocket';
import {useDevicesStore} from './devices';

export interface FirmwareVersion {
    version: string;
    build_id: string;
}

export interface FirmwareDeviceInfo {
    shellyID: string;
    deviceName: string;
    currentVersion: string;
    autoUpdate: boolean;
    availableStable?: FirmwareVersion;
    availableBeta?: FirmwareVersion;
    checkStatus: 'pending' | 'checking' | 'checked' | 'error';
    updateStatus: 'idle' | 'updating' | 'success' | 'failed';
    previousVersion?: string;
    error?: string;
}

const FIRMWARE_CHECK_BATCH_SIZE = 5;

export const useFirmwareStore = defineStore('firmware', () => {
    const devicesStore = useDevicesStore();

    // Device selection via shared composable
    const selection = useDeviceSelection();
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
    const currentStep = ref<1 | 2 | 3>(1);
    const isUpdating = ref(false);
    const isCheckingFirmware = ref(false);
    const autoUpdateDevices = ref<Set<string>>(new Set());

    // Computed
    const selectedDevicesList = computed(() => Array.from(selectedDevices.value));

    const firmwareInfoList = computed(() => {
        return selectedDevicesList.value
            .map((shellyID) => firmwareInfo[shellyID])
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
        return firmwareInfoList.value.filter(
            (info) => info.updateStatus === 'updating'
        );
    });

    const allUpdatesComplete = computed(() => {
        if (!isUpdating.value) return false;
        return firmwareInfoList.value.every(
            (info) =>
                info.updateStatus === 'success' ||
                info.updateStatus === 'failed' ||
                info.updateStatus === 'idle'
        );
    });

    // Actions
    function goToStep(step: 1 | 2 | 3) {
        currentStep.value = step;
    }

    function reset() {
        clearSelection();
        clearObject(firmwareInfo);
        currentStep.value = 1;
        isUpdating.value = false;
        isCheckingFirmware.value = false;
    }

    // Initialize firmware info for selected devices
    function initializeFirmwareInfo() {
        for (const shellyID of selectedDevices.value) {
            const device = devicesStore.devices[shellyID];
            if (!device) continue;

            firmwareInfo[shellyID] = {
                shellyID,
                deviceName: getDeviceName(device.info, shellyID) || shellyID,
                currentVersion: device.info?.ver || 'Unknown',
                autoUpdate: autoUpdateDevices.value.has(shellyID),
                checkStatus: 'pending',
                updateStatus: 'idle'
            };
        }
    }

    // Check firmware for all selected devices
    async function checkFirmwareForSelected() {
        trackInteraction('firmware', 'check', `${selectedDevices.value.size} devices`);
        isCheckingFirmware.value = true;
        initializeFirmwareInfo();

        const shellyIDs = Array.from(selectedDevices.value);

        for (let i = 0; i < shellyIDs.length; i += FIRMWARE_CHECK_BATCH_SIZE) {
            const batch = shellyIDs.slice(i, i + FIRMWARE_CHECK_BATCH_SIZE);
            await Promise.all(batch.map((shellyID) => checkFirmware(shellyID)));
        }

        isCheckingFirmware.value = false;
    }

    /** Query: fetch firmware update info from device (pure RPC, no state mutation). */
    async function queryFirmwareUpdate(shellyID: string) {
        return devicesStore.sendRPC(shellyID, 'Shelly.CheckForUpdate', {});
    }

    /** Command: check firmware for a single device and update state. */
    async function checkFirmware(shellyID: string) {
        if (!firmwareInfo[shellyID]) return;

        firmwareInfo[shellyID].checkStatus = 'checking';

        try {
            const response = await queryFirmwareUpdate(shellyID);

            firmwareInfo[shellyID].checkStatus = 'checked';

            if (response?.stable) {
                firmwareInfo[shellyID].availableStable = {
                    version: response.stable.version,
                    build_id: response.stable.build_id
                };
            }

            if (response?.beta) {
                firmwareInfo[shellyID].availableBeta = {
                    version: response.beta.version,
                    build_id: response.beta.build_id
                };
            }
        } catch (error: any) {
            firmwareInfo[shellyID].checkStatus = 'error';
            firmwareInfo[shellyID].error = error?.message || String(error);
        }
    }

    // Polling configuration
    const POLL_INTERVAL_MS = 10000; // 10 seconds
    const POLL_TIMEOUT_MS = 360000; // 6 minutes

    // Update selected devices to a specific channel
    async function updateSelected(channel: 'stable' | 'beta') {
        trackInteraction('firmware', 'update', `${channel} ${selectedDevices.value.size} devices`);
        isUpdating.value = true;
        goToStep(3);

        const devicesToUpdate: string[] = [];

        // Prepare all devices for update
        for (const shellyID of selectedDevices.value) {
            if (!firmwareInfo[shellyID]) continue;

            const available =
                channel === 'stable'
                    ? firmwareInfo[shellyID].availableStable
                    : firmwareInfo[shellyID].availableBeta;

            if (!available) {
                // No update available for this channel
                firmwareInfo[shellyID].updateStatus = 'idle';
                continue;
            }

            // Store previous version and mark as updating
            firmwareInfo[shellyID].previousVersion =
                firmwareInfo[shellyID].currentVersion;
            firmwareInfo[shellyID].updateStatus = 'updating';
            firmwareInfo[shellyID].error = undefined;
            devicesToUpdate.push(shellyID);
        }

        // Start all updates simultaneously
        await Promise.all(
            devicesToUpdate.map((shellyID) => triggerUpdate(shellyID, channel))
        );

        // Start polling all devices for version changes
        await Promise.all(
            devicesToUpdate.map((shellyID) => pollForVersionChange(shellyID))
        );

        isUpdating.value = false;
    }

    // Trigger the update command (fire and forget - device will reboot)
    async function triggerUpdate(shellyID: string, channel: 'stable' | 'beta') {
        try {
            await devicesStore.sendRPC(shellyID, 'Shelly.Update', {
                stage: channel
            });
        } catch {
            // Ignore errors - device may already be rebooting
        }
    }

    // Poll device for version change
    async function pollForVersionChange(shellyID: string): Promise<void> {
        if (!firmwareInfo[shellyID]) return;

        const previousVersion = firmwareInfo[shellyID].previousVersion;
        const startTime = Date.now();

        while (Date.now() - startTime < POLL_TIMEOUT_MS) {
            // Wait before polling
            await sleep(POLL_INTERVAL_MS);

            // Check if already resolved (e.g., by retry)
            if (
                firmwareInfo[shellyID].updateStatus === 'success' ||
                firmwareInfo[shellyID].updateStatus === 'failed'
            ) {
                return;
            }

            try {
                const response = await devicesStore.sendRPC(
                    shellyID,
                    'Shelly.GetDeviceInfo',
                    {}
                );

                const currentVersion = response?.ver;
                if (currentVersion && currentVersion !== previousVersion) {
                    // Version changed - success!
                    firmwareInfo[shellyID].currentVersion = currentVersion;
                    firmwareInfo[shellyID].updateStatus = 'success';
                    return;
                }
            } catch {
                // Ignore errors - device is likely rebooting
            }
        }

        // Timeout reached without version change - mark as failed
        if (firmwareInfo[shellyID].updateStatus === 'updating') {
            firmwareInfo[shellyID].updateStatus = 'failed';
            firmwareInfo[shellyID].error =
                'Timeout waiting for firmware update to complete';
        }
    }

    async function retryFailed(channel: 'stable' | 'beta' = 'stable') {
        const devicesToRetry = failedDevices.value.map((info) => info.shellyID);

        // Reset status and trigger updates
        for (const shellyID of devicesToRetry) {
            if (!firmwareInfo[shellyID]) continue;
            firmwareInfo[shellyID].updateStatus = 'updating';
            firmwareInfo[shellyID].error = undefined;
        }

        // Start all retries simultaneously
        await Promise.all(
            devicesToRetry.map((shellyID) => triggerUpdate(shellyID, channel))
        );

        // Poll all devices
        await Promise.all(
            devicesToRetry.map((shellyID) => pollForVersionChange(shellyID))
        );
    }

    async function retryDevice(shellyID: string, channel: 'stable' | 'beta') {
        if (!firmwareInfo[shellyID]) return;

        firmwareInfo[shellyID].updateStatus = 'updating';
        firmwareInfo[shellyID].error = undefined;

        await triggerUpdate(shellyID, channel);
        await pollForVersionChange(shellyID);
    }

    // Auto-update management
    async function fetchAutoUpdateDevices() {
        try {
            const response = await ws.sendRPC<string[]>(
                'FLEET_MANAGER',
                'Firmware.GetAutoUpdateDevices',
                {}
            );
            autoUpdateDevices.value = new Set(response || []);

            // Update firmwareInfo if already populated
            for (const shellyID of Object.keys(firmwareInfo)) {
                firmwareInfo[shellyID].autoUpdate =
                    autoUpdateDevices.value.has(shellyID);
            }
        } catch (error) {
            console.error('Failed to fetch auto-update devices:', error);
        }
    }

    async function setAutoUpdate(shellyID: string, enabled: boolean) {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Firmware.SetAutoUpdate', {
                shellyID,
                enabled
            });

            if (enabled) {
                autoUpdateDevices.value.add(shellyID);
            } else {
                autoUpdateDevices.value.delete(shellyID);
            }

            if (firmwareInfo[shellyID]) {
                firmwareInfo[shellyID].autoUpdate = enabled;
            }
        } catch (error) {
            console.error('Failed to set auto-update:', error);
            throw error;
        }
    }

    async function setAutoUpdateBulk(shellyIDs: string[], enabled: boolean) {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Firmware.SetAutoUpdateBulk', {
                shellyIDs,
                enabled
            });

            for (const shellyID of shellyIDs) {
                if (enabled) {
                    autoUpdateDevices.value.add(shellyID);
                } else {
                    autoUpdateDevices.value.delete(shellyID);
                }

                if (firmwareInfo[shellyID]) {
                    firmwareInfo[shellyID].autoUpdate = enabled;
                }
            }
        } catch (error) {
            console.error('Failed to bulk set auto-update:', error);
            throw error;
        }
    }

    async function enableAutoUpdateForSelected() {
        await setAutoUpdateBulk(Array.from(selectedDevices.value), true);
    }

    async function disableAutoUpdateForSelected() {
        await setAutoUpdateBulk(Array.from(selectedDevices.value), false);
    }

    // Initialize auto-update devices on store creation
    fetchAutoUpdateDevices();

    return {
        // State
        selectedDevices,
        firmwareInfo,
        currentStep,
        isUpdating,
        isCheckingFirmware,
        autoUpdateDevices,

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
        allUpdatesComplete,

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
        checkFirmwareForSelected,
        checkFirmware,
        updateSelected,
        retryFailed,
        retryDevice,
        fetchAutoUpdateDevices,
        setAutoUpdate,
        setAutoUpdateBulk,
        enableAutoUpdateForSelected,
        disableAutoUpdateForSelected
    };
});
