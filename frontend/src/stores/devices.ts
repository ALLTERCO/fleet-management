import {defineStore} from 'pinia';
import {computed, reactive, ref} from 'vue';
import {BATTERY_POWERED_DEVICES_APPS, isDiscovered} from '@/helpers/device';
import {debug} from '@/tools/debug';
import {trackInteraction} from '@/tools/observability';
import type {presence, ShellyDeviceExternal, shelly_device_t} from '@/types';
import * as ws from '../tools/websocket';
import {useEntityStore} from './entities';

/**
 * Apply a patch to a reactive target object in place.
 * Only changed leaf values trigger Vue reactivity updates.
 * Arrays and primitives are replaced entirely; nested objects are recursed.
 */
function applyPatch(target: any, patch: any): void {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    for (const key of Object.keys(patch)) {
        const patchVal = patch[key];
        const targetVal = target[key];
        if (
            patchVal &&
            typeof patchVal === 'object' &&
            !Array.isArray(patchVal) &&
            targetVal &&
            typeof targetVal === 'object' &&
            !Array.isArray(targetVal)
        ) {
            applyPatch(targetVal, patchVal);
        } else if (targetVal !== patchVal) {
            target[key] = patchVal;
        }
    }
}

const DEVICE_LOADING_TIMEOUT_MS = 5_000;

