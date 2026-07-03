import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {count} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {DEVICE_CONFIG_PATCH_SCHEMA, SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {
    type: 'integer',
    minimum: 0,
    description: 'DALI group index on the device'
};
const CONFIG_PATCH = DEVICE_CONFIG_PATCH_SCHEMA;
const RESP_NULL: JsonSchema = {
    type: 'null',
    description: 'Returns null on success'
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

const P_SHELLY_ONLY: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};
const P_SHELLY_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};
const P_SET_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: CONFIG_PATCH
    }
};
const P_GROUP_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        on: {type: 'boolean'},
        brightness: {type: 'number'},
        transition: {type: 'number'}
    }
};

const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};

// DALI namespace itself takes NO params per docs (no `id`, since DALI is
// a singleton bus controller). The Group.* methods below are FM-side
// abstractions on top of device-side DALI groups.

export interface DaliGetConfigParams {
    shellyID: string;
}
export const DALI_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface DaliSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const DALI_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        config: CONFIG_PATCH
    }
};

export interface DaliGetStatusParams {
    shellyID: string;
}
export const DALI_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface DaliStartScanParams {
    shellyID: string;
}
export const DALI_START_SCAN_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface DaliPingKnownDevicesParams {
    shellyID: string;
}
export const DALI_PING_KNOWN_DEVICES_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface DaliGroupGetStatusParams {
    shellyID: string;
    id: number;
}
export const DALI_GROUP_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ID;

export interface DaliGroupGetConfigParams {
    shellyID: string;
    id: number;
}
export const DALI_GROUP_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ID;

export interface DaliGroupSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const DALI_GROUP_SET_CONFIG_PARAMS_SCHEMA = P_SET_CONFIG;

export interface DaliGroupSetParams {
    shellyID: string;
    id: number;
    on?: boolean;
    brightness?: number;
    transition?: number;
}
export const DALI_GROUP_SET_PARAMS_SCHEMA = P_GROUP_SET;

const b = new DescribeBuilder('dali', {
    kind: 'device',
    description:
        'Configure, scan, and control DALI lighting groups and known devices.'
});

b.registerMethod('GetConfig', {
    params: DALI_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'DALI.GetConfig (singleton — empty per spec).'
});
b.registerMethod('SetConfig', {
    params: DALI_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'DALI.SetConfig (singleton — currently no fields per spec).'
});
b.registerMethod('GetStatus', {
    params: DALI_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'DALI.GetStatus.'
});
b.registerMethod('StartScan', {
    params: P_SHELLY_ONLY,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description: 'DALI.StartScan; result arrives via scan_complete NotifyEvent.'
});
b.registerMethod('PingKnownDevices', {
    params: P_SHELLY_ONLY,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description:
        'DALI.PingKnownDevices; result arrives via ping_complete NotifyEvent.'
});
b.registerMethod('Group.GetStatus', {
    params: P_SHELLY_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Group.GetStatus on DALI-capable firmware.'
});
b.registerMethod('Group.GetConfig', {
    params: P_SHELLY_ID,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Group.GetConfig on DALI-capable firmware.'
});
b.registerMethod('Group.SetConfig', {
    params: P_SET_CONFIG,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Group.SetConfig on DALI-capable firmware.'
});
b.registerMethod('Group.Set', {
    params: P_GROUP_SET,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Group.Set on DALI-capable firmware.'
});

const DALI_METRICS: MetricDescriptor[] = [count('cg_count', {optional: true})];

b.setMetrics(DALI_METRICS);

export const DALI_DESCRIBE: DescribeOutput = b.build();
