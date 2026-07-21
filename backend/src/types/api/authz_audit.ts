// API types for authz_audit.* (read-only audit trail).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const EMPTY_PARAMS: JsonSchema = {type: 'object', properties: {}};

// Canonical audit actions + target types. Single source of truth.
export const AUTHZ_AUDIT_TARGET_TYPES = [
    'persona',
    'user_group',
    'assignment',
    'certificate',
    'credential',
    'user',
    'variable',
    'alert_instance',
    'report_config',
    'report',
    'notification_template',
    'notification_destination'
] as const;

export type AuthzAuditTargetType = (typeof AUTHZ_AUDIT_TARGET_TYPES)[number];

export const AUTHZ_AUDIT_ACTIONS = [
    'persona.create',
    'persona.update',
    'persona.delete',
    'user_group.create',
    'user_group.update',
    'user_group.delete',
    'user_group.add_members',
    'user_group.remove_members',
    'assignment.create',
    'assignment.delete',
    'assignment.reject',
    'permission.grant_roles',
    'permission.revoke_roles',
    'certificate.import',
    'certificate.import_existing',
    'certificate.update',
    'certificate.delete',
    'certificate.export',
    'certificate.issue_device_cert',
    'certificate.push',
    'credential.set',
    'credential.rotate',
    'credential.clear',
    'credential.reveal',
    'credential.confirm_old',
    'credential.retry',
    'user.create',
    'user.update',
    'user.delete',
    'variable.set',
    'variable.delete',
    'alert_instance.ack',
    'alert_instance.unack',
    'alert_instance.silence',
    'alert_instance.unsilence',
    'alert_instance.resolve_manual',
    'report_config.create',
    'report_config.delete',
    'report.generated',
    'report.downloaded',
    'notification_template.create',
    'notification_template.update',
    'notification_template.delete',
    'notification_destination.create',
    'notification_destination.update',
    'notification_destination.delete',
    'notification_destination.add_members',
    'notification_destination.remove_members'
] as const;

export type AuthzAuditAction = (typeof AUTHZ_AUDIT_ACTIONS)[number];

export interface AuthzAuditListParams {
    from?: string;
    to?: string;
    actorId?: string;
    action?: string;
    targetType?: AuthzAuditTargetType;
    targetId?: string;
    limit?: number;
    offset?: number;
}

export const AUTHZ_AUDIT_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        from: {type: 'string', format: 'date-time'},
        to: {type: 'string', format: 'date-time'},
        actorId: {type: 'string', minLength: 1},
        action: {type: 'string', minLength: 1},
        targetType: {
            type: 'string',
            enum: [...AUTHZ_AUDIT_TARGET_TYPES]
        },
        targetId: {type: 'string', minLength: 1},
        limit: {type: 'integer', minimum: 1, maximum: 1000},
        offset: {type: 'integer', minimum: 0}
    },
    additionalProperties: false
};

export interface AuthzAuditEntry {
    id: string;
    tenant_id: string | null;
    actor_id: string;
    action: string;
    target_type: string;
    target_id: string;
    payload: Record<string, unknown> | null;
    created_at: string;
}

const ANY_RESPONSE: JsonSchema = {type: 'object', additionalProperties: true};
const READ_PERM = {note: 'admin'};

export const AUTHZ_AUDIT_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'authz_audit',
    {
        kind: 'fleet-manager',
        description:
            'Query the authorization audit trail of persona, group, and permission changes.'
    }
)
    .registerMethod('Describe', {
        params: EMPTY_PARAMS,
        response: ANY_RESPONSE,
        permission: {note: 'public'},
        description: 'Component metadata.'
    })
    .registerMethod('List', {
        safety: {operation: 'read'},
        params: AUTHZ_AUDIT_LIST_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description:
            'List authz audit entries scoped to current tenant. ' +
            'Supports filtering by time range, actor, action, target.'
    })
    .build();
