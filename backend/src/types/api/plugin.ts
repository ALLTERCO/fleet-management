/**
 * Public API types for the `plugin.*` namespace — plugin manager (not
 * individual plugin-generated components).
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export const PLUGIN_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {}
};

const PLUGIN_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name'],
    properties: {
        name: {type: 'string'},
        version: {type: 'string'},
        description: {type: 'string'},
        config: {type: ['object', 'null'], additionalProperties: true}
    },
    additionalProperties: true
};

export const PLUGIN_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: PLUGIN_ENTRY_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const PLUGIN_UPLOAD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['data'],
    properties: {
        data: {
            type: 'string',
            maxLength: 67_108_864,
            description: 'base64 zip, capped ~50 MB decoded'
        }
    }
};

export const PLUGIN_UPLOAD_RESPONSE_SCHEMA: JsonSchema = {type: 'null'};

export const PLUGIN_REMOVE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name'],
    properties: {name: {type: 'string', minLength: 1}}
};

export const PLUGIN_REMOVE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true
};

export const PLUGIN_DESCRIBE: DescribeOutput = new DescribeBuilder('plugin', {
    kind: 'fleet-manager',
    description:
        'Manage server-side plugins: list, upload, and remove fleet-wide plugin code.'
})
    .registerMethod('List', {
        safety: {operation: 'read'},
        params: PLUGIN_LIST_PARAMS_SCHEMA,
        response: PLUGIN_LIST_RESPONSE_SCHEMA,
        permission: {note: 'authenticated; non-admin configs redacted'},
        description:
            'List registered plugins with metadata + config (redacted for non-admins).'
    })
    .registerMethod('Upload', {
        safety: {operation: 'create'},
        params: PLUGIN_UPLOAD_PARAMS_SCHEMA,
        response: PLUGIN_UPLOAD_RESPONSE_SCHEMA,
        permission: {
            note: 'provider-support-only — installs code that runs fleet-wide inside the FM process'
        },
        description: 'Upload a base64-encoded plugin zip (max 50 MB decoded).'
    })
    .registerMethod('Remove', {
        safety: {operation: 'delete'},
        params: PLUGIN_REMOVE_PARAMS_SCHEMA,
        response: PLUGIN_REMOVE_RESPONSE_SCHEMA,
        permission: {
            note: 'provider-support-only — removes code that runs fleet-wide inside the FM process'
        },
        description:
            'Remove an installed plugin by name (symlink-safe path validation).'
    })
    .build();
