/**
 * Public API types for the `persona.*` namespace — authz personas.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const CONDITION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        mfa: {
            type: 'object',
            additionalProperties: false,
            properties: {required: {type: 'boolean'}}
        },
        ip: {
            type: 'object',
            additionalProperties: false,
            properties: {
                cidrs: {
                    type: 'array',
                    items: {type: 'string', minLength: 1, maxLength: 64}
                }
            }
        },
        time: {
            type: 'object',
            additionalProperties: false,
            properties: {
                window: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['start', 'end'],
                    properties: {
                        start: {type: 'string', minLength: 1, maxLength: 32},
                        end: {type: 'string', minLength: 1, maxLength: 32}
                    }
                }
            }
        }
    }
};

const STATEMENT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['actions', 'resource_types', 'effect'],
    additionalProperties: false,
    properties: {
        actions: {type: 'array', items: {type: 'string'}, minItems: 1},
        not_actions: {type: 'array', items: {type: 'string'}},
        resource_types: {type: 'array', items: {type: 'string'}, minItems: 1},
        not_resource_types: {type: 'array', items: {type: 'string'}},
        effect: {type: 'string', enum: ['Allow', 'Deny']},
        condition: CONDITION_SCHEMA
    }
};

const STATEMENTS_SCHEMA: JsonSchema = {
    type: 'array',
    items: STATEMENT_SCHEMA,
    minItems: 1
};

const EMPTY_PARAMS: JsonSchema = {type: 'object', properties: {}};

export type PersonaStatementEffect = 'Allow' | 'Deny';

export interface PersonaStatementCondition {
    mfa?: {required?: boolean};
    ip?: {cidrs?: string[]};
    time?: {window?: {start: string; end: string}};
}

export interface PersonaStatement {
    actions: string[];
    not_actions?: string[];
    resource_types: string[];
    not_resource_types?: string[];
    effect: PersonaStatementEffect;
    condition?: PersonaStatementCondition;
}

export interface PersonaListParams {
    includeSystem?: boolean;
}
export const PERSONA_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        includeSystem: {type: 'boolean'}
    },
    additionalProperties: false
};

export interface PersonaGetParams {
    id: string;
}
export const PERSONA_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

export interface PersonaCreateParams {
    key: string;
    name: string;
    description?: string;
    statements: PersonaStatement[];
}
export const PERSONA_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['key', 'name', 'statements'],
    properties: {
        key: {type: 'string', minLength: 1, maxLength: 64},
        name: {type: 'string', minLength: 1, maxLength: 128},
        description: {type: 'string', maxLength: 512},
        statements: STATEMENTS_SCHEMA
    },
    additionalProperties: false
};

export interface PersonaUpdateParams {
    id: string;
    name?: string;
    // Pass `null` to clear the description.
    description?: string | null;
    statements?: PersonaStatement[];
}
export const PERSONA_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        name: {type: 'string', minLength: 1, maxLength: 128},
        description: {type: ['string', 'null'], maxLength: 512},
        statements: STATEMENTS_SCHEMA
    },
    additionalProperties: false
};

export interface PersonaDeleteParams {
    id: string;
}
export const PERSONA_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

export interface PersonaResponse {
    id: string;
    tenant_id: string | null;
    key: string;
    name: string;
    description: string | null;
    is_system_managed: boolean;
    statements: PersonaStatement[];
    version: number;
    created_at: string;
    updated_at: string;
}

const ANY_RESPONSE: JsonSchema = {type: 'object', additionalProperties: true};
const ADMIN_PERM = {note: 'admin'};
const READ_PERM = {note: 'authenticated'};

export const PERSONA_DESCRIBE: DescribeOutput = new DescribeBuilder('persona', {
    kind: 'fleet-manager',
    description:
        'Manage authorization personas and their permission statements.'
})
    .registerMethod('Describe', {
        params: EMPTY_PARAMS,
        response: ANY_RESPONSE,
        permission: {note: 'public'},
        description: 'Component metadata.'
    })
    .registerMethod('List', {
        safety: {operation: 'read'},
        params: PERSONA_LIST_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'List personas (system + custom).'
    })
    .registerMethod('Get', {
        safety: {operation: 'read'},
        params: PERSONA_GET_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'Fetch a persona by id.'
    })
    .registerMethod('Create', {
        safety: {operation: 'create'},
        params: PERSONA_CREATE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description: 'Create a custom persona.'
    })
    .registerMethod('Update', {
        safety: {operation: 'update'},
        params: PERSONA_UPDATE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description: 'Update a custom persona.'
    })
    .registerMethod('Delete', {
        safety: {operation: 'delete'},
        params: PERSONA_DELETE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Delete a custom persona (refuses if assignments reference).'
    })
    .build();
