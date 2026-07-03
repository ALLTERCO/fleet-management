/** Analytics namespace — investigation flows over the same EM tables that
 *  power Energy.Query, exposing per-device attribution for brush-to-compare
 *  on time-series + heatmap charts. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {DASHBOARD_SCOPE_SCHEMA, type DashboardScope} from './fleet';

export const ATTRIBUTE_METRICS = [
    'consumption',
    'power',
    'voltage',
    'temperature'
] as const;
export type AttributeMetric = (typeof ATTRIBUTE_METRICS)[number];

export const ATTRIBUTE_AGGREGATIONS = ['sum', 'avg', 'max', 'latest'] as const;
export type AttributeAggregation = (typeof ATTRIBUTE_AGGREGATIONS)[number];

export const ATTRIBUTE_WINDOW_MAX_DAYS = 90;
export const ATTRIBUTE_WINDOW_DEFAULT_TOP_N = 10;
export const ATTRIBUTE_WINDOW_MAX_TOP_N = 50;

export interface AttributeWindowQuery {
    metric: AttributeMetric;
    from: string;
    to: string;
    scope?: DashboardScope;
    devices?: string[];
    topN?: number;
    aggregation?: AttributeAggregation;
}

export interface Contributor {
    deviceId: number;
    shellyID: string;
    deviceName: string;
    value: number;
    share: number;
    sampleCount: number;
}

export interface AttributeWindowResult {
    metric: AttributeMetric;
    from: string;
    to: string;
    aggregation: AttributeAggregation;
    unit: string;
    totalValue: number;
    contributors: Contributor[];
    truncated: boolean;
    truncatedCount: number;
}

export const ATTRIBUTE_WINDOW_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['metric', 'from', 'to'],
    properties: {
        metric: {type: 'string', enum: [...ATTRIBUTE_METRICS]},
        from: {type: 'string', minLength: 1},
        to: {type: 'string', minLength: 1},
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {
            type: 'array',
            items: {type: 'string', minLength: 1},
            minItems: 1,
            maxItems: 200
        },
        topN: {
            type: 'integer',
            minimum: 1,
            maximum: ATTRIBUTE_WINDOW_MAX_TOP_N
        },
        aggregation: {type: 'string', enum: [...ATTRIBUTE_AGGREGATIONS]}
    }
};

const CONTRIBUTOR_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'deviceId',
        'shellyID',
        'deviceName',
        'value',
        'share',
        'sampleCount'
    ],
    properties: {
        deviceId: {type: 'integer', minimum: 1},
        shellyID: {type: 'string'},
        deviceName: {type: 'string'},
        value: {type: 'number'},
        share: {type: 'number', minimum: 0, maximum: 1},
        sampleCount: {type: 'integer', minimum: 0}
    }
};

export const ATTRIBUTE_WINDOW_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'metric',
        'from',
        'to',
        'aggregation',
        'unit',
        'totalValue',
        'contributors',
        'truncated',
        'truncatedCount'
    ],
    properties: {
        metric: {type: 'string'},
        from: {type: 'string'},
        to: {type: 'string'},
        aggregation: {type: 'string'},
        unit: {type: 'string'},
        totalValue: {type: 'number'},
        contributors: {type: 'array', items: CONTRIBUTOR_SCHEMA},
        truncated: {type: 'boolean'},
        truncatedCount: {type: 'integer', minimum: 0}
    }
};

export const ANALYTICS_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'analytics',
    {
        kind: 'fleet-manager',
        description:
            'Investigate energy metrics — per-device contributor breakdown over a time window.'
    }
)
    .registerMethod('AttributeWindow', {
        params: ATTRIBUTE_WINDOW_PARAMS_SCHEMA,
        response: ATTRIBUTE_WINDOW_RESPONSE_SCHEMA,
        permission: {component: 'analytics', operation: 'read'},
        description:
            'Per-device contributor breakdown for a time window on a chosen metric — drives brush-to-compare on time-series + heatmap charts.'
    })
    .build();
