import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export type OperationJobKind =
    | 'certificate'
    | 'credential'
    | 'backup'
    | 'firmware';
export type OperationJobStatus = 'queued' | 'running' | 'done' | 'failed';

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
}

export interface OperationJobListActiveParams {
    kinds?: OperationJobKind[];
    limit?: number;
}

export interface OperationJobGetParams {
    jobId: string;
    kind?: OperationJobKind;
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
        metadata: {type: 'object', additionalProperties: true}
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
        params: JOB_LIST_ACTIVE_PARAMS_SCHEMA,
        response: JOB_LIST_RESPONSE_SCHEMA,
        permission: {note: 'admin'},
        description:
            'Restore active backend-owned operation jobs for the current tenant.'
    })
    .registerMethod('Get', {
        params: JOB_GET_PARAMS_SCHEMA,
        response: JOB_SNAPSHOT_SCHEMA,
        permission: {note: 'admin'},
        description:
            'Read one backend-owned operation job by id in the current tenant.'
    })
    .build();
