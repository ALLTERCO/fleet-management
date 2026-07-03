// Flood.* — flood/leak sensor (per official Shelly docs).

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {state} from './_metricBuilders';
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
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};

export interface FloodSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const FLOOD_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface FloodGetConfigParams {
    shellyID: string;
    id: number;
}
export const FLOOD_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface FloodGetStatusParams {
    shellyID: string;
    id: number;
}
export const FLOOD_GET_STATUS_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('flood', {
    kind: 'device',
    description: 'Configure and read a flood/leak sensor component on a device.'
});

b.registerMethod('SetConfig', {
    params: FLOOD_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description:
        'Flood.SetConfig — name / alarm_mode (disabled|normal|intense|rain) / report_holdoff.'
});
b.registerMethod('GetConfig', {
    params: FLOOD_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Flood.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: FLOOD_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Flood.GetStatus — {id, alarm, mute, errors[]}.'
});

const FLOOD_METRICS: MetricDescriptor[] = [state('alarm'), state('mute')];

b.setMetrics(FLOOD_METRICS);

export const FLOOD_DESCRIBE: DescribeOutput = b.build();
