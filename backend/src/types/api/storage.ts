/**
 * Public API types for the `storage.*` namespace — generic KV + list
 * persistence used by the UI registry and widgets.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const KEY_SCHEMA: JsonSchema = {type: 'string', minLength: 1};
const REGISTRY_SCHEMA: JsonSchema = {type: 'string', minLength: 1};

export const STORAGE_SET_ITEM_PARAMS: JsonSchema = {
    type: 'object',
    required: ['key', 'value'],
    properties: {registry: REGISTRY_SCHEMA, key: KEY_SCHEMA, value: {}}
};

export const STORAGE_GET_ITEM_PARAMS: JsonSchema = {
    type: 'object',
    required: ['key'],
    properties: {registry: REGISTRY_SCHEMA, key: KEY_SCHEMA}
};

export const STORAGE_REMOVE_ITEM_PARAMS = STORAGE_GET_ITEM_PARAMS;
export const STORAGE_KEYS_PARAMS: JsonSchema = {
    type: 'object',
    properties: {registry: REGISTRY_SCHEMA}
};
export const STORAGE_GETALL_PARAMS: JsonSchema = {
    type: 'object',
    properties: {registry: REGISTRY_SCHEMA}
};

const ACK: JsonSchema = {type: 'object', additionalProperties: true};

export const STORAGE_DESCRIBE: DescribeOutput = new DescribeBuilder('storage', {
    kind: 'fleet-manager',
    description:
        'Registry-backed key/value storage with registry-specific permissions.'
})
    .registerMethod('SetItem', {
        safety: {operation: 'update'},
        params: STORAGE_SET_ITEM_PARAMS,
        response: ACK,
        permission: {note: 'registry-specific write permission'},
        description: 'Upsert a value under a registry key.'
    })
    .registerMethod('GetItem', {
        safety: {operation: 'read'},
        params: STORAGE_GET_ITEM_PARAMS,
        response: ACK,
        permission: {note: 'registry-specific read permission'},
        description: 'Read a value by key.'
    })
    .registerMethod('RemoveItem', {
        safety: {operation: 'delete'},
        params: STORAGE_REMOVE_ITEM_PARAMS,
        response: ACK,
        permission: {note: 'registry-specific delete permission'},
        description: 'Delete a value by key.'
    })
    .registerMethod('Keys', {
        safety: {operation: 'read'},
        params: STORAGE_KEYS_PARAMS,
        response: {type: 'array', items: {type: 'string'}},
        permission: {note: 'registry-specific read permission'},
        description: 'List readable keys in a registry.'
    })
    .registerMethod('GetAll', {
        safety: {operation: 'read'},
        params: STORAGE_GETALL_PARAMS,
        response: ACK,
        permission: {note: 'registry-specific read permission'},
        description:
            'Raw (key → value) dict — kept for legacy registry callers. ' +
            'New callers should prefer `storage.list`.'
    })
    .registerMethod('List', {
        safety: {operation: 'read'},
        params: STORAGE_GETALL_PARAMS,
        response: {
            type: 'object',
            required: ['items', 'total', 'limit', 'offset', 'has_more'],
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['key', 'value'],
                        properties: {key: {type: 'string'}, value: {}}
                    }
                },
                total: {type: 'integer'},
                limit: {type: 'integer'},
                offset: {type: 'integer'},
                has_more: {type: 'boolean'}
            }
        },
        permission: {note: 'registry-specific read permission'},
        description: 'Every (key, value) pair in the standard list envelope.'
    })
    .build();
