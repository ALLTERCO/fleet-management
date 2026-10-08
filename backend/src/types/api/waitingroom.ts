/**
 * Public API types for the `waitingroom.*` namespace — device admission.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {listResponseSchema} from './_shared';
import {
    DEVICE_INGRESS_PROFILE_ID_SCHEMA,
    DEVICE_INGRESS_REJECTION_REASON_SCHEMA,
    DEVICE_INGRESS_RISK_LEVEL_SCHEMA,
    DEVICE_INGRESS_SECURITY_MODEL_SCHEMA,
    DEVICE_INGRESS_TRANSPORT_SCHEMA,
    type DeviceIngressProfileId,
    type DeviceIngressRejectionReason,
    type DeviceIngressRiskLevel,
    type DeviceIngressSecurityModel,
    type DeviceIngressTransport
} from './deviceIngress';

const EMPTY_PARAMS: JsonSchema = {type: 'object', properties: {}};
const ENTRY_ID_SCHEMA: JsonSchema = {type: 'string', minLength: 1};
const WAITING_ROOM_STATES = [
    'open',
    'approved',
    'rejected',
    'expired'
] as const;
const WAITING_ROOM_SOURCES = ['legacy', 'device_ingress'] as const;

export const WAITINGROOM_GET_PENDING_PARAMS_SCHEMA = EMPTY_PARAMS;
export const WAITINGROOM_GET_DENIED_PARAMS_SCHEMA = EMPTY_PARAMS;
export interface WaitingRoomListParams {
    state?: (typeof WAITING_ROOM_STATES)[number];
    source?: (typeof WAITING_ROOM_SOURCES)[number];
    observedTransport?: DeviceIngressTransport;
    securityModel?: DeviceIngressSecurityModel;
    riskLevel?: DeviceIngressRiskLevel;
    limit?: number;
    offset?: number;
}
export const WAITINGROOM_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        state: {type: 'string', enum: [...WAITING_ROOM_STATES]},
        source: {type: 'string', enum: [...WAITING_ROOM_SOURCES]},
        observedTransport: DEVICE_INGRESS_TRANSPORT_SCHEMA,
        securityModel: DEVICE_INGRESS_SECURITY_MODEL_SCHEMA,
        riskLevel: DEVICE_INGRESS_RISK_LEVEL_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    }
};
export const WAITINGROOM_GET_COUNTS_PARAMS_SCHEMA =
    WAITINGROOM_LIST_PARAMS_SCHEMA;
export const WAITINGROOM_LIST_DENIED_PARAMS_SCHEMA =
    WAITINGROOM_LIST_PARAMS_SCHEMA;

export interface WaitingRoomEntryParams {
    entryId: string;
}
export const WAITINGROOM_ENTRY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['entryId'],
    additionalProperties: false,
    properties: {entryId: ENTRY_ID_SCHEMA}
};

export interface WaitingRoomApproveParams {
    entryId: string;
    action?: 'bind_existing_device' | 'create_new_device' | 'bind_connector';
    deviceId?: string;
    profileId?: DeviceIngressProfileId;
    groupId?: number;
}
export const WAITINGROOM_APPROVE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['entryId'],
    additionalProperties: false,
    properties: {
        entryId: ENTRY_ID_SCHEMA,
        action: {
            type: 'string',
            enum: [
                'bind_existing_device',
                'create_new_device',
                'bind_connector'
            ]
        },
        deviceId: {type: 'string', minLength: 1},
        profileId: DEVICE_INGRESS_PROFILE_ID_SCHEMA,
        groupId: {type: 'integer'}
    }
};

export interface WaitingRoomRejectParams {
    entryId: string;
    reasonCode?: DeviceIngressRejectionReason;
    detail?: string;
}
export const WAITINGROOM_REJECT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['entryId'],
    additionalProperties: false,
    properties: {
        entryId: ENTRY_ID_SCHEMA,
        reasonCode: DEVICE_INGRESS_REJECTION_REASON_SCHEMA,
        detail: {
            type: 'string',
            minLength: 1,
            maxLength: 1024,
            description:
                'Optional free-text note saved with the rejection, next to reasonCode.'
        }
    }
};

const COUNTS_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['pendingCount'],
    properties: {
        pendingCount: {type: 'integer', minimum: 0}
    }
};

export interface WaitingRoomAcceptByIdParams {
    ids: number[];
    groupId?: number;
}
export const WAITINGROOM_ACCEPT_BY_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['ids'],
    properties: {
        ids: {type: 'array', items: {type: 'integer', minimum: 1}, minItems: 1},
        groupId: {type: 'integer'}
    }
};

export interface WaitingRoomAcceptByExternalIdParams {
    externalIds: string[];
    groupId?: number;
}
// Bounds request and progress-record size; well above the per-org room cap.
const ACCEPT_EXTERNAL_IDS_MAX = 5000;
export const WAITINGROOM_ACCEPT_BY_EXTERNAL_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['externalIds'],
    properties: {
        externalIds: {
            type: 'array',
            items: {type: 'string', minLength: 1},
            minItems: 1,
            maxItems: ACCEPT_EXTERNAL_IDS_MAX
        },
        groupId: {type: 'integer'}
    }
};

export interface WaitingRoomAcceptResponse {
    success: Array<number | string>;
    error: Array<number | string>;
    acceptedIds: number[];
    acceptedExternalIds: string[];
    pendingCount: number;
}

export type WaitingRoomAcceptBulkStartParams =
    WaitingRoomAcceptByExternalIdParams;
export const WAITINGROOM_ACCEPT_BULK_START_PARAMS_SCHEMA =
    WAITINGROOM_ACCEPT_BY_EXTERNAL_ID_PARAMS_SCHEMA;

// Accept-all takes no id list — the server resolves every open pending entry.
export interface WaitingRoomAcceptAllStartParams {
    groupId?: number;
}
export const WAITINGROOM_ACCEPT_ALL_START_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        groupId: {type: 'integer'}
    }
};

export interface WaitingRoomJobRefParams {
    jobId: string;
}
export const WAITINGROOM_JOB_REF_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['jobId'],
    additionalProperties: false,
    properties: {jobId: {type: 'string', minLength: 1}}
};

export type WaitingRoomBulkAcceptState =
    | 'running'
    | 'done'
    | 'canceled'
    | 'error';

export interface WaitingRoomBulkAcceptStartResponse {
    jobId: string;
    total: number;
}

export interface WaitingRoomBulkAcceptStatus {
    jobId: string;
    total: number;
    processed: number;
    accepted: number;
    failed: string[];
    state: WaitingRoomBulkAcceptState;
    startedAt: number;
    updatedAt: number;
}

export interface WaitingRoomBulkCancelResponse {
    canceled: boolean;
}

export interface WaitingRoomRejectPendingParams {
    shellyIDs: string[];
}
export const WAITINGROOM_REJECT_PENDING_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyIDs'],
    properties: {
        shellyIDs: {
            type: 'array',
            items: {type: 'string', minLength: 1},
            minItems: 1
        }
    }
};

export interface WaitingRoomQuarantineParams {
    shellyIDs: string[];
}
export const WAITINGROOM_QUARANTINE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyIDs'],
    properties: {
        shellyIDs: {
            type: 'array',
            items: {type: 'string', minLength: 1},
            minItems: 1
        }
    }
};

const ACCEPT_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'success',
        'error',
        'acceptedIds',
        'acceptedExternalIds',
        'pendingCount'
    ],
    properties: {
        success: {
            type: 'array',
            items: {type: ['integer', 'string']}
        },
        error: {
            type: 'array',
            items: {type: ['integer', 'string']}
        },
        acceptedIds: {
            type: 'array',
            items: {type: 'integer', minimum: 1}
        },
        acceptedExternalIds: {
            type: 'array',
            items: {type: 'string', minLength: 1}
        },
        pendingCount: {type: 'integer', minimum: 0}
    },
    additionalProperties: false
};

const BULK_START_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['jobId', 'total'],
    additionalProperties: false,
    properties: {
        jobId: {type: 'string'},
        total: {type: 'integer', minimum: 0}
    }
};

const BULK_STATUS_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'jobId',
        'total',
        'processed',
        'accepted',
        'failed',
        'state',
        'startedAt',
        'updatedAt'
    ],
    additionalProperties: false,
    properties: {
        jobId: {type: 'string'},
        total: {type: 'integer', minimum: 0},
        processed: {type: 'integer', minimum: 0},
        accepted: {type: 'integer', minimum: 0},
        failed: {type: 'array', items: {type: 'string'}},
        state: {
            type: 'string',
            enum: ['running', 'done', 'canceled', 'error']
        },
        startedAt: {type: 'integer'},
        updatedAt: {type: 'integer'}
    }
};

const BULK_CANCEL_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['canceled'],
    additionalProperties: false,
    properties: {canceled: {type: 'boolean'}}
};

// One canonical entry. Legacy and device-ingress rows share these keys and each
// carries its own extras on top, so the schema stays open.
const ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    required: [
        'source',
        'waitingRoomKind',
        'entryId',
        'shellyID',
        'status',
        'sortTime'
    ],
    properties: {
        source: {type: 'string', enum: [...WAITING_ROOM_SOURCES]},
        waitingRoomKind: {type: 'string', enum: [...WAITING_ROOM_SOURCES]},
        entryId: ENTRY_ID_SCHEMA,
        shellyID: {type: 'string'},
        status: {},
        sortTime: {type: 'integer'}
    }
};

const LIST_ENVELOPE = listResponseSchema(ENTRY_SCHEMA);

const PENDING_MAP: JsonSchema = {
    type: 'object',
    description: 'Map of entryId → open waiting-room entry.',
    additionalProperties: ENTRY_SCHEMA
};

// Denied rows keep only the sanitized device status, not the full entry.
const DENIED_MAP: JsonSchema = {
    type: 'object',
    description: 'Map of Shelly external id → sanitized denied-device payload.',
    additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['status'],
        properties: {shellyID: {type: 'string'}, status: {type: 'object'}}
    }
};

// Rejecting or quarantining a batch reports each id as done or failed.
const BATCH_ID_RESULT: JsonSchema = {
    type: 'object',
    required: ['success', 'error'],
    additionalProperties: false,
    properties: {
        success: {type: 'array', items: {type: 'string'}},
        error: {type: 'array', items: {type: 'string'}}
    }
};

// Legacy entries have no live socket, so they answer with the stored status
// instead of a fresh device read.
const PROBE_RESPONSE: JsonSchema = {
    anyOf: [
        {
            type: 'object',
            additionalProperties: false,
            required: ['source', 'live', 'status'],
            properties: {
                source: {type: 'string', const: 'legacy'},
                live: {type: 'boolean', const: false},
                status: {}
            }
        },
        {
            type: 'object',
            additionalProperties: false,
            required: ['deviceInfo', 'status'],
            properties: {deviceInfo: {}, status: {}}
        }
    ]
};

// Approve and Reject route by entryId: a legacy id runs the batch path, a
// device-ingress id runs the identity path.
const APPROVE_RESPONSE: JsonSchema = {
    anyOf: [
        ACCEPT_RESPONSE,
        {
            type: 'object',
            additionalProperties: false,
            required: ['identity', 'waitingRoom'],
            properties: {
                identity: {type: 'object', additionalProperties: true},
                waitingRoom: {
                    anyOf: [
                        {type: 'object', additionalProperties: true},
                        {type: 'null'}
                    ]
                }
            }
        }
    ]
};

const REJECT_RESPONSE: JsonSchema = {
    anyOf: [
        BATCH_ID_RESULT,
        {
            type: 'object',
            additionalProperties: false,
            required: ['success', 'entry', 'rejection'],
            properties: {
                success: {type: 'boolean', const: true},
                entry: {type: 'object', additionalProperties: true},
                rejection: {type: 'object', additionalProperties: true}
            }
        }
    ]
};

export const WAITINGROOM_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'waitingroom',
    {
        kind: 'fleet-manager',
        description:
            'Manage the fleet-manager device admission waiting room (pending devices).'
    }
)
    .registerMethod('GetPending', {
        safety: {operation: 'read'},
        params: WAITINGROOM_GET_PENDING_PARAMS_SCHEMA,
        response: PENDING_MAP,
        permission: {note: 'authenticated'},
        description: 'Raw map keyed by internal id — kept for legacy callers.'
    })
    .registerMethod('GetDenied', {
        safety: {operation: 'read'},
        params: WAITINGROOM_GET_DENIED_PARAMS_SCHEMA,
        response: DENIED_MAP,
        permission: {note: 'authenticated'},
        description: 'Raw denied-devices map — kept for legacy callers.'
    })
    .registerMethod('GetCounts', {
        params: WAITINGROOM_GET_COUNTS_PARAMS_SCHEMA,
        response: COUNTS_RESPONSE,
        permission: {component: 'waiting_room', operation: 'read'},
        description:
            'Lightweight waiting-room counters for badges and launch sync.'
    })
    .registerMethod('List', {
        safety: {operation: 'read'},
        params: WAITINGROOM_LIST_PARAMS_SCHEMA,
        response: LIST_ENVELOPE,
        permission: {note: 'authenticated'},
        description:
            'Canonical waiting-room list across legacy and device-ingress rows.'
    })
    .registerMethod('Get', {
        params: WAITINGROOM_ENTRY_PARAMS_SCHEMA,
        response: ENTRY_SCHEMA,
        permission: {component: 'waiting_room', operation: 'read'},
        description: 'Get one canonical waiting-room entry by entryId.'
    })
    .registerMethod('Probe', {
        params: WAITINGROOM_ENTRY_PARAMS_SCHEMA,
        response: PROBE_RESPONSE,
        permission: {component: 'waiting_room', operation: 'read'},
        description: 'Probe one live waiting-room device when a socket exists.'
    })
    .registerMethod('ListDenied', {
        safety: {operation: 'read'},
        params: WAITINGROOM_LIST_DENIED_PARAMS_SCHEMA,
        response: LIST_ENVELOPE,
        permission: {note: 'authenticated'},
        description: 'Denied devices in the standard list envelope.'
    })
    .registerMethod('AcceptPendingById', {
        params: WAITINGROOM_ACCEPT_BY_ID_PARAMS_SCHEMA,
        response: ACCEPT_RESPONSE,
        permission: {component: 'waiting_room', operation: 'create'},
        description: 'Accept pending devices by numeric waiting-room id.'
    })
    .registerMethod('AcceptPendingByExternalId', {
        params: WAITINGROOM_ACCEPT_BY_EXTERNAL_ID_PARAMS_SCHEMA,
        response: ACCEPT_RESPONSE,
        permission: {component: 'waiting_room', operation: 'create'},
        description: 'Accept pending devices by Shelly external id.'
    })
    .registerMethod('Approve', {
        params: WAITINGROOM_APPROVE_PARAMS_SCHEMA,
        response: APPROVE_RESPONSE,
        permission: {component: 'waiting_room', operation: 'create'},
        description:
            'Canonical approve by entryId. Legacy entries use shellyID; device-ingress entries use deviceIngress:<uuid>.'
    })
    .registerMethod('AcceptBulkStart', {
        params: WAITINGROOM_ACCEPT_BULK_START_PARAMS_SCHEMA,
        response: BULK_START_RESPONSE,
        permission: {component: 'waiting_room', operation: 'create'},
        description:
            'Start a background bulk accept by external id. Returns a jobId; poll AcceptBulkStatus for progress.'
    })
    .registerMethod('AcceptAllStart', {
        params: WAITINGROOM_ACCEPT_ALL_START_PARAMS_SCHEMA,
        response: BULK_START_RESPONSE,
        permission: {component: 'waiting_room', operation: 'create'},
        description:
            'Start a background bulk accept of every open pending device for the org — no id list needed. Returns a jobId; poll AcceptBulkStatus.'
    })
    .registerMethod('AcceptBulkStatus', {
        params: WAITINGROOM_JOB_REF_PARAMS_SCHEMA,
        response: BULK_STATUS_RESPONSE,
        permission: {component: 'waiting_room', operation: 'read'},
        description:
            'Progress of a bulk accept job: total, processed, accepted, failed ids, state.'
    })
    .registerMethod('AcceptBulkCancel', {
        params: WAITINGROOM_JOB_REF_PARAMS_SCHEMA,
        response: BULK_CANCEL_RESPONSE,
        permission: {component: 'waiting_room', operation: 'create'},
        description:
            'Request cancellation of a running bulk accept job; processed chunks stay accepted.'
    })
    .registerMethod('RejectPending', {
        params: WAITINGROOM_REJECT_PENDING_PARAMS_SCHEMA,
        response: BATCH_ID_RESULT,
        permission: {component: 'waiting_room', operation: 'delete'},
        description:
            'Reject pending devices by numeric id (polite close — reversible).'
    })
    .registerMethod('Reject', {
        params: WAITINGROOM_REJECT_PARAMS_SCHEMA,
        response: REJECT_RESPONSE,
        permission: {component: 'waiting_room', operation: 'delete'},
        description:
            'Canonical reject by entryId. Legacy entries use shellyID; device-ingress entries use deviceIngress:<uuid>.'
    })
    .registerMethod('Quarantine', {
        params: WAITINGROOM_QUARANTINE_PARAMS_SCHEMA,
        response: BATCH_ID_RESULT,
        permission: {component: 'waiting_room', operation: 'delete'},
        description:
            'Destructive: rewrite device WS config + reboot. Recovery requires factory-reset on the device. Reserved for adversarial / hammering cases.'
    })
    .build();
