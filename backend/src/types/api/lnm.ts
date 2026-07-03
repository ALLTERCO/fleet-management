// LNM — Local Network Messaging (preview API). Dynamic component with
// Create/Delete; ids in 200-299 range per Shelly docs.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {type: 'object', additionalProperties: true};

export interface LnmGetParams {
    shellyID: string;
    id: number;
}

export interface LnmSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}

export interface LnmCreateParams {
    shellyID: string;
    config: Record<string, unknown>;
    id?: number;
}

export interface LnmDeleteParams {
    shellyID: string;
    id: number;
}

const ID_PROP: JsonSchema = {type: 'integer', minimum: 200, maximum: 299};

export const LNM_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'id'],
    properties: {shellyID: SHELLY_ID_SCHEMA, id: ID_PROP}
};

export const LNM_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'id', 'config'],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: ID_PROP,
        config: {type: 'object', additionalProperties: true}
    }
};

export const LNM_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'config'],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        config: {type: 'object', additionalProperties: true},
        id: ID_PROP
    }
};

export const LNM_DELETE_PARAMS_SCHEMA: JsonSchema = LNM_GET_PARAMS_SCHEMA;

const b = new DescribeBuilder('lnm', {
    kind: 'device',
    description: 'Manage Local Network Messaging instances on a device.'
});
b.registerMethod('GetStatus', {
    params: LNM_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'LNM stats — tx_msgs, rx_msgs, since (preview).'
});
b.registerMethod('GetConfig', {
    params: LNM_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'LNM instance config.'
});
b.registerMethod('SetConfig', {
    params: LNM_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'LNM SetConfig — opaque pass-through (addr, tx, rx).'
});
b.registerMethod('Create', {
    params: LNM_CREATE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Create a new LNM instance (id 200-299).'
});
b.registerMethod('Delete', {
    params: LNM_DELETE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Delete an existing LNM instance.'
});

export const LNM_DESCRIBE: DescribeOutput = b.build();
