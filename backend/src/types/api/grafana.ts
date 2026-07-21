/**
 * Public API types for the `grafana.*` namespace — embedded-dashboard metadata.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export const GRAFANA_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {}
};

export const GRAFANA_GET_CONFIG_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    description:
        'Grafana integration config snapshot (datasource, folder, dashboards).',
    properties: {
        ds: {type: 'object', additionalProperties: true},
        folder: {type: 'object', additionalProperties: true},
        dashboards: {type: 'array', items: {type: 'object'}}
    },
    additionalProperties: true
};

export const GRAFANA_GET_DASHBOARD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['slug'],
    properties: {
        slug: {type: 'string', minLength: 1}
    }
};

export const GRAFANA_GET_DASHBOARD_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    description: 'Single dashboard entry by slug (or undefined).',
    additionalProperties: true
};

export const GRAFANA_DESCRIBE: DescribeOutput = new DescribeBuilder('grafana', {
    kind: 'fleet-manager',
    description:
        'Serve embedded Grafana dashboard metadata and config snapshots.'
})
    .registerMethod('GetConfig', {
        safety: {operation: 'read'},
        params: GRAFANA_GET_CONFIG_PARAMS_SCHEMA,
        response: GRAFANA_GET_CONFIG_RESPONSE_SCHEMA,
        permission: {note: 'authenticated — viewer-visible'},
        description: 'Return the Grafana integration config snapshot.'
    })
    .registerMethod('GetDashboard', {
        safety: {operation: 'read'},
        params: GRAFANA_GET_DASHBOARD_PARAMS_SCHEMA,
        response: GRAFANA_GET_DASHBOARD_RESPONSE_SCHEMA,
        permission: {note: 'authenticated — viewer-visible'},
        description: 'Return a single dashboard entry filtered by slug.'
    })
    .build();
