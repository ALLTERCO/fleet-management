import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const CHANNEL_ID: JsonSchema = {type: 'integer', minimum: 0};
const P_TRIGGER: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: true,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        event: {
            type: 'string',
            description: 'Event kind (device-validated).'
        }
    }
};
const P_SET_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        config: {type: 'object'}
    }
};
const P_RESET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: CHANNEL_ID,
        types: {type: 'array', items: {type: 'string'}}
    }
};
const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA, id: CHANNEL_ID}
};

// Input.CheckExpression — per spec: {expr, inputs}. NOT per-channel.
// expr is a JS expression; inputs is up to 5 numeric values to evaluate against.
const P_CHECK_EXPR: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'expr', 'inputs'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        expr: {type: 'string'},
        inputs: {type: 'array', items: {type: ['number', 'null']}}
    }
};

const RESP_OPAQUE: JsonSchema = {
    description: 'Device-defined (object or null).'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

export interface InputGetConfigParams {
    shellyID: string;
    id: number;
}
export const INPUT_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface InputGetStatusParams {
    shellyID: string;
    id: number;
}
export const INPUT_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface InputCheckExpressionParams {
    shellyID: string;
    expr: string;
    inputs: Array<number | null>;
}
export const INPUT_CHECK_EXPRESSION_PARAMS_SCHEMA = P_CHECK_EXPR;

export interface InputTriggerParams {
    shellyID: string;
    id: number;
    event?: string;
}
export const INPUT_TRIGGER_PARAMS_SCHEMA = P_TRIGGER;

export interface InputSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const INPUT_SET_CONFIG_PARAMS_SCHEMA = P_SET_CONFIG;

export interface InputResetCountersParams {
    shellyID: string;
    id: number;
    types?: string[];
}
export const INPUT_RESET_COUNTERS_PARAMS_SCHEMA = P_RESET;

const b = new DescribeBuilder('input', {
    kind: 'device',
    description: 'Configure, read, and trigger an input channel on a device.'
});

b.registerMethod('Trigger', {
    params: P_TRIGGER,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Input.Trigger — synthesize an input event.'
});
b.registerMethod('SetConfig', {
    params: P_SET_CONFIG,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Input.SetConfig.'
});
b.registerMethod('ResetCounters', {
    params: P_RESET,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Input.ResetCounters.'
});
b.registerMethod('GetConfig', {
    params: INPUT_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Input.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: INPUT_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Input.GetStatus.'
});
b.registerMethod('CheckExpression', {
    params: INPUT_CHECK_EXPRESSION_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Input.CheckExpression — evaluate a comparison expression against the input.'
});

const INPUT_METRICS: MetricDescriptor[] = [
    sensor('percent', '%', {optional: true}),
    sensor('counts_total', 'count', {optional: true}),
    sensor('freq', 'Hz', {optional: true})
];

b.setMetrics(INPUT_METRICS);

export const INPUT_DESCRIBE: DescribeOutput = b.build();
