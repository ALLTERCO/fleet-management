import type {Component} from 'vue';
import BleConfigPanel from '@/components/core/BleConfigPanel.vue';
import CloudConfigPanel from '@/components/core/CloudConfigPanel.vue';
import EthConfigPanel from '@/components/core/EthConfigPanel.vue';
import KnxConfigPanel from '@/components/core/KnxConfigPanel.vue';
import LedStripConfigPanel from '@/components/core/LedStripConfigPanel.vue';
import LnmPanel from '@/components/core/LnmPanel.vue';
import MatterConfigPanel from '@/components/core/MatterConfigPanel.vue';
import MbRtuClientToolPanel from '@/components/core/MbRtuClientToolPanel.vue';
import ModbusConfigPanel from '@/components/core/ModbusConfigPanel.vue';
import MqttConfigPanel from '@/components/core/MqttConfigPanel.vue';
import RpcUdpConfigPanel from '@/components/core/RpcUdpConfigPanel.vue';
import SchedulesPanel from '@/components/core/SchedulesPanel.vue';
import ScriptManager from '@/components/core/ScriptManager.vue';
import SerialConfigPanel from '@/components/core/SerialConfigPanel.vue';
import SysConfigPanel from '@/components/core/SysConfigPanel.vue';
import WebhooksPanel from '@/components/core/WebhooksPanel.vue';
import WifiConfigPanel from '@/components/core/WifiConfigPanel.vue';
import WsConfigPanel from '@/components/core/WsConfigPanel.vue';
import ZigbeeConfigPanel from '@/components/core/ZigbeeConfigPanel.vue';
import {deviceSupports} from '@/helpers/device';

export interface DeviceConfigEntry {
    title: string;
    description: string;
    icon: string;
    group: DeviceConfigGroupId;
    panel: Component;
    /** Extra props for the panel — lets one component serve several pages. */
    panelProps?: Record<string, unknown>;
    /** RPC methods the device must advertise via Shelly.ListMethods. */
    requires: string[];
    status?: (device: DeviceShape) => DeviceConfigStatus | null;
}

export interface DeviceConfigStatus {
    label: string;
    tone: 'on' | 'off' | 'warn' | 'neutral';
}

export type DeviceConfigGroupId =
    | 'networks'
    | 'bluetooth'
    | 'automation'
    | 'hardware'
    | 'integrations'
    | 'system';

export const DEVICE_CONFIG_GROUPS: ReadonlyArray<{
    id: DeviceConfigGroupId;
    label: string;
}> = [
    {id: 'networks', label: 'Networks'},
    {id: 'bluetooth', label: 'Bluetooth'},
    {id: 'automation', label: 'Automation'},
    {id: 'hardware', label: 'Hardware'},
    {id: 'integrations', label: 'Integrations'},
    {id: 'system', label: 'System'}
];

interface DeviceShape {
    methods?: string[];
    status?: object;
    settings?: object;
}

