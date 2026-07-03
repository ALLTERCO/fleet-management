// Asserts a group's metadata conforms to its kind's schema, read from the kind
// table so built-in and custom kinds validate the same way.
//
// `metadata.policy` is reserved cross-cutting state (severity floor, retention),
// independent of kind: strip it, check it once against POLICY_SCHEMA, so kind
// schemas stay clean.

import RpcError from '../rpc/RpcError';
import {ValidationError, validateParams} from '../rpc/validation';
import type {JsonSchema} from '../types/api/_schema';
import {ALERT_SEVERITIES} from '../types/api/alert';
import {RETENTION_DAYS_MAX} from '../types/api/policy';
import * as kindRepository from './kindRepository';

// Reserved key on group metadata — kind-independent policy overrides.
// Matches the DB CHECK constraints on groups: severityFloor in the alert
// vocabulary, retention/audit retention as positive integers bounded to INT4.
const POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        severityFloor: {type: 'string', enum: [...ALERT_SEVERITIES]},
        retentionDays: {
            type: 'integer',
            minimum: 1,
            maximum: RETENTION_DAYS_MAX
        },
        auditRetentionDays: {
            type: 'integer',
            minimum: 1,
            maximum: RETENTION_DAYS_MAX
        }
    }
};

// Kind id -> its metadata schema, or null if unknown. Injectable for tests.
export type KindSchemaLoader = (
    kindId: string,
    organizationId: string
) => Promise<JsonSchema | null>;

/**
 * Assert `metadata` conforms to the kind's metadata schema. Throws
 * RpcError.InvalidParams on an unknown kind or a schema failure; resolves on
 * success. `metadata` may be undefined — treated as empty object.
 */
export async function assertValidGroupKindMetadata(
    kindId: string,
    organizationId: string,
    metadata: unknown,
    loadSchema: KindSchemaLoader = kindRepository.loadKindSchema
): Promise<void> {
    const schema = await loadSchema(kindId, organizationId);
    if (schema === null) {
        throw RpcError.InvalidParams(`Unknown group kind: '${kindId}'`);
    }
    const raw = (metadata ?? {}) as Record<string, unknown>;
    const {policy, rest} = splitPolicy(raw);
    if (policy !== undefined) {
        assertSchema(policy, POLICY_SCHEMA, `metadata.policy`);
    }
    assertSchema(rest, schema, `metadata for kind '${kindId}'`);
}

// Pull the reserved `policy` key off the metadata bag — leaves the
// kind-specific remainder untouched for the kind schema check.
function splitPolicy(metadata: Record<string, unknown>): {
    policy: unknown;
    rest: Record<string, unknown>;
} {
    if (!Object.hasOwn(metadata, 'policy')) {
        return {policy: undefined, rest: metadata};
    }
    const {policy, ...rest} = metadata;
    return {policy, rest};
}

// Run one schema check; wrap ValidationError as RpcError.InvalidParams so the
// caller sees a single error contract regardless of which axis fired.
function assertSchema(value: unknown, schema: JsonSchema, label: string): void {
    try {
        validateParams(value, schema);
    } catch (err) {
        if (err instanceof ValidationError) {
            throw RpcError.InvalidParams(`${label} failed validation`, [
                ...err.failures
            ]);
        }
        throw err;
    }
}
