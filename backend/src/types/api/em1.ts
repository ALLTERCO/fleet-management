// EM1.* — monophase energy meter (per official Shelly Gen2+ docs).

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {electrical} from './_metricBuilders';
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
const P_CALIBRATE_FROM: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'other_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        other_id: {type: 'integer'}
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
const RESP_CT_TYPES: JsonSchema = {
    type: 'object',
    required: ['supported'],
    properties: {supported: {type: 'array', items: {type: 'string'}}}
};

export interface Em1SetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const EM1_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface Em1GetConfigParams {
    shellyID: string;
    id: number;
}
export const EM1_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface Em1GetStatusParams {
    shellyID: string;
    id: number;
}
export const EM1_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface Em1GetCTTypesParams {
    shellyID: string;
    id: number;
}
export const EM1_GET_CT_TYPES_PARAMS_SCHEMA = P_ID;

export interface Em1CalibrateFromParams {
    shellyID: string;
    id: number;
    other_id: number;
}
export const EM1_CALIBRATE_FROM_PARAMS_SCHEMA = P_CALIBRATE_FROM;

export interface Em1RevertToFactoryCalibrationParams {
    shellyID: string;
    id: number;
}
export const EM1_REVERT_TO_FACTORY_CALIBRATION_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('em1', {
    kind: 'device',
    description: 'Configure and read a monophase energy meter on a device.'
});

b.registerMethod('SetConfig', {
    params: EM1_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'EM1.SetConfig — monophase energy meter config.'
});
b.registerMethod('GetConfig', {
    params: EM1_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EM1.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: EM1_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'EM1.GetStatus.'
});
b.registerMethod('GetCTTypes', {
    params: EM1_GET_CT_TYPES_PARAMS_SCHEMA,
    response: RESP_CT_TYPES,
    permission: PERM_READ,
    description: 'EM1.GetCTTypes — supported current-transformer types.'
});
b.registerMethod('CalibrateFrom', {
    params: EM1_CALIBRATE_FROM_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description:
        'EM1.CalibrateFrom — calibrate this phase from another. Requires >=500W load.'
});
b.registerMethod('RevertToFactoryCalibration', {
    params: EM1_REVERT_TO_FACTORY_CALIBRATION_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'EM1.RevertToFactoryCalibration.'
});

const EM1_METRICS: MetricDescriptor[] = [
    electrical('current', 'current'),
    electrical('voltage', 'voltage'),
    electrical('act_power', 'active_power'),
    electrical('aprt_power', 'apparent_power', {optional: true}),
    electrical('pf', 'power_factor', {optional: true}),
    electrical('freq', 'frequency', {optional: true})
];

b.setMetrics(EM1_METRICS);

export const EM1_DESCRIBE: DescribeOutput = b.build();
