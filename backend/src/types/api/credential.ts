/**
 * Public API types for the `credential.*` namespace — device admin password store.
 *
 * Rotation is operator-initiated only — no auto-rotation cron. Failed pushes
 * are listed via credential.list_failed and recoverable via retry / confirm_old.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    keysetListResponseSchema,
    LIST_CURSOR_SCHEMA,
    LIST_OFFSET_SCHEMA,
    listResponseSchema,
    SUCCESS_RESPONSE_SCHEMA
} from './_shared';

export const CREDENTIAL_ROTATION_STATUSES = [
    'ok',
    'failed',
    'unknown'
] as const;
export type CredentialRotationStatus =
    (typeof CREDENTIAL_ROTATION_STATUSES)[number];

const CREDENTIAL_ROTATION_STATUS_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...CREDENTIAL_ROTATION_STATUSES]
};

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

const CREDENTIAL_PUSH_STATUS_SCHEMA: JsonSchema = {
    type: 'string',
    enum: ['queued', 'in_progress', 'ok', 'failed', 'unknown']
};

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
    cursor?: string;
}
export const CREDENTIAL_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        deviceId: {type: 'string', minLength: 1},
        status: CREDENTIAL_ROTATION_STATUS_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: LIST_OFFSET_SCHEMA,
        cursor: LIST_CURSOR_SCHEMA
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

// Same cap as one credential.list page.
export const CREDENTIAL_GET_MANY_MAX_IDS = 500;

export interface CredentialGetManyParams {
    deviceIds: string[];
}
export const CREDENTIAL_GET_MANY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deviceIds'],
    properties: {
        deviceIds: {
            type: 'array',
            items: {type: 'string', minLength: 1},
            minItems: 1,
            maxItems: CREDENTIAL_GET_MANY_MAX_IDS,
            uniqueItems: true
        }
    },
    additionalProperties: false
};

export interface CredentialGetManyResult {
    items: DeviceCredentialResponse[];
    missingIds: string[];
}

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
        status: CREDENTIAL_PUSH_STATUS_SCHEMA,
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
const ADMIN_PERM = {note: 'admin'};
const READ_PERM = {note: 'authenticated'};

// Snake_case throughout: these rows come straight off the fn_credential_*
// SQL functions, column for column. Never carries the password.
const DEVICE_CREDENTIAL_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'tenant_id',
        'device_id',
        'username',
        'realm',
        'rotated_at',
        'rotated_by',
        'last_rotation_status',
        'last_rotation_error'
    ],
    additionalProperties: false,
    properties: {
        id: {type: 'string', format: 'uuid'},
        tenant_id: {type: 'string'},
        device_id: {type: 'string'},
        username: {type: 'string'},
        realm: {type: 'string'},
        rotated_at: {type: 'string', format: 'date-time'},
        rotated_by: {type: ['string', 'null']},
        last_rotation_status: CREDENTIAL_ROTATION_STATUS_SCHEMA,
        last_rotation_error: {type: ['string', 'null']}
    }
};

const CREDENTIAL_GET_MANY_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['items', 'missingIds'],
    additionalProperties: false,
    properties: {
        items: {type: 'array', items: DEVICE_CREDENTIAL_SCHEMA},
        missingIds: {
            type: 'array',
            items: {type: 'string'},
            description:
                'Asked device ids with no active credential in the caller tenant.'
        }
    }
};

const CREDENTIAL_PUSH_ROW_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'job_id',
        'device_id',
        'status',
        'last_error',
        'applied_at',
        'picked_up_at',
        'retry_count',
        'requested_by'
    ],
    additionalProperties: false,
    properties: {
        id: {type: 'integer'},
        job_id: {type: 'string', format: 'uuid'},
        device_id: {type: 'string'},
        status: CREDENTIAL_PUSH_STATUS_SCHEMA,
        last_error: {type: ['string', 'null']},
        applied_at: {type: ['string', 'null'], format: 'date-time'},
        picked_up_at: {type: ['string', 'null'], format: 'date-time'},
        retry_count: {type: 'integer'},
        requested_by: {type: ['string', 'null']}
    }
};

const CREDENTIAL_JOB_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'tenant_id',
        'target_summary',
        'mode',
        'status',
        'started_at',
        'finished_at',
        'created_at',
        'created_by'
    ],
    additionalProperties: false,
    properties: {
        id: {type: 'string', format: 'uuid'},
        tenant_id: {type: 'string'},
        target_summary: {
            type: 'object',
            additionalProperties: true,
            description: 'The target as submitted, e.g. {deviceIds:[...]}.'
        },
        mode: {type: 'string', enum: ['rotate', 'set', 'clear']},
        status: {type: 'string', enum: ['queued', 'running', 'done', 'failed']},
        started_at: {type: ['string', 'null'], format: 'date-time'},
        finished_at: {type: ['string', 'null'], format: 'date-time'},
        created_at: {type: 'string', format: 'date-time'},
        created_by: {type: ['string', 'null']}
    }
};

// The plaintext leaves the server only here and in Set. Camel-case, because
// the handler builds this object rather than reading a row.
const CREDENTIAL_REVEAL_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['deviceId', 'username', 'realm', 'password'],
    additionalProperties: false,
    properties: {
        deviceId: {type: 'string'},
        username: {type: 'string'},
        realm: {type: 'string'},
        password: {type: 'string'}
    }
};

const CREDENTIAL_SET_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['jobId', 'pushId', 'deviceId', 'username', 'realm', 'password'],
    additionalProperties: false,
    properties: {
        jobId: {type: 'string', format: 'uuid'},
        pushId: {type: 'integer'},
        deviceId: {type: 'string'},
        username: {type: 'string'},
        realm: {type: 'string'},
        password: {type: 'string'}
    }
};

// Rotate generates a password per device, so each result carries its own.
const CREDENTIAL_ROTATE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['jobId', 'results'],
    additionalProperties: false,
    properties: {
        jobId: {type: 'string', format: 'uuid'},
        results: {
            type: 'array',
            items: {
                type: 'object',
                required: ['deviceId', 'password', 'pushId'],
                additionalProperties: false,
                properties: {
                    deviceId: {type: 'string'},
                    password: {type: 'string'},
                    pushId: {type: 'integer'}
                }
            }
        }
    }
};

// Clear stages the same push pipeline but sets no password.
const CREDENTIAL_CLEAR_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['jobId', 'results'],
    additionalProperties: false,
    properties: {
        jobId: {type: 'string', format: 'uuid'},
        results: {
            type: 'array',
            items: {
                type: 'object',
                required: ['deviceId', 'pushId'],
                additionalProperties: false,
                properties: {
                    deviceId: {type: 'string'},
                    pushId: {type: 'integer'}
                }
            }
        }
    }
};

const CREDENTIAL_RETRY_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['success', 'pushId'],
    additionalProperties: false,
    properties: {success: {type: 'boolean'}, pushId: {type: 'integer'}}
};

const CREDENTIAL_PUSH_STATUS_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['job', 'rows'],
    additionalProperties: false,
    properties: {
        job: CREDENTIAL_JOB_SCHEMA,
        rows: {type: 'array', items: CREDENTIAL_PUSH_ROW_SCHEMA}
    }
};

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
        response: keysetListResponseSchema(DEVICE_CREDENTIAL_SCHEMA),
        permission: READ_PERM,
        description:
            'List per-device credentials (no plaintext). Filters by device or last_rotation_status. Page with `cursor`; `offset` stops at 10,000.'
    })
    .registerMethod('Get', {
        safety: {operation: 'read'},
        params: CREDENTIAL_GET_PARAMS_SCHEMA,
        response: DEVICE_CREDENTIAL_SCHEMA,
        permission: READ_PERM,
        description: 'Single device credential metadata (no plaintext).'
    })
    .registerMethod('GetMany', {
        safety: {operation: 'read'},
        params: CREDENTIAL_GET_MANY_PARAMS_SCHEMA,
        response: CREDENTIAL_GET_MANY_RESPONSE,
        permission: READ_PERM,
        description: `Credential metadata for up to ${CREDENTIAL_GET_MANY_MAX_IDS} devices in one call (no plaintext). Unknown or retired ids come back in missingIds.`
    })
    .registerMethod('Reveal', {
        params: CREDENTIAL_REVEAL_PARAMS_SCHEMA,
        response: CREDENTIAL_REVEAL_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Admin-only plaintext reveal. Audited every call, rate-limited via FM_CREDENTIAL_REVEAL_PER_ADMIN_PER_DAY.'
    })
    .registerMethod('Rotate', {
        safety: {operation: 'execute'},
        params: CREDENTIAL_ROTATE_PARAMS_SCHEMA,
        response: CREDENTIAL_ROTATE_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Operator-initiated rotation. Generates a strong random password and pushes via Shelly.SetAuth. Failed devices excluded from bulk by default; pass includeFlagged=true to override.'
    })
    .registerMethod('Set', {
        safety: {operation: 'execute'},
        params: CREDENTIAL_SET_PARAMS_SCHEMA,
        response: CREDENTIAL_SET_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Set a specific password on a single device. Plaintext returned once in response.'
    })
    .registerMethod('Clear', {
        safety: {operation: 'execute'},
        params: CREDENTIAL_CLEAR_PARAMS_SCHEMA,
        response: CREDENTIAL_CLEAR_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Disable Web UI auth on the target devices via Shelly.SetAuth ha1=null.'
    })
    .registerMethod('Retry', {
        safety: {operation: 'execute'},
        params: CREDENTIAL_RETRY_PARAMS_SCHEMA,
        response: CREDENTIAL_RETRY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Retry a failed push using the stored new ha1. Recovers from transient device errors.'
    })
    .registerMethod('ConfirmOld', {
        safety: {operation: 'update'},
        params: CREDENTIAL_CONFIRM_OLD_PARAMS_SCHEMA,
        response: SUCCESS_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'Operator confirms a failed push left the device on its previous password — clears the flag without retrying.'
    })
    .registerMethod('ListFailed', {
        safety: {operation: 'read'},
        params: CREDENTIAL_LIST_FAILED_PARAMS_SCHEMA,
        response: listResponseSchema(DEVICE_CREDENTIAL_SCHEMA),
        permission: READ_PERM,
        description: 'List devices whose last rotation failed (action surface).'
    })
    .registerMethod('PushStatus', {
        safety: {operation: 'read'},
        params: CREDENTIAL_PUSH_STATUS_PARAMS_SCHEMA,
        response: CREDENTIAL_PUSH_STATUS_RESPONSE,
        permission: READ_PERM,
        description:
            'Polling fallback for credential push job state and per-device rows.'
    })
    .registerMethod('ListPushes', {
        safety: {operation: 'read'},
        params: CREDENTIAL_LIST_PUSHES_PARAMS_SCHEMA,
        response: listResponseSchema(CREDENTIAL_PUSH_ROW_SCHEMA),
        permission: READ_PERM,
        description:
            'List credential push history scoped by device / job / status.'
    })
    .build();
