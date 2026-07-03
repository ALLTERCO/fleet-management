import type {Component} from 'vue';
import BleConfigPanel from '@/components/core/BleConfigPanel.vue';
import CloudConfigPanel from '@/components/core/CloudConfigPanel.vue';
import EthConfigPanel from '@/components/core/EthConfigPanel.vue';
import LedStripConfigPanel from '@/components/core/LedStripConfigPanel.vue';
import MbRtuClientToolPanel from '@/components/core/MbRtuClientToolPanel.vue';
import ModbusConfigPanel from '@/components/core/ModbusConfigPanel.vue';
import MqttConfigPanel from '@/components/core/MqttConfigPanel.vue';
import ScriptManager from '@/components/core/ScriptManager.vue';
import SerialConfigPanel from '@/components/core/SerialConfigPanel.vue';
import WifiConfigPanel from '@/components/core/WifiConfigPanel.vue';
import {deviceSupports} from '@/helpers/device';

export interface DeviceConfigEntry {
    title: string;
    panel: Component;
    /** RPC methods the device must advertise via Shelly.ListMethods. */
    requires: string[];
}

interface DeviceShape {
    methods?: string[];
}

/** One entry per device-level config namespace. Insertion order = render order. */
export const DEVICE_CONFIG_REGISTRY: Record<string, DeviceConfigEntry> = {
    wifi: {
        title: 'Wi-Fi',
        panel: WifiConfigPanel,
        requires: ['Wifi.GetConfig']
    },
    eth: {
        title: 'Ethernet',
        panel: EthConfigPanel,
        requires: ['Eth.GetConfig']
    },
    cloud: {
        title: 'Cloud',
        panel: CloudConfigPanel,
        requires: ['Cloud.GetConfig']
    },
    mqtt: {
        title: 'MQTT',
        panel: MqttConfigPanel,
        requires: ['Mqtt.GetConfig']
    },
    ble: {
        title: 'Bluetooth',
        panel: BleConfigPanel,
        requires: ['BLE.GetConfig']
    },
    modbus: {
        title: 'Modbus',
        panel: ModbusConfigPanel,
        requires: ['Modbus.GetConfig']
    },
    serial: {
        title: 'Serial port',
        panel: SerialConfigPanel,
        requires: ['Serial.GetConfig']
    },
    // Only present when Serial.mode = mb_client; firmware adds the methods
    // dynamically, so the gate is naturally accurate.
    mbrtuclient: {
        title: 'Modbus RTU tools',
        panel: MbRtuClientToolPanel,
        requires: ['MbRtuClient.ReadHoldingRegisters']
    },
    script: {
        title: 'Scripts',
        panel: ScriptManager,
        requires: ['Script.List']
    },
    ledstrip: {
        title: 'LED strip',
        panel: LedStripConfigPanel,
        requires: ['LedStrip.GetConfig']
    }
};

export function deviceShows(
    device: DeviceShape | null | undefined,
    entry: DeviceConfigEntry
): boolean {
    return deviceSupports(device, ...entry.requires);
}