function componentValue(
    source: object | undefined,
    key: string
): Record<string, unknown> | undefined {
    const value = (source as Record<string, unknown> | undefined)?.[key];
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/** One entry per device-level config namespace. Insertion order = render order. */
export const DEVICE_CONFIG_REGISTRY: Record<string, DeviceConfigEntry> = {
    // The app's structure: each Wi-Fi concern is its own settings page
    // (Wi-Fi 1 / Wi-Fi 2 / Access point / Range extender), not tabs.
    wifi: {
        title: 'Wi-Fi 1',
        description: 'Primary network connection and scanning',
        icon: 'fas fa-wifi',
        group: 'networks',
        panel: WifiConfigPanel,
        panelProps: {view: 'primary'},
        requires: ['Wifi.GetConfig'],
        status: (device) => {
            const wifi = componentValue(device.status, 'wifi');
            if (!wifi) return null;
            if (wifi?.status === 'got ip' || wifi?.sta_ip) {
                return {label: 'Connected', tone: 'on'};
            }
            if (wifi?.ssid) return {label: 'Connecting', tone: 'warn'};
            return {label: 'Disconnected', tone: 'off'};
        }
    },
    wifi2: {
        title: 'Wi-Fi 2',
        description: 'Backup network used when the primary is unavailable',
        icon: 'fas fa-wifi',
        group: 'networks',
        panel: WifiConfigPanel,
        panelProps: {view: 'backup'},
        requires: ['Wifi.GetConfig'],
        status: (device) => {
            const wifi = componentValue(device.settings, 'wifi');
            const sta1 = wifi?.sta1 as {enable?: boolean} | undefined;
            if (!sta1) return null;
            return sta1.enable === true
                ? {label: 'Enabled', tone: 'on'}
                : {label: 'Disabled', tone: 'off'};
        }
    },
    wifiap: {
        title: 'Access point',
        description: "The device's own fallback network",
        icon: 'fas fa-tower-cell',
        group: 'networks',
        panel: WifiConfigPanel,
        panelProps: {view: 'ap'},
        requires: ['Wifi.GetConfig'],
        status: (device) => {
            const wifi = componentValue(device.settings, 'wifi');
            const ap = wifi?.ap as {enable?: boolean} | undefined;
            if (!ap) return null;
            return ap.enable === true
                ? {label: 'Enabled', tone: 'on'}
                : {label: 'Disabled', tone: 'off'};
        }
    },
    wifirange: {
        title: 'Range extender',
        description: 'Forward access point clients to the upstream network',
        icon: 'fas fa-signal',
        group: 'networks',
        panel: WifiConfigPanel,
        panelProps: {view: 'range'},
        requires: ['Wifi.GetConfig'],
        status: (device) => {
            const wifi = componentValue(device.settings, 'wifi');
            const ap = wifi?.ap as
                | {range_extender?: {enable?: boolean}}
                | undefined;
            if (!ap?.range_extender) return null;
            return ap.range_extender.enable === true
                ? {label: 'Enabled', tone: 'on'}
                : {label: 'Disabled', tone: 'off'};
        }
    },
    eth: {
        title: 'Ethernet',
        description: 'Wired network, IP assignment and connected clients',
        icon: 'fas fa-ethernet',
        group: 'networks',
        panel: EthConfigPanel,
        requires: ['Eth.GetConfig'],
        status: (device) => {
            const eth = componentValue(device.status, 'eth');
            if (!eth) return null;
            return eth.ip
                ? {label: 'Connected', tone: 'on'}
                : {label: 'Disconnected', tone: 'off'};
        }
    },
    ws: {
        title: 'Outbound WebSocket',
        description: 'Remote RPC connection and transport security',
        icon: 'fas fa-arrow-up-right-dots',
        group: 'networks',
        panel: WsConfigPanel,
        requires: ['WS.GetConfig'],
        status: (device) => {
            const ws = componentValue(device.status, 'ws');
            if (!ws) return null;
            return ws.connected === true
                ? {label: 'Connected', tone: 'on'}
                : {label: 'Disconnected', tone: 'off'};
        }
    },
    // Lives in sys.rpc_udp but is its own page, like in the Shelly app.
    rpcudp: {
        title: 'RPC over UDP',
        description: 'Direct RPC channel over UDP for local integrations',
        icon: 'fas fa-right-left',
        group: 'networks',
        panel: RpcUdpConfigPanel,
        requires: ['Sys.GetConfig']
    },
    cloud: {
        title: 'Cloud',
        description: 'Shelly Cloud connection and server',
        icon: 'fas fa-cloud',
        group: 'networks',
        panel: CloudConfigPanel,
        requires: ['Cloud.GetConfig'],
        status: (device) => {
            const cloud = componentValue(device.status, 'cloud');
            if (!cloud) return null;
            return cloud.connected === true
                ? {label: 'Connected', tone: 'on'}
                : {label: 'Disconnected', tone: 'off'};
        }
    },
    mqtt: {
        title: 'MQTT',
        description: 'Broker connection, topics and transport security',
        icon: 'fas fa-tower-broadcast',
        group: 'networks',
        panel: MqttConfigPanel,
        requires: ['Mqtt.GetConfig'],
        status: (device) => {
            const mqtt = componentValue(device.status, 'mqtt');
            if (!mqtt) return null;
            return mqtt.connected === true
                ? {label: 'Connected', tone: 'on'}
                : {label: 'Disconnected', tone: 'off'};
        }
    },
    // Firmware preview feature — only devices advertising LNM.* show it.
    lnm: {
        title: 'Local Network Messaging',
        description: 'Status and commands over UDP multicast, no cloud needed',
        icon: 'fas fa-rss',
        group: 'networks',
        panel: LnmPanel,
        requires: ['LNM.GetConfig']
    },
    // A pairing standard, not a network — grouped with the integrations.
    matter: {
        title: 'Matter',
        description: 'Matter connectivity and controller pairing',
        icon: 'fas fa-circle-nodes',
        group: 'integrations',
        panel: MatterConfigPanel,
        requires: ['Matter.GetConfig'],
        status: (device) => {
            const matter = componentValue(device.settings, 'matter');
            if (!matter) return null;
            return matter.enable === true
                ? {label: 'Enabled', tone: 'on'}
                : {label: 'Disabled', tone: 'off'};
        }
    },
    zigbee: {
        title: 'Zigbee',
        description: 'Zigbee connectivity and network state',
        icon: 'fas fa-share-nodes',
        group: 'networks',
        panel: ZigbeeConfigPanel,
        requires: ['Zigbee.GetConfig'],
        status: (device) => {
            const zigbee = componentValue(device.settings, 'zigbee');
            if (!zigbee) return null;
            return zigbee.enable === true
                ? {label: 'Enabled', tone: 'on'}
                : {label: 'Disabled', tone: 'off'};
        }
    },
    ble: {
        title: 'Bluetooth settings',
        description: 'Bluetooth radio, pairing and gateway behavior',
        icon: 'fab fa-bluetooth-b',
        group: 'bluetooth',
        panel: BleConfigPanel,
        requires: ['BLE.GetConfig'],
        status: (device) => {
            const ble = componentValue(device.settings, 'ble');
            if (!ble) return null;
            return ble.enable === true
                ? {label: 'Enabled', tone: 'on'}
                : {label: 'Disabled', tone: 'off'};
        }
    },
    modbus: {
        title: 'Modbus',
        description: 'Industrial protocol and TCP service settings',
        icon: 'fas fa-network-wired',
        group: 'integrations',
        panel: ModbusConfigPanel,
        requires: ['Modbus.GetConfig'],
        status: (device) => {
            const modbus = componentValue(device.settings, 'modbus');
            if (!modbus) return null;
            return modbus.enable === true
                ? {label: 'Enabled', tone: 'on'}
                : {label: 'Disabled', tone: 'off'};
        }
    },
    serial: {
        title: 'Serial port',
        description: 'Serial interface mode and communication parameters',
        icon: 'fas fa-plug-circle-bolt',
        group: 'integrations',
        panel: SerialConfigPanel,
        requires: ['Serial.GetConfig']
    },
    // Only present when Serial.mode = mb_client; firmware adds the methods
    // dynamically, so the gate is naturally accurate.
    mbrtuclient: {
        title: 'Modbus RTU tools',
        description: 'Inspect and test Modbus RTU registers',
        icon: 'fas fa-screwdriver-wrench',
        group: 'integrations',
        panel: MbRtuClientToolPanel,
        requires: ['MbRtuClient.ReadHoldingRegisters']
    },
    knx: {
        title: 'KNX',
        description: 'KNX bus integration and addressing',
        icon: 'fas fa-building',
        group: 'integrations',
        panel: KnxConfigPanel,
        requires: ['KNX.GetConfig']
    },
    script: {
        title: 'Scripts',
        description: 'Device-hosted automation scripts',
        icon: 'fas fa-code',
        group: 'automation',
        panel: ScriptManager,
        requires: ['Script.List']
    },
    schedule: {
        title: 'Schedules',
        description: 'Timed actions the device runs on its own',
        icon: 'fas fa-clock',
        group: 'automation',
        panel: SchedulesPanel,
        requires: ['Schedule.List']
    },
    webhook: {
        title: 'Webhooks',
        description: 'HTTP calls the device sends when events happen',
        icon: 'fas fa-paper-plane',
        group: 'automation',
        panel: WebhooksPanel,
        requires: ['Webhook.List']
    },
    sys: {
        title: 'System',
        description: 'Eco mode, time, location and debug logs',
        icon: 'fas fa-microchip',
        group: 'system',
        panel: SysConfigPanel,
        requires: ['Sys.GetConfig']
    },
    ledstrip: {
        title: 'LED strip',
        description: 'LED strip output and appearance',
        icon: 'fas fa-lightbulb',
        group: 'hardware',
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
