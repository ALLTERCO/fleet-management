import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export type OperationJobKind =
    | 'certificate'
    | 'credential'
    | 'backup'
    | 'firmware';
export type OperationJobStatus = 'queued' | 'running' | 'done' | 'failed';
export type OperationJobControlState =
    | 'active'
    | 'cancel_requested'
    | 'stopped'
    | 'completed';

export interface OperationJobControlSnapshot {
    state: OperationJobControlState;
    queuedCount: number;
    claimedCount: number;
    dispatchedCount: number;
    stoppedCount: number;
    unresolvedCount: number;
    cancelRequestedAt: string | null;
}

export interface OperationJobSnapshot {
    id: string;
    kind: OperationJobKind;
    status: OperationJobStatus;
    total: number;
    doneCount: number;
    failCount: number;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
    createdBy: string | null;
    metadata: Record<string, unknown>;
    control?: OperationJobControlSnapshot;
}

export interface OperationJobListActiveParams {
    kinds?: OperationJobKind[];
    limit?: number;
}

export interface OperationJobGetParams {
    jobId: string;
    kind?: OperationJobKind;
}

export type OperationJobControlParams = OperationJobGetParams;

export interface OperationJobActionCapability {
    supported: boolean;
    reason?: string;
}

export interface OperationJobCapabilitiesResponse {
    kind: OperationJobKind;
    inspect: OperationJobActionCapability;
    cancel: OperationJobActionCapability;
    resume: OperationJobActionCapability;
}

export interface OperationJobListResponse {
    items: OperationJobSnapshot[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

const JOB_KIND_SCHEMA: JsonSchema = {
    type: 'string',
    enum: ['certificate', 'credential', 'backup', 'firmware']
};

const JOB_SNAPSHOT_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'kind',
        'status',
        'total',
        'doneCount',
        'failCount',
        'createdAt',
        'startedAt',
        'endedAt',
        'createdBy',
        'metadata'
    ],
    additionalProperties: false,
    properties: {
        id: {type: 'string', minLength: 1},
        kind: JOB_KIND_SCHEMA,
        status: {
            type: 'string',
            enum: ['queued', 'running', 'done', 'failed']
        },
        total: {type: 'integer', minimum: 0},
        doneCount: {type: 'integer', minimum: 0},
        failCount: {type: 'integer', minimum: 0},
        createdAt: {type: 'string', minLength: 1},
        startedAt: {type: ['string', 'null']},
        endedAt: {type: ['string', 'null']},
        createdBy: {type: ['string', 'null']},
        metadata: {type: 'object', additionalProperties: true},
        control: {
            type: 'object',
            required: [
                'state',
                'queuedCount',
                'claimedCount',
                'dispatchedCount',
                'stoppedCount',
                'unresolvedCount',
                'cancelRequestedAt'
            ],
            additionalProperties: false,
            properties: {
                state: {
                    type: 'string',
                    enum: ['active', 'cancel_requested', 'stopped', 'completed']
                },
                queuedCount: {type: 'integer', minimum: 0},
                claimedCount: {type: 'integer', minimum: 0},
                dispatchedCount: {type: 'integer', minimum: 0},
                stoppedCount: {type: 'integer', minimum: 0},
                unresolvedCount: {type: 'integer', minimum: 0},
                cancelRequestedAt: {type: ['string', 'null']}
            }
        }
    }
};

export const JOB_LIST_ACTIVE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        kinds: {
            type: 'array',
            items: JOB_KIND_SCHEMA,
            minItems: 1,
            maxItems: 10
        },
        limit: {type: 'integer', minimum: 1, maximum: 100}
    }
};

export const JOB_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['jobId'],
    additionalProperties: false,
    properties: {
        jobId: {type: 'string', minLength: 1},
        kind: JOB_KIND_SCHEMA
    }
};

export const JOB_CONTROL_PARAMS_SCHEMA = JOB_GET_PARAMS_SCHEMA;

const JOB_ACTION_CAPABILITY_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['supported'],
    additionalProperties: false,
    properties: {
        supported: {type: 'boolean'},
        reason: {type: 'string'}
    }
};

export const JOB_CAPABILITIES_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['kind', 'inspect', 'cancel', 'resume'],
    additionalProperties: false,
    properties: {
        kind: JOB_KIND_SCHEMA,
        inspect: JOB_ACTION_CAPABILITY_SCHEMA,
        cancel: JOB_ACTION_CAPABILITY_SCHEMA,
        resume: JOB_ACTION_CAPABILITY_SCHEMA
    }
};

export const JOB_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    additionalProperties: false,
    properties: {
        items: {type: 'array', items: JOB_SNAPSHOT_SCHEMA},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 1},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};

export const JOB_DESCRIBE: DescribeOutput = new DescribeBuilder('job', {
    kind: 'fleet-manager',
    description: 'List and read backend-owned operation jobs for the tenant.'
})
    .registerMethod('ListActive', {
        safety: {operation: 'read'},
        params: JOB_LIST_ACTIVE_PARAMS_SCHEMA,
        response: JOB_LIST_RESPONSE_SCHEMA,
        permission: {note: 'admin'},
        description:
            'Restore active backend-owned operation jobs for the current tenant.'
    })
    .registerMethod('Get', {
        safety: {operation: 'read'},
        params: JOB_GET_PARAMS_SCHEMA,
        response: JOB_SNAPSHOT_SCHEMA,
        permission: {note: 'admin'},
        description:
            'Read one backend-owned operation job by id in the current tenant.'
    })
    .registerMethod('Capabilities', {
        safety: {operation: 'read'},
        params: JOB_CONTROL_PARAMS_SCHEMA,
        response: JOB_CAPABILITIES_RESPONSE_SCHEMA,
        permission: {note: 'admin'},
        description:
            'Read the safe control actions currently available for one job.'
    })
    .registerMethod('Cancel', {
        safety: {operation: 'update', idempotent: true},
        params: JOB_CONTROL_PARAMS_SCHEMA,
        response: JOB_SNAPSHOT_SCHEMA,
        permission: {note: 'admin'},
        description: 'Stop remaining undispatched job work.'
    })
    .registerMethod('Resume', {
        safety: {operation: 'update', idempotent: true},
        params: JOB_CONTROL_PARAMS_SCHEMA,
        response: JOB_SNAPSHOT_SCHEMA,
        permission: {note: 'admin'},
        description:
            'Resume only stopped work known not to have been dispatched.'
    })
    .build();