export const useDevicesStore = defineStore('devices', () => {
    const entityStore = useEntityStore();
    const devices = reactive<Record<string, shelly_device_t>>({});
    const initialLoadComplete = ref(false);
    const sensorDataVersion = ref(0);
    const devicesVersion = ref(0);
    const onlineCount = ref(0);
    const idToShellyMap = new Map<number, string>();
    let _bulkLoading = false;

    function setOnline(device: shelly_device_t, online: boolean) {
        const was = device.online;
        device.online = online;
        if (!was && online) onlineCount.value++;
        else if (was && !online) onlineCount.value--;
    }

    interface DeviceData {
        shellyID: string;
        info?: any;
        status?: any;
        settings?: any;
        entities?: string[];
        meta?: any;
        id: any;
    }

    function insertDevice({
        shellyID,
        info = {},
        status = {},
        settings = {},
        entities = [],
        meta = {},
        id
    }: DeviceData) {
        if (!_bulkLoading) devicesVersion.value++;
        devices[shellyID] = {
            shellyID,
            id,
            online: false,
            selected: false,
            loading: !_bulkLoading,
            info,
            status,
            settings,
            entities,
            meta
        };
        idToShellyMap.set(id, shellyID);

        if (!_bulkLoading) {
            setTimeout(() => {
                if (devices[shellyID] && devices[shellyID].loading === true) {
                    devices[shellyID].loading = false;
                    setOnline(devices[shellyID], false);
                }
            }, DEVICE_LOADING_TIMEOUT_MS);
        }
    }

    const rpcResponses = ref<Record<string, any>>({});

    function sendTemplateRpc(method: string, params?: object) {
        // Clear old results
        rpcResponses.value = {};
        // Send commands
        for (const dev of selectedDevices.value) {
            ws.sendRPC(dev.shellyID, method, params)
                .then((resp) => {
                    rpcResponses.value[dev.shellyID] = resp;
                })
                .catch((err) => {
                    if (import.meta.env.DEV)
                        console.warn(
                            `[sendTemplateRpc] RPC failed for ${dev.shellyID}:`,
                            err
                        );
                });
        }
    }

    const selectedDevices = computed(() =>
        Object.values(devices).filter((dev) => dev.selected)
    );

    function getDevices() {
        return Object.values(devices).filter(
            (shelly) => !isDiscovered(shelly.shellyID)
        );
    }

    function getDiscoveredDevices() {
        return Object.values(devices).filter((shelly) =>
            isDiscovered(shelly.shellyID)
        );
    }

    async function fetchDevices() {
        debug('[fetchDevices] fetching device list from server (chunked)...');
        const t0 = performance.now();
        // Collect all chunks first (parallel network), then process in one synchronous pass
        // This avoids 8 separate Vue reactive cascades (one per chunk arrival)
        const allDevices: import('@/types').ShellyDeviceExternal[] = [];
        await ws.listDevicesChunked((chunk) => {
            allDevices.push(...chunk);
        });
        debug(
            '[fetchDevices] network done:',
            allDevices.length,
            'devices in',
            Math.round(performance.now() - t0),
            'ms'
        );
        // Suppress per-device version bumps & loading timers during bulk insert
        _bulkLoading = true;
        for (const device of allDevices) {
            handleNewDevice(device);
        }
        _bulkLoading = false;
        // Single version bump for the entire batch
        devicesVersion.value++;
        initialLoadComplete.value = true;
        debug(
            '[fetchDevices] processed in',
            Math.round(performance.now() - t0),
            'ms total'
        );
    }

    function handleNewDevice(shelly: ShellyDeviceExternal) {
        const existingDevice = devices[shelly.shellyID];

        if (!existingDevice) {
            debug(
                '[handleNewDevice] NEW',
                shelly.shellyID,
                'model:',
                shelly.info?.model
            );
            insertDevice({
                shellyID: shelly.shellyID,
                info: shelly.info,
                status: shelly.status,
                settings: shelly.settings,
                entities: shelly.entities,
                meta: shelly.meta,
                id: shelly.id
            });
            if (!isDiscovered(shelly.shellyID)) {
                for (const entity of shelly.entities) {
                    entityStore.addEntity(entity);
                }
            }
        } else {
            debug('[handleNewDevice] UPDATE', shelly.shellyID);

            if (shelly.info) applyPatch(existingDevice.info, shelly.info);
            if (shelly.status) applyPatch(existingDevice.status, shelly.status);
            if (shelly.settings)
                applyPatch(existingDevice.settings, shelly.settings);
            // For entities array, only replace if the new array is non-empty
            if (shelly.entities && shelly.entities.length > 0) {
                existingDevice.entities = shelly.entities;
            }
            if (shelly.meta) applyPatch(existingDevice.meta, shelly.meta);
            // Update the id in case it changed (though unlikely)
            if (shelly.id !== undefined && shelly.id !== null) {
                existingDevice.id = shelly.id;
                idToShellyMap.set(shelly.id, shelly.shellyID);
            }

            debug(
                '[handleNewDevice] UPDATE done',
                shelly.shellyID,
                'model:',
                existingDevice.info?.model
            );
        }

        const d = devices[shelly.shellyID];

        // Safety check - ensure device was found/created
        if (!d) {
            console.error(
                '[handleNewDevice] CRITICAL: Device not found after insert/update!',
                shelly.shellyID
            );
            return;
        }

        // Safety check - ensure info is never undefined/null
        if (!d.info) {
            console.warn(
                '[handleNewDevice] Device info is falsy, initializing to empty object',
                shelly.shellyID
            );
            d.info = {};
        }

        if (BATTERY_POWERED_DEVICES_APPS.includes(d.info?.app)) {
            const lastTs =
                (d.status as any).ts ?? (d.status as any).sys?.unixtime ?? 0;
            const period = (d.status as any).sys?.wakeup_period ?? 86400;
            const now = Date.now() / 1000;
            setOnline(d, lastTs + period > now);
            debug(
                '[handleNewDevice]',
                shelly.shellyID,
                'battery-powered, online:',
                d.online
            );
        } else {
            setOnline(d, shelly.presence === 'online');
            debug(
                '[handleNewDevice]',
                shelly.shellyID,
                'presence:',
                shelly.presence,
                '-> online:',
                d.online
            );
        }
        d.loading = false;
    }

    function deviceConnected(shelly: ShellyDeviceExternal) {
        debug(
            '[deviceConnected]',
            shelly.shellyID,
            'presence:',
            shelly.presence
        );
        handleNewDevice(shelly);
        devicesVersion.value++;
    }

    function deviceDisconnected(shellyID: string) {
        debug('[deviceDisconnected]', shellyID);
        const device = devices[shellyID];
        if (device) {
            setOnline(device, false);
            devicesVersion.value++;
        }
    }

    function deviceDeleted(shellyID: string) {
        const device = devices[shellyID];
        if (device) {
            if (device.online) onlineCount.value--;
            entityStore.removeEntities(device.entities);
        }

        delete devices[shellyID];
        devicesVersion.value++;
    }

    async function sendRPC(shellyID: string, method: string, params?: any) {
        trackInteraction('rpc', 'send', method);
        return ws.sendRPC(shellyID, method, params);
    }

    function getSelected() {
        return Object.values(devices).filter((dev) => dev.selected);
    }

    function patchInfo(shellyID: string, info: any) {
        const device = devices[shellyID];
        if (device != undefined) {
            debug('[patchInfo]', shellyID);
            applyPatch(device.info, info);
        }
    }

    function patchStatus(shellyID: string, status: any) {
        if (devices[shellyID]) {
            debug('[patchStatus]', shellyID);
            applyPatch(devices[shellyID].status, status);
            for (const key of Object.keys(status)) {
                if (key.startsWith('bthomesensor:')) {
                    sensorDataVersion.value++;
                    break;
                }
            }
        }
    }

    function patchSettings(shellyID: string, settings: any) {
        if (devices[shellyID]) {
            debug('[patchSettings]', shellyID);
            applyPatch(devices[shellyID].settings, settings);
            for (const key of Object.keys(settings)) {
                if (key.startsWith('bthomesensor:')) {
                    sensorDataVersion.value++;
                    break;
                }
            }
        }
    }

    // function patchKVS(shellyID: string, kvs: Record<string, string>) {
    //     const device = devices[shellyID];
    //     if (device != undefined) {
    //         // TODO
    //         // device.kvs = kvs;
    //     }
    // }

    function patchPresence(shellyID: string, presence: presence) {
        if (devices[shellyID]) {
            debug(
                '[patchPresence]',
                shellyID,
                'presence:',
                presence,
                '-> online:',
                presence === 'online'
            );
            setOnline(devices[shellyID], presence === 'online');
            devicesVersion.value++;
        }
    }

    function getDeviceName(shellyID: string): string | undefined {
        const device = devices[shellyID];
        if (device && device.info && device.info.name) {
            return device.info.name;
        }
        return undefined; // Return undefined if the device or name is not found
    }

    return {
        fetchDevices,
        deviceConnected,
        deviceDisconnected,
        deviceDeleted,
        getDevices,
        getDiscoveredDevices,
        patchInfo,
        patchSettings,
        patchStatus,
        // patchKVS,
        patchPresence,
        sendRPC,
        getSelected,
        selectedDevices,
        rpcResponses,
        sendTemplateRpc,
        getDeviceName,
        handleNewDevice,
        devices,
        initialLoadComplete,
        sensorDataVersion,
        devicesVersion,
        onlineCount,
        idToShellyMap
    };
});
