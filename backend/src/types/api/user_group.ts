/**
 * Public API types for the `user_group.*` namespace — user collections
 * for permission inheritance. Distinct from the `group.*` namespace which
 * is device grouping.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const EMPTY_PARAMS: JsonSchema = {type: 'object', properties: {}};

export type UserGroupListParams = Record<string, never>;
export const USER_GROUP_LIST_PARAMS_SCHEMA = EMPTY_PARAMS;

export interface UserGroupGetParams {
    id: string;
}
export const USER_GROUP_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

export interface UserGroupCreateParams {
    name: string;
    description?: string;
    parentGroupId?: string | null;
}
export const USER_GROUP_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name'],
    properties: {
        name: {type: 'string', minLength: 1, maxLength: 128},
        description: {type: 'string', maxLength: 512},
        parentGroupId: {type: ['string', 'null'], format: 'uuid'}
    },
    additionalProperties: false
};

export interface UserGroupUpdateParams {
    id: string;
    name?: string;
    // Pass `null` to clear the description.
    description?: string | null;
    // Pass `null` to detach from the current parent.
    parentGroupId?: string | null;
}
export const USER_GROUP_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        name: {type: 'string', minLength: 1, maxLength: 128},
        description: {type: ['string', 'null'], maxLength: 512},
        parentGroupId: {type: ['string', 'null'], format: 'uuid'}
    },
    additionalProperties: false
};

export interface UserGroupDeleteParams {
    id: string;
}
export const USER_GROUP_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

export interface UserGroupListMembersParams {
    id: string;
}
export const USER_GROUP_LIST_MEMBERS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

export interface UserGroupAddMembersParams {
    id: string;
    userIds: string[];
}
export const USER_GROUP_ADD_MEMBERS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'userIds'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        userIds: {
            type: 'array',
            items: {type: 'string', minLength: 1},
            minItems: 1
        }
    },
    additionalProperties: false
};

export interface UserGroupRemoveMembersParams {
    id: string;
    userIds: string[];
}
export const USER_GROUP_REMOVE_MEMBERS_PARAMS_SCHEMA =
    USER_GROUP_ADD_MEMBERS_PARAMS_SCHEMA;

export interface UserGroupResponse {
    id: string;
    tenant_id: string;
    name: string;
    description: string | null;
    parent_group_id: string | null;
    member_count: number;
    created_at: string;
}

const ANY_RESPONSE: JsonSchema = {type: 'object', additionalProperties: true};
const ADMIN_PERM = {note: 'admin'};
const READ_PERM = {note: 'authenticated'};

export const USER_GROUP_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'user_group',
    {
        kind: 'fleet-manager',
        description:
            'Manage fleet-manager user groups for permission inheritance.'
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
        params: USER_GROUP_LIST_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'List user groups in current tenant.'
    })
    .registerMethod('Get', {
        safety: {operation: 'read'},
        params: USER_GROUP_GET_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'Fetch a user group by id.'
    })
    .registerMethod('Create', {
        safety: {operation: 'create'},
        params: USER_GROUP_CREATE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description: 'Create a new user group.'
    })
    .registerMethod('Update', {
        safety: {operation: 'update'},
        params: USER_GROUP_UPDATE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description: 'Update user group metadata.'
    })
    .registerMethod('Delete', {
        safety: {operation: 'delete'},
        params: USER_GROUP_DELETE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Delete user group (cascades memberships, refuses if assignments reference).'
    })
    .registerMethod('ListMembers', {
        safety: {operation: 'read'},
        params: USER_GROUP_LIST_MEMBERS_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'List user IDs that belong to this user group.'
    })
    .registerMethod('AddMembers', {
        safety: {operation: 'update'},
        params: USER_GROUP_ADD_MEMBERS_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description: 'Add users to user group. Idempotent.'
    })
    .registerMethod('RemoveMembers', {
        safety: {operation: 'update'},
        params: USER_GROUP_REMOVE_MEMBERS_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description: 'Remove users from user group. Idempotent.'
    })
    .build();
