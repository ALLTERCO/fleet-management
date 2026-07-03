// BM — Battery Monitor. Pass-through schemas; refine per firmware spec.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const RESP_OPAQUE: JsonSchema = {type: 'object', additionalProperties: true};

export interface BmGetParams {
    shellyID: string;
    id: number;
}

export interface BmSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}

const ID_PROP: JsonSchema = {type: 'integer', minimum: 0};

export const BM_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'id'],
    properties: {shellyID: SHELLY_ID_SCHEMA, id: ID_PROP}
};

export const BM_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'id', 'config'],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: ID_PROP,
        config: {type: 'object', additionalProperties: true}
    }
};

const b = new DescribeBuilder('bm', {
    kind: 'device',
    description:
        'Monitor and configure the Battery Monitor — SOC, SOH, voltage, and errors.'
});
b.registerMethod('GetStatus', {
    params: BM_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Battery Monitor status — SOC, SOH, voltage, errors.'
});
b.registerMethod('GetConfig', {
    params: BM_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Battery Monitor config.'
});
b.registerMethod('SetConfig', {
    params: BM_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Battery Monitor SetConfig — opaque pass-through.'
});

export const BM_DESCRIBE: DescribeOutput = b.build();
