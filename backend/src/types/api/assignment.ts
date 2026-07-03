/**
 * Public API types for the `assignment.*` namespace — persona attachments.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export const SCOPE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        all: {type: 'boolean'},
        device_ids: {type: 'array', items: {type: 'string', minLength: 1}},
        location_ids: {type: 'array', items: {type: 'integer', minimum: 1}},
        device_group_ids: {
            type: 'array',
            items: {type: 'integer', minimum: 1}
        },
        device_tags: {type: 'array', items: {type: 'string', minLength: 1}},
        dashboard_ids: {type: 'array', items: {type: 'integer', minimum: 1}},
        plugin_keys: {type: 'array', items: {type: 'string', minLength: 1}},
        waiting_room_ids: {
            type: 'array',
            items: {type: 'string', minLength: 1}
        },
        configuration_keys: {
            type: 'array',
            items: {type: 'string', minLength: 1}
        },
        report_ids: {type: 'array', items: {type: 'integer', minimum: 1}},
        organization_ids: {
            type: 'array',
            items: {type: 'string', minLength: 1}
        },
        alert_ids: {type: 'array', items: {type: 'string', minLength: 1}},
        notification_ids: {
            type: 'array',
            items: {type: 'string', minLength: 1}
        },
        integration_keys: {
            type: 'array',
            items: {type: 'string', minLength: 1}
        },
        automation_ids: {
            type: 'array',
            items: {type: 'string', minLength: 1}
        },
        // CreateScopedPAT only; validated via isKnownActionPattern.
        actions: {
            type: 'array',
            minItems: 1,
            items: {type: 'string', minLength: 1, maxLength: 64}
        }
    }
};

const EMPTY_PARAMS: JsonSchema = {type: 'object', properties: {}};

export type AssignmentSubjectType = 'user' | 'user_group';

// Wire-format for assignment scope. All fields optional, matching SCOPE_SCHEMA.
// `all: true` grants all resources; any field that is set narrows the scope.
export interface AssignmentScope {
    all?: boolean;
    device_ids?: string[];
    location_ids?: number[];
    device_group_ids?: number[];
    device_tags?: string[];
    dashboard_ids?: number[];
    plugin_keys?: string[];
    waiting_room_ids?: string[];
    configuration_keys?: string[];
    report_ids?: number[];
    organization_ids?: string[];
    alert_ids?: string[];
    notification_ids?: string[];
    integration_keys?: string[];
    automation_ids?: string[];
    actions?: string[];
}

export interface AssignmentGrantMetadata {
    reason?: string | null;
    comment?: string | null;
    expiresAt?: string | null;
}

export interface AssignmentCreateParams {
    subjectType: AssignmentSubjectType;
    subjectId: string;
    personaId: string;
    scope: AssignmentScope;
    reason?: string | null;
    comment?: string | null;
    expiresAt?: string | null;
}
export const ASSIGNMENT_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['subjectType', 'subjectId', 'personaId', 'scope'],
    properties: {
        subjectType: {type: 'string', enum: ['user', 'user_group']},
        subjectId: {type: 'string', minLength: 1},
        personaId: {type: 'string', format: 'uuid'},
        scope: SCOPE_SCHEMA,
        reason: {type: ['string', 'null'], minLength: 1, maxLength: 200},
        comment: {type: ['string', 'null'], minLength: 1, maxLength: 1000},
        expiresAt: {type: ['string', 'null'], format: 'date-time'}
    },
    additionalProperties: false
};

export interface AssignmentDeleteParams {
    id: string;
}
export const ASSIGNMENT_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

export interface AssignmentListForSubjectParams {
    subjectType: AssignmentSubjectType;
    subjectId: string;
}
export const ASSIGNMENT_LIST_FOR_SUBJECT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['subjectType', 'subjectId'],
    properties: {
        subjectType: {type: 'string', enum: ['user', 'user_group']},
        subjectId: {type: 'string', minLength: 1}
    },
    additionalProperties: false
};

export interface AssignmentListForPersonaParams {
    personaId: string;
}
export const ASSIGNMENT_LIST_FOR_PERSONA_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['personaId'],
    properties: {personaId: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

// "Shared with" — list assignments whose scope references a specific
// resource ID. Backs the ShareDialog "Shared with" panel.
export type AssignmentResourceType =
    | 'dashboard'
    | 'location'
    | 'group'
    | 'device'
    | 'tag'
    | 'plugin'
    | 'waiting_room'
    | 'configuration'
    | 'report'
    | 'organization'
    | 'alert'
    | 'notification'
    | 'integration'
    | 'automation'
    | 'action';

export interface AssignmentListForResourceParams {
    resourceType: AssignmentResourceType;
    resourceId: string | number;
}
export const ASSIGNMENT_LIST_FOR_RESOURCE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['resourceType', 'resourceId'],
    properties: {
        resourceType: {
            type: 'string',
            enum: [
                'dashboard',
                'location',
                'group',
                'device',
                'tag',
                'plugin',
                'waiting_room',
                'configuration',
                'report',
                'organization',
                'alert',
                'notification',
                'integration',
                'automation',
                'action'
            ]
        },
        resourceId: {type: ['string', 'integer']}
    },
    additionalProperties: false
};

export interface AssignmentListUnusedParams {
    thresholdDays?: number;
}
export const ASSIGNMENT_LIST_UNUSED_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        thresholdDays: {type: 'integer', minimum: 1, maximum: 3650}
    },
    additionalProperties: false
};

export interface AssignmentResponse {
    id: string;
    tenant_id: string;
    subject_type: AssignmentSubjectType;
    subject_id: string;
    persona_id: string;
    scope: AssignmentScope;
    created_at: string;
    created_by: string;
    last_used_at: string | null;
    reason: string | null;
    comment: string | null;
    expires_at: string | null;
}

const ANY_RESPONSE: JsonSchema = {type: 'object', additionalProperties: true};
const ADMIN_PERM = {note: 'admin'};
const READ_PERM = {note: 'authenticated'};

export const ASSIGNMENT_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'assignment',
    {
        kind: 'fleet-manager',
        description:
            'Manage persona assignments — attach, remove, and list scoped grants for users and groups.'
    }
)
    .registerMethod('Describe', {
        params: EMPTY_PARAMS,
        response: ANY_RESPONSE,
        permission: {note: 'public'},
        description: 'Component metadata.'
    })
    .registerMethod('Create', {
        params: ASSIGNMENT_CREATE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description: 'Attach a persona to a user or group with scope.'
    })
    .registerMethod('Delete', {
        params: ASSIGNMENT_DELETE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description: 'Remove an assignment.'
    })
    .registerMethod('ListForSubject', {
        params: ASSIGNMENT_LIST_FOR_SUBJECT_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'List assignments attached to a specific user or group.'
    })
    .registerMethod('ListForPersona', {
        params: ASSIGNMENT_LIST_FOR_PERSONA_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'List subjects that have a given persona attached.'
    })
    .registerMethod('ListForResource', {
        params: ASSIGNMENT_LIST_FOR_RESOURCE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description:
            'List assignments whose scope references a specific resource. ' +
            'Backs the ShareDialog "Shared with" panel.'
    })
    .registerMethod('ListUnused', {
        params: ASSIGNMENT_LIST_UNUSED_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description:
            'List assignments unused for thresholdDays (defaults to ' +
            'FM_AUTHZ_UNUSED_THRESHOLD_DAYS). Used by the least-privilege ' +
            'recommender to suggest revokes.'
    })
    .build();
