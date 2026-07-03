// Temperature.* — temperature sensor component (per official Shelly docs).

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

export interface TemperatureSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const TEMPERATURE_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface TemperatureGetConfigParams {
    shellyID: string;
    id: number;
}
export const TEMPERATURE_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface TemperatureGetStatusParams {
    shellyID: string;
    id: number;
}
export const TEMPERATURE_GET_STATUS_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('temperature', {
    kind: 'device',
    description:
        'Read and configure the temperature-sensor component on the device.'
});

b.registerMethod('SetConfig', {
    params: TEMPERATURE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Temperature.SetConfig — name / report_thr_C / offset_C.'
});
b.registerMethod('GetConfig', {
    params: TEMPERATURE_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Temperature.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: TEMPERATURE_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Temperature.GetStatus — {id, tC, tF, errors?}.'
});

const TEMPERATURE_METRICS: MetricDescriptor[] = [
    sensor('tc', '°C', {optional: true}),
    sensor('tf', '°F', {optional: true})
];

b.setMetrics(TEMPERATURE_METRICS);

export const TEMPERATURE_DESCRIBE: DescribeOutput = b.build();
