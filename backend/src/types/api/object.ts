// Object.* — XT1 typed-value primitive owned by Service components.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};

export interface ObjectShellyIdParams {
    shellyID: string;
    id: number;
}
export const OBJECT_SHELLY_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};

export interface ObjectSetParams {
    shellyID: string;
    id: number;
    value: unknown;
}
export const OBJECT_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'value'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        value: {} as JsonSchema
    }
};

export interface ObjectSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const OBJECT_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
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
const RESP_NULL: JsonSchema = {type: 'null'};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

const b = new DescribeBuilder('object', {
    kind: 'device',
    description:
        'Relay XT1 typed-value object config, status, and writes to a Shelly device.'
});

b.registerMethod('GetConfig', {
    params: OBJECT_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Object.GetConfig — id, name, meta, owner, access.'
});

b.registerMethod('GetStatus', {
    params: OBJECT_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Object.GetStatus — value, source, last_update_ts.'
});

b.registerMethod('SetConfig', {
    params: OBJECT_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Object.SetConfig — patch object metadata (subject to access flags).'
});

b.registerMethod('Set', {
    params: OBJECT_SET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description:
        'Object.Set — write the typed value (caller must match the object type).'
});

export const OBJECT_DESCRIBE: DescribeOutput = b.build();
