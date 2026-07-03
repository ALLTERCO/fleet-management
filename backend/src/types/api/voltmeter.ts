// Voltmeter.* — voltmeter sensor with optional expression evaluation.

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

export interface VoltmeterSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const VOLTMETER_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface VoltmeterGetConfigParams {
    shellyID: string;
    id: number;
}
export const VOLTMETER_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface VoltmeterGetStatusParams {
    shellyID: string;
    id: number;
}
export const VOLTMETER_GET_STATUS_PARAMS_SCHEMA = P_ID;

// Voltmeter.CheckExpression — evaluate a JS expression with x = inputs[i].
// Spec: {expr: string, inputs: number[]} — up to 5 inputs per spec.
export interface VoltmeterCheckExpressionParams {
    shellyID: string;
    expr: string;
    inputs: number[];
}
export const VOLTMETER_CHECK_EXPRESSION_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'expr', 'inputs'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        expr: {type: 'string'},
        inputs: {type: 'array', items: {type: 'number'}}
    }
};

const b = new DescribeBuilder('voltmeter', {
    kind: 'device',
    description:
        'Relay the device voltmeter sensor namespace with optional expression evaluation.'
});

b.registerMethod('SetConfig', {
    params: VOLTMETER_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description:
        'Voltmeter.SetConfig — name / report_thr / range / xvoltage transform.'
});
b.registerMethod('GetConfig', {
    params: VOLTMETER_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Voltmeter.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: VOLTMETER_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Voltmeter.GetStatus — {id, voltage, xvoltage, errors?}.'
});
b.registerMethod('CheckExpression', {
    params: VOLTMETER_CHECK_EXPRESSION_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Voltmeter.CheckExpression — evaluate JS xvoltage expression against inputs.'
});

const VOLTMETER_METRICS: MetricDescriptor[] = [
    sensor('voltage', 'V', {optional: true})
];

b.setMetrics(VOLTMETER_METRICS);

export const VOLTMETER_DESCRIBE: DescribeOutput = b.build();
