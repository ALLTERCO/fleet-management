/**
 * Public API types for the `credential.*` namespace — device admin password store.
 *
 * Rotation is operator-initiated only — no auto-rotation cron. Failed pushes
 * are listed via credential.list_failed and recoverable via retry / confirm_old.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export const CREDENTIAL_ROTATION_STATUSES = [
    'ok',
    'failed',
    'unknown'
] as const;
export type CredentialRotationStatus =
    (typeof CREDENTIAL_ROTATION_STATUSES)[number];

export const CREDENTIAL_ROTATION_STATUS_LABELS: Record<
    CredentialRotationStatus,
    string
> = {
    ok: 'OK',
    failed: 'Failed',
    unknown: 'Unknown'
};

export type CredentialPushStatus =
    | 'queued'
    | 'in_progress'
    | 'ok'
    | 'failed'
    | 'unknown';

export interface DeviceCredentialResponse {
    id: string;
    tenant_id: string;
    device_id: string;
    username: string;
    realm: string;
    rotated_at: string;
    rotated_by: string | null;
    last_rotation_status: CredentialRotationStatus;
    last_rotation_error: string | null;
}

export interface CredentialListParams {
    deviceId?: string;
    status?: CredentialRotationStatus;
    limit?: number;
    offset?: number;
}
export const CREDENTIAL_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        deviceId: {type: 'string', minLength: 1},
        status: {type: 'string', enum: ['ok', 'failed', 'unknown']},
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    },
    additionalProperties: false
};

export interface CredentialGetParams {
    deviceId: string;
}
export const CREDENTIAL_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deviceId'],
    properties: {deviceId: {type: 'string', minLength: 1}},
    additionalProperties: false
};

export interface CredentialRevealParams {
    deviceId: string;
    justification?: string;
}
export const CREDENTIAL_REVEAL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deviceId'],
    properties: {
        deviceId: {type: 'string', minLength: 1},
        justification: {type: 'string', maxLength: 500}
    },
    additionalProperties: false
};

export interface CredentialRotateTarget {
    deviceIds?: string[];
    groupIds?: number[];
    tagKeys?: string[];
}
export const CREDENTIAL_TARGET_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        deviceIds: {type: 'array', items: {type: 'string', minLength: 1}},
        groupIds: {type: 'array', items: {type: 'integer', minimum: 1}},
        tagKeys: {type: 'array', items: {type: 'string', minLength: 1}}
    },
    additionalProperties: false
};

export interface CredentialRotateParams {
    target: CredentialRotateTarget;
    includeFlagged?: boolean;
}
export const CREDENTIAL_ROTATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['target'],
    properties: {
        target: CREDENTIAL_TARGET_SCHEMA,
        includeFlagged: {type: 'boolean'}
    },
    additionalProperties: false
};

export interface CredentialSetParams {
    deviceId: string;
    password: string;
}
export const CREDENTIAL_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deviceId', 'password'],
    properties: {
        deviceId: {type: 'string', minLength: 1},
        password: {type: 'string', minLength: 8, maxLength: 200}
    },
    additionalProperties: false
};

export interface CredentialClearParams {
    target: CredentialRotateTarget;
}
export const CREDENTIAL_CLEAR_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['target'],
    properties: {target: CREDENTIAL_TARGET_SCHEMA},
    additionalProperties: false
};

export interface CredentialRetryParams {
    pushId: number;
}
export const CREDENTIAL_RETRY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['pushId'],
    properties: {pushId: {type: 'integer', minimum: 1}},
    additionalProperties: false
};

export interface CredentialConfirmOldParams {
    pushId: number;
}
export const CREDENTIAL_CONFIRM_OLD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['pushId'],
    properties: {pushId: {type: 'integer', minimum: 1}},
    additionalProperties: false
};

export interface CredentialListFailedParams {
    limit?: number;
    offset?: number;
}
export const CREDENTIAL_LIST_FAILED_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    },
    additionalProperties: false
};

export interface CredentialPushStatusParams {
    jobId: string;
}
export const CREDENTIAL_PUSH_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['jobId'],
    properties: {jobId: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

export interface CredentialListPushesParams {
    deviceId?: string;
    jobId?: string;
    status?: CredentialPushStatus;
    limit?: number;
    offset?: number;
}
export const CREDENTIAL_LIST_PUSHES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        deviceId: {type: 'string', minLength: 1},
        jobId: {type: 'string', format: 'uuid'},
        status: {
            type: 'string',
            enum: ['queued', 'in_progress', 'ok', 'failed', 'unknown']
        },
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    },
    additionalProperties: false
};

export interface CredentialJobResponse {
    id: string;
    tenant_id: string;
    target_summary: unknown;
    mode: 'rotate' | 'set' | 'clear';
    status: 'queued' | 'running' | 'done' | 'failed';
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    created_by: string | null;
}

export interface CredentialPushRow {
    id: number;
    job_id: string;
    device_id: string;
    status: CredentialPushStatus;
    last_error: string | null;
    applied_at: string | null;
    picked_up_at: string | null;
    retry_count: number;
    requested_by: string | null;
}

const EMPTY_PARAMS: JsonSchema = {type: 'object', properties: {}};
const ANY_RESPONSE: JsonSchema = {type: 'object', additionalProperties: true};
const LIST_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {
            type: 'array',
            items: {type: 'object', additionalProperties: true}
        },
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};
const ADMIN_PERM = {note: 'admin'};
const READ_PERM = {note: 'authenticated'};

export const CREDENTIAL_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'credential',
    {
        kind: 'fleet-manager',
        description:
            'Manage and rotate stored device admin passwords and track push status.'
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
        params: CREDENTIAL_LIST_PARAMS_SCHEMA,
        response: LIST_RESPONSE,
        permission: READ_PERM,
        description:
            'List per-device credentials (no plaintext). Filters by device or last_rotation_status.'
    })
    .registerMethod('Get', {
        safety: {operation: 'read'},
        params: CREDENTIAL_GET_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'Single device credential metadata (no plaintext).'
    })
    .registerMethod('Reveal', {
        params: CREDENTIAL_REVEAL_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Admin-only plaintext reveal. Audited every call, rate-limited via FM_CREDENTIAL_REVEAL_PER_ADMIN_PER_DAY.'
    })
    .registerMethod('Rotate', {
        safety: {operation: 'execute'},
        params: CREDENTIAL_ROTATE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Operator-initiated rotation. Generates a strong random password and pushes via Shelly.SetAuth. Failed devices excluded from bulk by default; pass includeFlagged=true to override.'
    })
    .registerMethod('Set', {
        safety: {operation: 'execute'},
        params: CREDENTIAL_SET_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Set a specific password on a single device. Plaintext returned once in response.'
    })
    .registerMethod('Clear', {
        safety: {operation: 'execute'},
        params: CREDENTIAL_CLEAR_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Disable Web UI auth on the target devices via Shelly.SetAuth ha1=null.'
    })
    .registerMethod('Retry', {
        safety: {operation: 'execute'},
        params: CREDENTIAL_RETRY_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Retry a failed push using the stored new ha1. Recovers from transient device errors.'
    })
    .registerMethod('ConfirmOld', {
        safety: {operation: 'update'},
        params: CREDENTIAL_CONFIRM_OLD_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Operator confirms a failed push left the device on its previous password — clears the flag without retrying.'
    })
    .registerMethod('ListFailed', {
        safety: {operation: 'read'},
        params: CREDENTIAL_LIST_FAILED_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'List devices whose last rotation failed (action surface).'
    })
    .registerMethod('PushStatus', {
        safety: {operation: 'read'},
        params: CREDENTIAL_PUSH_STATUS_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description:
            'Polling fallback for credential push job state and per-device rows.'
    })
    .registerMethod('ListPushes', {
        safety: {operation: 'read'},
        params: CREDENTIAL_LIST_PUSHES_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description:
            'List credential push history scoped by device / job / status.'
    })
    .build();
