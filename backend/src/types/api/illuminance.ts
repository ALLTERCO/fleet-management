import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA, id: COMPONENT_ID}
};
const P_ID_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
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
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

export interface IlluminanceSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const ILLUMINANCE_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface IlluminanceGetConfigParams {
    shellyID: string;
    id: number;
}
export const ILLUMINANCE_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface IlluminanceGetStatusParams {
    shellyID: string;
    id: number;
}
export const ILLUMINANCE_GET_STATUS_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('illuminance', {
    kind: 'device',
    description:
        'Configure and read an illuminance sensor component on a device.'
});

b.registerMethod('SetConfig', {
    params: ILLUMINANCE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Illuminance.SetConfig — name / dark_thr / bright_thr.'
});
b.registerMethod('GetConfig', {
    params: ILLUMINANCE_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Illuminance.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: ILLUMINANCE_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Illuminance.GetStatus.'
});

const ILLUMINANCE_METRICS: MetricDescriptor[] = [
    sensor('lux', 'lx', {optional: true})
];

b.setMetrics(ILLUMINANCE_METRICS);

export const ILLUMINANCE_DESCRIBE: DescribeOutput = b.build();
