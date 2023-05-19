import { defineStore } from 'pinia';
import * as ws from "../tools/websocket";
import { reactive, ref, Ref } from 'vue';

interface ble_device {
    mac: string;
    name: string;
    deviceInfo: any;
    status: string;
    selected: boolean;
}

export const useDevicesStore = defineStore('devices', () => {
    const singleDevice = reactive({
        response: {}
    });
    const devices: Ref<Record<string, ShellyDeviceExternal>> = ref({});
    const ble = reactive({
        devices: {} as Record<string, ble_device>,
        enabled: true
    });

    async function fetchDevices() {
        devices.value = {};
        const serverDevices = await ws.listDevices()
        for (const [key, value] of Object.entries(serverDevices)) {
            devices.value[key] = { selected: false, fields: {}, ...(value as any) }
        }
    }

    function deviceConnected(shelly: ShellyDeviceExternal) {
        devices.value[shelly.shellyID] = shelly;
    }

    function deviceDisconnected(shellyID: string) {
        delete devices.value[shellyID];
    }

    async function sendRPC(shellyID: string, method: string, params?: any) {
        return ws.sendRPC(shellyID, method, params);
    }

    function getSelected() {
        return Object.values(devices.value).filter(dev => dev.selected);
    }

    function patchInfo(shellyID: string, info: any) {
        const device = devices.value[shellyID];
        if (device != undefined) {
            device.info = info;
        }
    }

    function patchStatus(shellyID: string, status: any, statusTs?: number) {
        const device = devices.value[shellyID];
        if (device != undefined) {
            device.status = status;
        }
    }

    function patchSettings(shellyID: string, settings: any, settingsTs?: number) {
        const device = devices.value[shellyID];
        if (device != undefined) {
            device.settings = settings;
        }
    }

    function patchGroups(shellyID: string, groups: Record<string, string>) {
        const device = devices.value[shellyID];
        if (device != undefined) {
            device.groups = groups;
        }
    }

    return {
        singleDevice, devices, ble, fetchDevices, deviceConnected, deviceDisconnected,
        patchInfo, patchSettings, patchStatus, patchGroups, sendRPC, getSelected
    }
});