// BLE.* — device-side Bluetooth Low Energy radio + cloud relay.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {RESTART_REQUIRED_RESPONSE_SCHEMA, SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};

// BLE.SetConfig — toggle radio + RPC-over-BLE.
// `enable` controls the BLE radio entirely; `rpc.enable` gates RPC bonding.
export interface BleSetConfigParams {
    shellyID: string;
    config: {
        enable?: boolean;
        rpc?: {enable?: boolean};
        observer?: {enable?: boolean};
    };
}
export const BLE_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        config: {
            type: 'object',
            additionalProperties: false,
            properties: {
                enable: {type: 'boolean'},
                rpc: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {enable: {type: 'boolean'}}
                },
                observer: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {enable: {type: 'boolean'}}
                }
            }
        }
    }
};

export interface BleGetConfigParams {
    shellyID: string;
}
export const BLE_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface BleGetStatusParams {
    shellyID: string;
}
export const BLE_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// BLE pairing — per spec.
// StartPairing accepts optional `timeout` (default 180s); returns {timeout}.
export interface BleStartPairingParams {
    shellyID: string;
    timeout?: number;
}
export const BLE_START_PAIRING_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        timeout: {type: 'integer'}
    }
};

export interface BleStopPairingParams {
    shellyID: string;
}
export const BLE_STOP_PAIRING_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// ListPairedDevices: per spec takes no params. Returns array of
// {addr, ctime, atime}. Some fw may require addr — wrapper tolerates both.
export interface BleListPairedDevicesParams {
    shellyID: string;
}
export const BLE_LIST_PAIRED_DEVICES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// DeletePairedDevice: addr required.
export interface BleDeletePairedDeviceParams {
    shellyID: string;
    addr: string;
}
export const BLE_DELETE_PAIRED_DEVICE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'addr'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        addr: {type: 'string'}
    }
};

// BLE.CloudRelay.* — manage RPC-over-cloud-relay BLE bonds.
export interface BleCloudRelayListParams {
    shellyID: string;
}
export const BLE_CLOUDRELAY_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface BleCloudRelayListInfosParams {
    shellyID: string;
}
export const BLE_CLOUDRELAY_LIST_INFOS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

const b = new DescribeBuilder('ble', {
    kind: 'device',
    description:
        'Control the device Bluetooth Low Energy radio, pairing, and cloud-relay bonds.'
});

b.registerMethod('SetConfig', {
    params: BLE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESTART_REQUIRED_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'BLE.SetConfig — radio enable + RPC-over-BLE / observer toggles.'
});
b.registerMethod('GetConfig', {
    params: BLE_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BLE.GetConfig — current BLE radio + observer config.'
});
b.registerMethod('GetStatus', {
    params: BLE_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BLE.GetStatus — runtime BLE radio status.'
});
b.registerMethod('StartPairing', {
    params: BLE_START_PAIRING_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'BLE.StartPairing — enable pairing mode for `timeout` seconds (default 180).'
});
b.registerMethod('StopPairing', {
    params: BLE_STOP_PAIRING_PARAMS_SCHEMA,
    response: {type: 'null'},
    permission: PERM_UPDATE,
    description: 'BLE.StopPairing — disable pairing mode.'
});
b.registerMethod('ListPairedDevices', {
    params: BLE_LIST_PAIRED_DEVICES_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'BLE.ListPairedDevices — paired BLE devices: [{addr, ctime, atime}].'
});
b.registerMethod('DeletePairedDevice', {
    params: BLE_DELETE_PAIRED_DEVICE_PARAMS_SCHEMA,
    response: {type: 'null'},
    permission: PERM_UPDATE,
    description: 'BLE.DeletePairedDevice — remove one paired device by addr.'
});
b.registerMethod('CloudRelay.List', {
    params: BLE_CLOUDRELAY_LIST_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BLE.CloudRelay.List — paired cloud-relay devices.'
});
b.registerMethod('CloudRelay.ListInfos', {
    params: BLE_CLOUDRELAY_LIST_INFOS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'BLE.CloudRelay.ListInfos — extended info for cloud-relay bonds.'
});

export const BLE_DESCRIBE: DescribeOutput = b.build();
