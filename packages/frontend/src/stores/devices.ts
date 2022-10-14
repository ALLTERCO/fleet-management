import { defineStore } from 'pinia';
import * as http from "../tools/http";
import ShellyDevice from '@/ShellyDevice';

export const useDevicesStore = defineStore('devices', {
    state: () => {
        return {
            singleDevice: {
                response: {} as any
            },
            devices: {} as Record<string, ShellyDevice>
        }
    },
    actions: {
        async fetch() {
            this.devices = {};
            const devices = await http.getDevices()
            for (const [key, value] of Object.entries(devices)) {
                this.devices[key] = { selected: false, fields: {}, channels: 0, ...(value as any) }
            }
        },
        getDevicesWs() {
            return Object.values(this.devices).filter(dev => dev.source === 'ws');
        },
        getDevicesBle() {
            return Object.values(this.devices).filter(dev => dev.source === 'ble')
        },
        addDevice(device: any) {
            device = {channels: 0, fields: {} ,...device} as ShellyDevice;
            this.devices[device.shellyID] = device;
        },
        selectOnlyOne(device_mac: string) {
            Object.values(this.devices).forEach(dev => dev.selected = dev.shellyID == device_mac);
        },
        disconnected(shellyID: string) {
            delete this.devices[shellyID];
        },
        async sendRPC(shellyID: string, method: string, params?: any) {
            return http.sendRPC(shellyID, method, params);
        },
        fieldChanged(shellyID: string, name: string, field: string, value: number | string){
            const device = this.devices[shellyID];
            if(device.fields == undefined){
                device.fields = {};
            }
            if(device.fields[name] == undefined){
                device.fields[name] = {};
            }
            device.fields[name][field] = value;
        }
    },
    getters: {
        getSelected(state) {
            return Object.values(state.devices).filter(dev => dev.selected);
        }
    }
})