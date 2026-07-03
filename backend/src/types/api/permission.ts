// permission.* — authorization reads + writes (was scattered on user.*).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
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

const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['success'],
    properties: {success: {type: 'boolean'}}
};
const RESP_ANY: JsonSchema = {type: 'object', additionalProperties: true};

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
        params: USER_ID_PARAM,
        response: RESP_ANY,
        permission: ADMIN,
        description:
            'permission.GetRoles — return Zitadel built-in role keys held by a user.'
    })
    .registerMethod('GrantRoles', {
        params: PERMISSION_GRANT_ROLES_PARAMS,
        response: RESP_OK,
        permission: ADMIN,
        description:
            'permission.GrantRoles — grant one or more Zitadel built-in roles to a user.'
    })
    .registerMethod('RevokeRoles', {
        params: PERMISSION_REVOKE_ROLES_PARAMS,
        response: RESP_OK,
        permission: ADMIN,
        description:
            'permission.RevokeRoles — remove one or more Zitadel built-in roles from a user. Deletes the project authorization entirely when no roles remain.'
    })
    .registerMethod('ListAdministrators', {
        params: EMPTY_PARAMS,
        response: RESP_ANY,
        permission: SUPER_ADMIN,
        description:
            'permission.ListAdministrators — list users with administrator role on the resolved organization.'
    })
    .registerMethod('GetIdentityPolicies', {
        params: EMPTY_PARAMS,
        response: RESP_ANY,
        permission: SUPER_ADMIN,
        description:
            'permission.GetIdentityPolicies — read Zitadel identity (login/lockout/password) policies.'
    })
    .build();
