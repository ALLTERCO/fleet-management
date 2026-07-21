/**
 * Public API types for the `admin.*` namespace — DB method introspection
 * and command listing. Device RPC relay lives on `device.Call`.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export type AdminListCommandsParams = Record<string, never>;
export const ADMIN_LIST_COMMANDS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const ADMIN_LIST_COMMANDS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total'],
    properties: {
        items: {type: 'array', items: {type: 'string'}},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export interface AdminPostgresCallParams {
    name: string;
    args?: Record<string, unknown>;
    txId?: number;
}
export const ADMIN_POSTGRES_CALL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
        name: {type: 'string', minLength: 1},
        args: {type: 'object', additionalProperties: true},
        txId: {type: 'integer'}
    }
};

export const ADMIN_POSTGRES_CALL_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true
};

export type AdminReconcileDevicesParams = Record<string, never>;
export const ADMIN_RECONCILE_DEVICES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const ADMIN_RECONCILE_DEVICES_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['registered'],
    additionalProperties: false,
    properties: {
        registered: {type: 'integer'}
    }
};

export const ADMIN_DESCRIBE: DescribeOutput = new DescribeBuilder('admin', {
    kind: 'fleet-manager',
    description:
        'Introspect registered RPC commands and invoke allowlisted PostgresProvider methods (super-admin).'
})
    .registerMethod('ListCommands', {
        safety: {operation: 'read'},
        params: ADMIN_LIST_COMMANDS_PARAMS_SCHEMA,
        response: ADMIN_LIST_COMMANDS_RESPONSE_SCHEMA,
        permission: {note: 'authenticated'},
        description: 'List every registered RPC namespace/command.'
    })
    .registerMethod('PostgresCall', {
        safety: {effectDependsOnInput: true},
        params: ADMIN_POSTGRES_CALL_PARAMS_SCHEMA,
        response: ADMIN_POSTGRES_CALL_RESPONSE_SCHEMA,
        permission: {
            note: 'provider-support-only — allowlisted DB functions accept cross-org args; tenant admins must use the typed RPCs'
        },
        description:
            'Invoke an allowlisted PostgresProvider method. Super-admin recovery only.'
    })
    .registerMethod('ReconcileDevices', {
        safety: {operation: 'execute', idempotent: true, destructive: false},
        params: ADMIN_RECONCILE_DEVICES_PARAMS_SCHEMA,
        response: ADMIN_RECONCILE_DEVICES_RESPONSE_SCHEMA,
        permission: {note: 'tenant-admin'},
        description:
            'Register saved devices not yet in memory. Picks up devices inserted out-of-band without an FM restart; leaves connected devices untouched.'
    })
    .build();
