// KVS.* — device-side persistent key-value store (per spec).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};

export interface KvsGetParams {
    shellyID: string;
    key: string;
}
export const KVS_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'key'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, key: {type: 'string'}}
};

// KVS.GetMany — device returns up to 50 key/value pairs per page; offset paginates.
export interface KvsGetManyParams {
    shellyID: string;
    match?: string;
    offset?: number;
}
export const KVS_GET_MANY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        match: {type: 'string'},
        offset: {type: 'integer'}
    }
};

// KVS.Set value is opaque (string|number|boolean|null|object|array).
export interface KvsSetParams {
    shellyID: string;
    key: string;
    value: unknown;
    etag?: string;
}
export const KVS_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'key', 'value'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        key: {type: 'string'},
        value: {},
        etag: {type: 'string'}
    }
};

export interface KvsDeleteParams {
    shellyID: string;
    key: string;
    etag?: string;
}
export const KVS_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'key'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        key: {type: 'string'},
        etag: {type: 'string'}
    }
};

export interface KvsListParams {
    shellyID: string;
    match?: string;
    offset?: number;
}
export const KVS_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        match: {type: 'string'},
        offset: {type: 'integer'}
    }
};

const b = new DescribeBuilder('kvs', {
    kind: 'device',
    description: 'Read and write the device-side persistent key-value store.'
});

b.registerMethod('Get', {
    params: KVS_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'KVS.Get — read value + etag for one key.'
});
b.registerMethod('GetMany', {
    params: KVS_GET_MANY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'KVS.GetMany — paginated value reads. `match` is a glob filter (device-validated).'
});
b.registerMethod('Set', {
    params: KVS_SET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'KVS.Set — write a key. Pass `etag` for compare-and-set; device rejects on mismatch.'
});
b.registerMethod('Delete', {
    params: KVS_DELETE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'KVS.Delete — remove a key. Optional `etag` for compare-and-delete.'
});
b.registerMethod('List', {
    params: KVS_LIST_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'KVS.List — paginated key listing without values.'
});

export const KVS_DESCRIBE: DescribeOutput = b.build();
