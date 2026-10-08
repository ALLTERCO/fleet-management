// permission.* — authorization reads + writes (was scattered on user.*).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {listResponseSchema} from './_shared';
import {AUTHZ_SYSTEM_PERSONA_KEYS} from './authzCatalog';

const USER_ID: JsonSchema = {type: 'string', minLength: 1};
const USER_ID_PARAM: JsonSchema = {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {userId: USER_ID}
};

export const PERMISSION_GET_FOR_USER_PARAMS: JsonSchema = USER_ID_PARAM;

// roles[].enum is catalog-driven so unknown role keys fail validation.
export const PERMISSION_GRANT_ROLES_PARAMS: JsonSchema = {
    type: 'object',
    required: ['userId', 'roles'],
    additionalProperties: false,
    properties: {
        userId: USER_ID,
        roles: {
            type: 'array',
            minItems: 1,
            items: {
                type: 'string',
                enum: [...AUTHZ_SYSTEM_PERSONA_KEYS]
            }
        }
    }
};

// Symmetric to GRANT_ROLES — same shape, narrower verb.
export const PERMISSION_REVOKE_ROLES_PARAMS: JsonSchema =
    PERMISSION_GRANT_ROLES_PARAMS;

// Grant/Revoke echo the target and the deduped role set they applied.
const RESP_ROLES_APPLIED: JsonSchema = {
    type: 'object',
    required: ['success', 'userId', 'roles'],
    additionalProperties: false,
    properties: {
        success: {type: 'boolean'},
        userId: USER_ID,
        roles: {
            type: 'array',
            items: {type: 'string', enum: [...AUTHZ_SYSTEM_PERSONA_KEYS]}
        }
    }
};
// Zitadel's project roles filtered to the catalog, so unknown keys never
// reach a caller. The sibling `roles` field is not returned.
const RESP_ROLES: JsonSchema = {
    type: 'object',
    required: ['userId', 'roleKeys'],
    additionalProperties: false,
    properties: {
        userId: USER_ID,
        roleKeys: {
            type: 'array',
            items: {type: 'string', enum: [...AUTHZ_SYSTEM_PERSONA_KEYS]}
        }
    }
};

// The list envelope with fixed limit/offset/has_more — this call never pages.
const RESP_ADMINISTRATORS = listResponseSchema({
    type: 'object',
    required: ['userId', 'roles'],
    additionalProperties: false,
    properties: {
        userId: {type: 'string'},
        preferredLoginName: {type: 'string'},
        organizationId: {type: 'string'},
        organizationName: {type: 'string'},
        roles: {type: 'array', items: {type: 'string'}},
        creationDate: {type: 'string', format: 'date-time'}
    }
});

// Each value is a raw Zitadel settings payload; null means that one fetch
// failed, which is deliberately distinct from an empty config.
const ZITADEL_SETTING: JsonSchema = {
    anyOf: [{type: 'object', additionalProperties: true}, {type: 'null'}]
};

const RESP_IDENTITY_POLICIES: JsonSchema = {
    type: 'object',
    required: [
        'login',
        'passwordComplexity',
        'passwordExpiry',
        'lockout',
        'security',
        'branding',
        'identityProviders'
    ],
    additionalProperties: false,
    properties: {
        login: ZITADEL_SETTING,
        passwordComplexity: ZITADEL_SETTING,
        passwordExpiry: ZITADEL_SETTING,
        lockout: ZITADEL_SETTING,
        security: ZITADEL_SETTING,
        branding: ZITADEL_SETTING,
        identityProviders: {
            anyOf: [
                {
                    type: 'array',
                    items: {type: 'object', additionalProperties: true}
                },
                {type: 'null'}
            ]
        }
    }
};

const EMPTY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};
export const PERMISSION_EMPTY_PARAMS: JsonSchema = EMPTY_PARAMS;

const ADMIN: {note: string} = {note: 'admin-only'};
const SUPER_ADMIN: {note: string} = {
    note: 'provider-support-only — instance-wide Zitadel state'
};

export const PERMISSION_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'permission',
    {
        kind: 'fleet-manager',
        description:
            'Read and write user authorization via Zitadel roles and identity policies.'
    }
)
    .registerMethod('GetRoles', {
        safety: {operation: 'read'},
        params: USER_ID_PARAM,
        response: RESP_ROLES,
        permission: ADMIN,
        description:
            'permission.GetRoles — return Zitadel built-in role keys held by a user.'
    })
    .registerMethod('GrantRoles', {
        safety: {operation: 'update'},
        params: PERMISSION_GRANT_ROLES_PARAMS,
        response: RESP_ROLES_APPLIED,
        permission: ADMIN,
        description:
            'permission.GrantRoles — grant one or more Zitadel built-in roles to a user.'
    })
    .registerMethod('RevokeRoles', {
        safety: {operation: 'update'},
        params: PERMISSION_REVOKE_ROLES_PARAMS,
        response: RESP_ROLES_APPLIED,
        permission: ADMIN,
        description:
            'permission.RevokeRoles — remove one or more Zitadel built-in roles from a user. Deletes the project authorization entirely when no roles remain.'
    })
    .registerMethod('ListAdministrators', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: RESP_ADMINISTRATORS,
        permission: SUPER_ADMIN,
        description:
            'permission.ListAdministrators — list users with administrator role on the resolved organization.'
    })
    .registerMethod('GetIdentityPolicies', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: RESP_IDENTITY_POLICIES,
        permission: SUPER_ADMIN,
        description:
            'permission.GetIdentityPolicies — read Zitadel identity (login/lockout/password) policies.'
    })
    .build();
