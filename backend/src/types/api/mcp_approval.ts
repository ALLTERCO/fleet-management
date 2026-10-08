// API types for mcp_approval.*: the "stop asking" answers a person gave an AI
// agent over MCP, listed and taken back.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {listResponseSchema} from './_shared';

export const MCP_APPROVAL_LIST_SCOPES = ['mine', 'organization'] as const;
export type McpApprovalListScope = (typeof MCP_APPROVAL_LIST_SCOPES)[number];

export interface McpApprovalListParams {
    /** `organization` needs the organization-settings permission. */
    scope?: McpApprovalListScope;
    limit?: number;
    offset?: number;
}

export const MCP_APPROVAL_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        scope: {type: 'string', enum: [...MCP_APPROVAL_LIST_SCOPES]},
        limit: {type: 'integer', minimum: 1, maximum: 1000},
        offset: {type: 'integer', minimum: 0}
    },
    additionalProperties: false
};

export interface McpApprovalRevokeParams {
    id: string;
}

export const MCP_APPROVAL_REVOKE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'string', pattern: '^[0-9a-f]{64}$'}},
    additionalProperties: false
};

export interface McpApprovalEntry {
    id: string;
    userId: string;
    username: string;
    method: string;
    subject: string;
    scope: 'ttl' | 'forever';
    grantedAt: string;
    expiresAt: string;
}

const MCP_APPROVAL_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'userId',
        'username',
        'method',
        'subject',
        'scope',
        'grantedAt',
        'expiresAt'
    ],
    properties: {
        id: {type: 'string', pattern: '^[0-9a-f]{64}$'},
        userId: {type: 'string'},
        username: {type: 'string'},
        method: {type: 'string'},
        subject: {type: 'string'},
        scope: {type: 'string', enum: ['ttl', 'forever']},
        grantedAt: {type: 'string', format: 'date-time'},
        expiresAt: {type: 'string', format: 'date-time'}
    }
};

export interface McpApprovalRevokeResult {
    revoked: boolean;
}

const MCP_APPROVAL_REVOKE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['revoked'],
    properties: {revoked: {type: 'boolean'}}
};

const SELF_OR_ORG_ADMIN = {
    note: 'own approvals; an organization-settings manager reaches the organization'
};

export const MCP_APPROVAL_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'mcp_approval',
    {
        kind: 'fleet-manager',
        description:
            'List and revoke the remembered approvals a person gave AI agents over MCP.'
    }
)
    .registerMethod('List', {
        safety: {operation: 'read'},
        params: MCP_APPROVAL_LIST_PARAMS_SCHEMA,
        response: listResponseSchema(MCP_APPROVAL_ENTRY_SCHEMA),
        permission: SELF_OR_ORG_ADMIN,
        description:
            'List live remembered approvals: your own, or with scope "organization" everyone\'s in your organization.'
    })
    .registerMethod('Revoke', {
        safety: {operation: 'delete', idempotent: true, destructive: false},
        params: MCP_APPROVAL_REVOKE_PARAMS_SCHEMA,
        response: MCP_APPROVAL_REVOKE_RESPONSE_SCHEMA,
        permission: SELF_OR_ORG_ADMIN,
        description:
            'Revoke one remembered approval, so the next matching AI action asks a person again. revoked is false when no such approval is yours to revoke.'
    })
    .build();
