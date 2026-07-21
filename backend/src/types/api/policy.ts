/** Public API types for the `policy.*` namespace — runtime-editable per-type defaults. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {ORG_ID_SCHEMA} from './_shared';
import {ALERT_SEVERITIES, type AlertSeverity} from './alert';
import {GROUP_TYPES, type GroupType} from './group';

export const POLICY_FIELD_KEYS = [
    'severityFloor',
    'retentionDays',
    'auditRetentionDays'
] as const;
export type PolicyFieldKey = (typeof POLICY_FIELD_KEYS)[number];

export const POLICY_SOURCES = [
    'env-seed',
    'admin',
    'env-reset',
    'unset'
] as const;
export type PolicySource = (typeof POLICY_SOURCES)[number];

export interface PolicyField<T> {
    current: T | null;
    envDefault: T | null;
    source: PolicySource;
    lastUpdatedAt: string;
    lastUpdatedBy: string | null;
}

export interface GroupTypePolicy {
    groupType: GroupType;
    severityFloor: PolicyField<AlertSeverity>;
    retentionDays: PolicyField<number>;
    auditRetentionDays: PolicyField<number>;
}

export interface PolicyDefaults {
    items: GroupTypePolicy[];
    envFallback: {
        retentionFallbackDays: number;
        auditRetentionFallbackDays: number;
        sweepIntervalMinutes: number;
    };
}

const POLICY_SOURCE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...POLICY_SOURCES]
};

const SEVERITY_NULLABLE_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    enum: [...ALERT_SEVERITIES, null]
};

// Retention days are cast to INT4 in the group policy resolvers; an unbounded
// value overflows that cast and breaks every reader. Cap at 9 digits to keep
// it inside INT4. Matches the DB CHECK regex on groups + group_type_policy.
export const RETENTION_DAYS_MAX = 999_999_999;

const POSITIVE_INT_NULLABLE_SCHEMA: JsonSchema = {
    type: ['integer', 'null'],
    minimum: 1,
    maximum: RETENTION_DAYS_MAX
};

function policyFieldSchema(valueSchema: JsonSchema): JsonSchema {
    return {
        type: 'object',
        required: [
            'current',
            'envDefault',
            'source',
            'lastUpdatedAt',
            'lastUpdatedBy'
        ],
        properties: {
            current: valueSchema,
            envDefault: valueSchema,
            source: POLICY_SOURCE_SCHEMA,
            lastUpdatedAt: {type: 'string'},
            lastUpdatedBy: {type: ['string', 'null']}
        }
    };
}

const GROUP_TYPE_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'groupType',
        'severityFloor',
        'retentionDays',
        'auditRetentionDays'
    ],
    properties: {
        groupType: {type: 'string', enum: [...GROUP_TYPES]},
        severityFloor: policyFieldSchema(SEVERITY_NULLABLE_SCHEMA),
        retentionDays: policyFieldSchema(POSITIVE_INT_NULLABLE_SCHEMA),
        auditRetentionDays: policyFieldSchema(POSITIVE_INT_NULLABLE_SCHEMA)
    }
};

const ENV_FALLBACK_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'retentionFallbackDays',
        'auditRetentionFallbackDays',
        'sweepIntervalMinutes'
    ],
    properties: {
        retentionFallbackDays: {type: 'integer', minimum: 1},
        auditRetentionFallbackDays: {type: 'integer', minimum: 1},
        sweepIntervalMinutes: {type: 'integer', minimum: 1}
    }
};

export const POLICY_GETDEFAULTS_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {organizationId: ORG_ID_SCHEMA}
};

export const POLICY_GETDEFAULTS_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['items', 'envFallback'],
    properties: {
        items: {type: 'array', items: GROUP_TYPE_POLICY_SCHEMA},
        envFallback: ENV_FALLBACK_SCHEMA
    }
};

export const POLICY_UPDATE_DEFAULTS_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['groupType'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        groupType: {type: 'string', enum: [...GROUP_TYPES]},
        severityFloor: SEVERITY_NULLABLE_SCHEMA,
        retentionDays: POSITIVE_INT_NULLABLE_SCHEMA,
        auditRetentionDays: POSITIVE_INT_NULLABLE_SCHEMA,
        ifUnchangedSince: {type: 'string', format: 'date-time'}
    }
};

export const POLICY_RESETDEFAULT_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['groupType', 'fields'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        groupType: {type: 'string', enum: [...GROUP_TYPES]},
        fields: {
            type: 'array',
            minItems: 1,
            items: {type: 'string', enum: [...POLICY_FIELD_KEYS]}
        }
    }
};

export const POLICY_DESCRIBE: DescribeOutput = new DescribeBuilder('policy', {
    kind: 'fleet-manager',
    description:
        'Read and write runtime-editable per-group-type policy defaults.'
})
    .registerMethod('GetDefaults', {
        params: POLICY_GETDEFAULTS_PARAMS,
        response: POLICY_GETDEFAULTS_RESPONSE,
        permission: {component: 'notifications', operation: 'read'},
        description:
            'Read per-type policy defaults (current DB value + env default + source + audit fields).'
    })
    .registerMethod('UpdateDefaults', {
        safety: {operation: 'update'},
        params: POLICY_UPDATE_DEFAULTS_PARAMS,
        response: GROUP_TYPE_POLICY_SCHEMA,
        permission: {
            note: 'provider-support-only — writes the global policy table (no org partition); affects every tenant'
        },
        description:
            'provider-support-only partial update of one groupType row. null clears (falls through to env); omitted = no change. Optional ifUnchangedSince for optimistic concurrency (409 PolicyDefaultsStaleUpdate on conflict).'
    })
    .registerMethod('ResetDefault', {
        safety: {operation: 'update'},
        params: POLICY_RESETDEFAULT_PARAMS,
        response: GROUP_TYPE_POLICY_SCHEMA,
        permission: {
            note: 'provider-support-only — writes the global policy table (no org partition); affects every tenant'
        },
        description:
            'provider-support-only. Rewrites one or more fields of a groupType with the current env value; logged as source=env-reset. Empty env value clears the DB row.'
    })
    .build();
