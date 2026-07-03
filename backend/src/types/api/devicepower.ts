// DevicePower.* — battery / external power state (per official Shelly docs).

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};
const P_ID_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
const RESP_NULL: JsonSchema = {
    type: 'null',
    description: 'Returns null (per spec, DevicePower.SetConfig has no fields).'
};

export interface DevicePowerSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const DEVICEPOWER_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface DevicePowerGetConfigParams {
    shellyID: string;
    id: number;
}
export const DEVICEPOWER_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface DevicePowerGetStatusParams {
    shellyID: string;
    id: number;
}
export const DEVICEPOWER_GET_STATUS_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('devicepower', {
    kind: 'device',
    description: 'Report battery and external-power state for a device.'
});

b.registerMethod('SetConfig', {
    params: DEVICEPOWER_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description:
        'DevicePower.SetConfig — config object (currently empty per spec).'
});
b.registerMethod('GetConfig', {
    params: DEVICEPOWER_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'DevicePower.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: DEVICEPOWER_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'DevicePower.GetStatus — {id, battery:{V,percent}, external:{present}}.'
});

const DEVICEPOWER_METRICS: MetricDescriptor[] = [
    sensor('battery_v', 'V', {optional: true}),
    sensor('battery_percent', '%', {optional: true})
];

b.setMetrics(DEVICEPOWER_METRICS);

export const DEVICEPOWER_DESCRIBE: DescribeOutput = b.build();
