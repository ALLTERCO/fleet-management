import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export type ScopedAutomationSchedule =
    | {kind: 'timer'; seconds: number}
    | {kind: 'cron'; expression: string};

export interface ScopedAutomationDefinition {
    name: string;
    deviceIds: string[];
    schedule: ScopedAutomationSchedule;
    method: string;
    params?: Record<string, unknown>;
}

export interface ScopedAutomationRecord extends ScopedAutomationDefinition {
    id: string;
    enabled: boolean;
    state: 'draft' | 'active' | 'revoked' | 'unknown';
    revision: number;
    flowId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ScopedAutomationCreateParams
    extends ScopedAutomationDefinition {
    idempotencyKey: string;
}

export interface ScopedAutomationListParams {
    limit?: number;
    offset?: number;
}

export interface ScopedAutomationUpdateParams
    extends ScopedAutomationDefinition {
    id: string;
    expectedRevision: number;
}

export interface ScopedAutomationIdParams {
    id: string;
}

export interface ScopedAutomationDeleteParams extends ScopedAutomationIdParams {
    expectedRevision: number;
}

export interface ScopedAutomationRunParams extends ScopedAutomationIdParams {
    executionToken: string;
    invocationId?: string;
}

const DEVICE_IDS: JsonSchema = {
    type: 'array',
    minItems: 1,
    maxItems: 100,
    uniqueItems: true,
    items: {type: 'string', minLength: 1, maxLength: 128}
};

const SCHEDULE: JsonSchema = {
    oneOf: [
        {
            type: 'object',
            required: ['kind', 'seconds'],
            additionalProperties: false,
            properties: {
                kind: {const: 'timer'},
                seconds: {type: 'integer', minimum: 1, maximum: 31_536_000}
            }
        },
        {
            type: 'object',
            required: ['kind', 'expression'],
            additionalProperties: false,
            properties: {
                kind: {const: 'cron'},
                expression: {type: 'string', minLength: 1, maxLength: 120}
            }
        }
    ]
};

const DEFINITION_PROPERTIES = {
    name: {type: 'string', minLength: 1, maxLength: 120},
    deviceIds: DEVICE_IDS,
    schedule: SCHEDULE,
    method: {type: 'string', minLength: 3, maxLength: 128},
    params: {type: 'object', additionalProperties: true}
} satisfies Record<string, JsonSchema>;

export const SCOPED_AUTOMATION_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['idempotencyKey', 'name', 'deviceIds', 'schedule', 'method'],
    additionalProperties: false,
    properties: {
        idempotencyKey: {type: 'string', format: 'uuid'},
        ...DEFINITION_PROPERTIES
    }
};

export const SCOPED_AUTOMATION_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        limit: {type: 'integer', minimum: 1, maximum: 100},
        offset: {type: 'integer', minimum: 0}
    }
};

export const SCOPED_AUTOMATION_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'expectedRevision',
        'name',
        'deviceIds',
        'schedule',
        'method'
    ],
    additionalProperties: false,
    properties: {
        id: {type: 'string', minLength: 1},
        expectedRevision: {type: 'integer', minimum: 1},
        ...DEFINITION_PROPERTIES
    }
};

export const SCOPED_AUTOMATION_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: {type: 'string', minLength: 1}}
};

export const SCOPED_AUTOMATION_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'expectedRevision'],
    additionalProperties: false,
    properties: {
        id: {type: 'string', minLength: 1},
        expectedRevision: {type: 'integer', minimum: 1}
    }
};

export const SCOPED_AUTOMATION_RUN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'executionToken'],
    additionalProperties: false,
    properties: {
        id: {type: 'string', minLength: 1},
        executionToken: {type: 'string', minLength: 32, maxLength: 256},
        invocationId: {type: 'string', minLength: 1, maxLength: 128}
    }
};

const RECORD_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'name',
        'deviceIds',
        'schedule',
        'method',
        'params',
        'enabled',
        'state',
        'revision',
        'flowId',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: {type: 'string', format: 'uuid'},
        ...DEFINITION_PROPERTIES,
        params: {type: 'object', additionalProperties: true},
        enabled: {type: 'boolean'},
        state: {
            type: 'string',
            enum: ['draft', 'active', 'revoked', 'unknown']
        },
        revision: {type: 'integer', minimum: 1},
        flowId: {type: ['string', 'null']},
        createdAt: {type: 'string', format: 'date-time'},
        updatedAt: {type: 'string', format: 'date-time'}
    }
};
const LIST_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: RECORD_RESPONSE},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 1, maximum: 100},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};
const DELETE_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'deleted'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        deleted: {const: true}
    }
};
const RUN_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'deviceResults'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        deviceResults: {
            type: 'array',
            maxItems: 100,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['deviceId', 'result'],
                properties: {
                    deviceId: {type: 'string'},
                    result: {}
                }
            }
        }
    }
};
const builder = new DescribeBuilder('scopedautomation', {
    kind: 'fleet-manager',
    description:
        'Create fixed-device scheduled automations that recheck their author authority on every run.'
});

builder.registerMethod('Create', {
    description: 'Create and deploy a device-scoped automation.',
    params: SCOPED_AUTOMATION_CREATE_PARAMS_SCHEMA,
    response: RECORD_RESPONSE,
    permission: {note: 'automation manage plus execute on every named device'},
    safety: {operation: 'create'}
});
builder.registerMethod('List', {
    description: 'List automations owned by the current principal.',
    params: SCOPED_AUTOMATION_LIST_PARAMS_SCHEMA,
    response: LIST_RESPONSE,
    permission: {note: 'owner and originating credential only'},
    safety: {operation: 'read'}
});
builder.registerMethod('Get', {
    description: 'Read an owned automation.',
    params: SCOPED_AUTOMATION_ID_PARAMS_SCHEMA,
    response: RECORD_RESPONSE,
    permission: {note: 'owner and originating credential only'},
    safety: {operation: 'read'}
});
builder.registerMethod('Update', {
    description: 'Replace an owned automation with revision protection.',
    params: SCOPED_AUTOMATION_UPDATE_PARAMS_SCHEMA,
    response: RECORD_RESPONSE,
    permission: {note: 'owner, credential, and current device authority'},
    safety: {operation: 'update'}
});
builder.registerMethod('Delete', {
    description: 'Disable and delete an owned automation.',
    params: SCOPED_AUTOMATION_DELETE_PARAMS_SCHEMA,
    response: DELETE_RESPONSE,
    permission: {note: 'owner and originating credential only'},
    safety: {operation: 'delete', destructive: true}
});
builder.registerMethod('Run', {
    description:
        'Execute once per invocationId and token generation. Completed retries return the stored result; unknown outcomes stay blocked. Omitted invocationId uses one legacy receipt per token generation; update older schedules to generate distinct firing IDs.',
    params: SCOPED_AUTOMATION_RUN_PARAMS_SCHEMA,
    response: RUN_RESPONSE,
    permission: {note: 'opaque execution token plus restored author authority'},
    safety: {operation: 'execute', idempotent: true}
});

export const SCOPED_AUTOMATION_DESCRIBE: DescribeOutput = builder.build();
