// Wifi.* — device-side WiFi (sta + sta1 backup + ap rescue + roaming).

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {RESTART_REQUIRED_RESPONSE_SCHEMA, SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};

// Field names mirror Wifi.SetConfig (`pass` not `password`; hidden on Get).
// Each sub-section is optional; omitting one leaves it untouched on device.
const WIFI_STA_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ssid: {type: ['string', 'null']},
        pass: {type: ['string', 'null']},
        enable: {type: 'boolean'},
        is_open: {type: 'boolean'},
        ipv4mode: {type: 'string'},
        ip: {type: ['string', 'null']},
        netmask: {type: ['string', 'null']},
        gw: {type: ['string', 'null']},
        nameserver: {type: ['string', 'null']}
    }
};

const WIFI_AP_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ssid: {type: 'string'},
        pass: {type: ['string', 'null']},
        is_open: {type: 'boolean'},
        enable: {type: 'boolean'},
        range_extender: {
            type: 'object',
            required: ['enable'],
            additionalProperties: false,
            properties: {enable: {type: 'boolean'}}
        }
    }
};

const WIFI_ROAM_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        rssi_thr: {type: 'integer'},
        interval: {type: 'integer'}
    }
};

export interface WifiSetConfigParams {
    shellyID: string;
    config: {
        sta?: Record<string, unknown>;
        sta1?: Record<string, unknown>;
        ap?: Record<string, unknown>;
        roam?: {rssi_thr?: number; interval?: number};
    };
}
export const WIFI_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        config: {
            type: 'object',
            additionalProperties: false,
            properties: {
                sta: WIFI_STA_SCHEMA,
                sta1: WIFI_STA_SCHEMA,
                ap: WIFI_AP_SCHEMA,
                roam: WIFI_ROAM_SCHEMA
            }
        }
    }
};

export interface WifiGetConfigParams {
    shellyID: string;
}
export const WIFI_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface WifiGetStatusParams {
    shellyID: string;
}
export const WIFI_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface WifiScanParams {
    shellyID: string;
}
export const WIFI_SCAN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// Wifi.ListAPClients — DHCP leases when device hosts the AP rescue net.
export interface WifiListAPClientsParams {
    shellyID: string;
}
export const WIFI_LIST_AP_CLIENTS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface WifiSavedNetworksListParams {
    shellyID: string;
}
export const WIFI_SAVED_NETWORKS_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface WifiSavedNetworksDeleteParams {
    shellyID: string;
    id: number;
}
export const WIFI_SAVED_NETWORKS_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: {type: 'integer', minimum: 0}
    }
};

export interface WifiSpeedTestParams {
    shellyID: string;
}
export const WIFI_SPEED_TEST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

const b = new DescribeBuilder('wifi', {
    kind: 'device',
    description:
        'Relay the device WiFi namespace (station, backup, AP rescue, roaming).'
});

b.registerMethod('SetConfig', {
    params: WIFI_SET_CONFIG_PARAMS_SCHEMA,
    response: RESTART_REQUIRED_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'Wifi.SetConfig — full WiFi config (sta / sta1 backup / ap rescue / roam). Device validates per device class.'
});
b.registerMethod('GetConfig', {
    params: WIFI_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Wifi.GetConfig — current WiFi configuration.'
});
b.registerMethod('GetStatus', {
    params: WIFI_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Wifi.GetStatus — link state, ssid, ip, rssi.'
});
b.registerMethod('Scan', {
    params: WIFI_SCAN_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Wifi.Scan — list visible nearby APs.'
});
b.registerMethod('ListAPClients', {
    params: WIFI_LIST_AP_CLIENTS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Wifi.ListAPClients — DHCP leases when AP rescue mode is active.'
});
b.registerMethod('SavedNetworks.List', {
    params: WIFI_SAVED_NETWORKS_LIST_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Wifi.SavedNetworks.List — saved AP credentials with current flag.'
});
b.registerMethod('SavedNetworks.Delete', {
    params: WIFI_SAVED_NETWORKS_DELETE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Wifi.SavedNetworks.Delete — remove a saved AP by id (active network is rejected).'
});
b.registerMethod('SpeedTest', {
    params: WIFI_SPEED_TEST_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Wifi.SpeedTest — measure download bandwidth (returns size, duration, bandwidth).'
});

const WIFI_METRICS: MetricDescriptor[] = [
    sensor('rssi', 'dBm', {optional: true})
];

b.setMetrics(WIFI_METRICS);

export const WIFI_DESCRIBE: DescribeOutput = b.build();
