/** Public API types for the `variables.*` namespace — action substitution vars. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const VARIABLE_KEY: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120,
    pattern: '^[A-Za-z0-9_][A-Za-z0-9_.-]*$'
};

const VARIABLE_VALUE: JsonSchema = {
    type: 'string',
    maxLength: 4096
};

const VARIABLE_ENTRY: JsonSchema = {
    type: 'object',
    required: ['key', 'value'],
    properties: {key: VARIABLE_KEY, value: VARIABLE_VALUE}
};

export const VARIABLES_LIST_PARAMS: JsonSchema = {
    type: 'object',
    properties: {}
};

export const VARIABLES_GET_PARAMS: JsonSchema = {
    type: 'object',
    required: ['key'],
    properties: {key: VARIABLE_KEY}
};

export const VARIABLES_SET_PARAMS: JsonSchema = {
    type: 'object',
    required: ['key', 'value'],
    properties: {key: VARIABLE_KEY, value: VARIABLE_VALUE}
};

export const VARIABLES_DELETE_PARAMS = VARIABLES_GET_PARAMS;

const LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: VARIABLE_ENTRY},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const VARIABLES_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'variables',
    {
        kind: 'fleet-manager',
        description:
            'Manage fleet-manager action substitution variables stored server-side.'
    }
)
    .registerMethod('List', {
        params: VARIABLES_LIST_PARAMS,
        response: LIST_ENVELOPE,
        permission: {component: 'actions', operation: 'read'},
        description: 'List every action variable in the standard list envelope.'
    })
    .registerMethod('Get', {
        params: VARIABLES_GET_PARAMS,
        response: {
            type: 'object',
            required: ['key', 'value'],
            properties: {
                key: VARIABLE_KEY,
                value: {type: ['string', 'null']}
            }
        },
        permission: {component: 'actions', operation: 'read'},
        description: 'Return one action variable by key, or null if absent.'
    })
    .registerMethod('Set', {
        params: VARIABLES_SET_PARAMS,
        response: VARIABLE_ENTRY,
        permission: {component: 'actions', operation: 'update'},
        description: 'Upsert an action variable. Idempotent per (key).'
    })
    .registerMethod('Delete', {
        params: VARIABLES_DELETE_PARAMS,
        response: {
            type: 'object',
            required: ['deleted'],
            properties: {deleted: {type: 'boolean'}}
        },
        permission: {component: 'actions', operation: 'delete'},
        description: 'Remove an action variable by key.'
    })
    .build();
