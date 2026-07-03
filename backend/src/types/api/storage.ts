/**
 * Public API types for the `storage.*` namespace — generic KV + list
 * persistence used by the UI registry and widgets.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const KEY_SCHEMA: JsonSchema = {type: 'string', minLength: 1};

export const STORAGE_SET_ITEM_PARAMS: JsonSchema = {
    type: 'object',
    required: ['key', 'value'],
    properties: {key: KEY_SCHEMA, value: {}}
};

export const STORAGE_GET_ITEM_PARAMS: JsonSchema = {
    type: 'object',
    required: ['key'],
    properties: {key: KEY_SCHEMA}
};

export const STORAGE_REMOVE_ITEM_PARAMS = STORAGE_GET_ITEM_PARAMS;
export const STORAGE_KEYS_PARAMS: JsonSchema = {type: 'object', properties: {}};
export const STORAGE_GETALL_PARAMS: JsonSchema = {
    type: 'object',
    properties: {}
};

const ACK: JsonSchema = {type: 'object', additionalProperties: true};

export const STORAGE_DESCRIBE: DescribeOutput = new DescribeBuilder('storage', {
    kind: 'fleet-manager',
    description:
        'Persist user-scoped key/value items for the UI registry and widgets.'
})
    .registerMethod('SetItem', {
        params: STORAGE_SET_ITEM_PARAMS,
        response: ACK,
        permission: {note: 'authenticated'},
        description: 'Upsert a value under a key in user-scoped storage.'
    })
    .registerMethod('GetItem', {
        params: STORAGE_GET_ITEM_PARAMS,
        response: ACK,
        permission: {note: 'authenticated'},
        description: 'Read a value by key.'
    })
    .registerMethod('RemoveItem', {
        params: STORAGE_REMOVE_ITEM_PARAMS,
        response: ACK,
        permission: {note: 'authenticated'},
        description: 'Delete a value by key.'
    })
    .registerMethod('Keys', {
        params: STORAGE_KEYS_PARAMS,
        response: {type: 'array', items: {type: 'string'}},
        permission: {note: 'authenticated'},
        description: 'List all stored keys for the caller.'
    })
    .registerMethod('GetAll', {
        params: STORAGE_GETALL_PARAMS,
        response: ACK,
        permission: {note: 'authenticated'},
        description:
            'Raw (key → value) dict — kept for legacy registry callers. ' +
            'New callers should prefer `storage.list`.'
    })
    .registerMethod('List', {
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
        permission: {note: 'authenticated'},
        description: 'Every (key, value) pair in the standard list envelope.'
    })
    .build();
