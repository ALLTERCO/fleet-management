import type {JsonSchema} from './_schema';

export type StatementEffect = 'Allow' | 'Deny';
export type EffectiveStatementSource =
    | 'built-in-jwt'
    | 'group-assignment'
    | 'user-assignment';

export interface StatementCondition {
    mfa?: {required?: boolean};
    ip?: {cidrs?: string[]};
    time?: {window?: {start: string; end: string}};
}

export interface EffectiveScope {
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
}

export interface EffectiveStatement {
    actions: string[];
    notActions?: string[];
    resourceTypes: string[];
    notResourceTypes?: string[];
    scope: EffectiveScope;
    effect: StatementEffect;
    condition?: StatementCondition;
    source?: EffectiveStatementSource;
    persona?: string;
    assignmentId?: string;
    assignmentExpiresAt?: number;
    subjectType?: 'user' | 'user_group';
    subjectId?: string;
    grantorId?: string;
}

export interface EffectiveShape {
    statements: EffectiveStatement[];
}

export interface EffectiveAccessProvenance {
    source: EffectiveStatementSource;
    persona?: string;
    assignmentId?: string;
    subjectType?: 'user' | 'user_group';
    subjectId?: string;
    grantorId?: string;
    expiresAt?: number;
    actions: string[];
    resourceTypes: string[];
    scope: EffectiveScope;
    effect: StatementEffect;
}

export interface EffectiveAccessRoleSummary {
    baseRoles: string[];
    directAssignments: EffectiveAccessProvenance[];
    groupAssignments: EffectiveAccessProvenance[];
}

const SCOPE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        all: {type: 'boolean'},
        device_ids: {type: 'array', items: {type: 'string'}},
        location_ids: {type: 'array', items: {type: 'integer'}},
        device_group_ids: {type: 'array', items: {type: 'integer'}},
        device_tags: {type: 'array', items: {type: 'string'}},
        dashboard_ids: {type: 'array', items: {type: 'integer'}},
        plugin_keys: {type: 'array', items: {type: 'string'}},
        waiting_room_ids: {type: 'array', items: {type: 'string'}},
        configuration_keys: {type: 'array', items: {type: 'string'}},
        report_ids: {type: 'array', items: {type: 'integer'}},
        organization_ids: {type: 'array', items: {type: 'string'}},
        alert_ids: {type: 'array', items: {type: 'string'}},
        notification_ids: {type: 'array', items: {type: 'string'}},
        integration_keys: {type: 'array', items: {type: 'string'}},
        automation_ids: {type: 'array', items: {type: 'string'}}
    }
};

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
                cidrs: {type: 'array', items: {type: 'string'}}
            }
        },
        time: {
            type: 'object',
            additionalProperties: false,
            properties: {
                window: {
                    type: 'object',
                    required: ['start', 'end'],
                    additionalProperties: false,
                    properties: {
                        start: {type: 'string'},
                        end: {type: 'string'}
                    }
                }
            }
        }
    }
};

const STATEMENT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['actions', 'resourceTypes', 'scope', 'effect'],
    additionalProperties: false,
    properties: {
        actions: {type: 'array', items: {type: 'string'}},
        notActions: {type: 'array', items: {type: 'string'}},
        resourceTypes: {type: 'array', items: {type: 'string'}},
        notResourceTypes: {type: 'array', items: {type: 'string'}},
        scope: SCOPE_SCHEMA,
        effect: {type: 'string', enum: ['Allow', 'Deny']},
        condition: CONDITION_SCHEMA,
        source: {
            type: 'string',
            enum: ['built-in-jwt', 'group-assignment', 'user-assignment']
        },
        persona: {type: 'string'},
        assignmentId: {type: 'string'},
        assignmentExpiresAt: {type: 'number'},
        subjectType: {type: 'string', enum: ['user', 'user_group']},
        subjectId: {type: 'string'},
        grantorId: {type: 'string'}
    }
};

export const EFFECTIVE_SHAPE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['statements'],
    additionalProperties: false,
    properties: {
        statements: {type: 'array', items: STATEMENT_SCHEMA}
    }
};
