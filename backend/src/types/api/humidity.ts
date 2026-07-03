// Humidity.* — humidity sensor component (per official Shelly docs).

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
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};

export interface HumiditySetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const HUMIDITY_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface HumidityGetConfigParams {
    shellyID: string;
    id: number;
}
export const HUMIDITY_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface HumidityGetStatusParams {
    shellyID: string;
    id: number;
}
export const HUMIDITY_GET_STATUS_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('humidity', {
    kind: 'device',
    description: 'Configure and read a humidity sensor component on a device.'
});

b.registerMethod('SetConfig', {
    params: HUMIDITY_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Humidity.SetConfig — name / report_thr / offset.'
});
b.registerMethod('GetConfig', {
    params: HUMIDITY_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Humidity.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: HUMIDITY_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Humidity.GetStatus — {id, rh, errors?}.'
});

const HUMIDITY_METRICS: MetricDescriptor[] = [
    sensor('rh', '%', {optional: true})
];

b.setMetrics(HUMIDITY_METRICS);

export const HUMIDITY_DESCRIBE: DescribeOutput = b.build();
