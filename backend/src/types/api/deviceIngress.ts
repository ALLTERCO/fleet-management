// deviceIngress.* — trusted device, connector, and provisioning ingress.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {listResponseSchema, SUCCESS_RESPONSE_SCHEMA} from './_shared';

export const DEVICE_INGRESS_SECURITY_MODELS = [
    'certificate',
    'direct_token',
    'connector'
] as const;
export type DeviceIngressSecurityModel =
    (typeof DEVICE_INGRESS_SECURITY_MODELS)[number];

export const DEVICE_INGRESS_TRANSPORTS = [
    'wss',
    'ws',
    'modbus_tcp',
    'ble',
    'cloud_api',
    'connector_internal'
] as const;
export type DeviceIngressTransport = (typeof DEVICE_INGRESS_TRANSPORTS)[number];

export const DEVICE_INGRESS_RISK_LEVELS = [
    'strong',
    'compatible',
    'legacy'
] as const;
export type DeviceIngressRiskLevel =
    (typeof DEVICE_INGRESS_RISK_LEVELS)[number];

export const DEVICE_INGRESS_IDENTITY_STATES = [
    'pending',
    'active',
    'disabled',
    'quarantined',
    'deleted'
] as const;
export type DeviceIngressIdentityState =
    (typeof DEVICE_INGRESS_IDENTITY_STATES)[number];

export const DEVICE_INGRESS_CREDENTIAL_TYPES = [
    'certificate',
    'token'
] as const;
export type DeviceIngressCredentialType =
    (typeof DEVICE_INGRESS_CREDENTIAL_TYPES)[number];

export const DEVICE_INGRESS_CREDENTIAL_STATES = [
    'active',
    'pending',
    'expired',
    'revoked',
    'superseded'
] as const;
export type DeviceIngressCredentialState =
    (typeof DEVICE_INGRESS_CREDENTIAL_STATES)[number];

export const DEVICE_INGRESS_SUBJECT_TYPES = [
    'device',
    'connector',
    'gateway',
    'represented_device'
] as const;
export type DeviceIngressSubjectType =
    (typeof DEVICE_INGRESS_SUBJECT_TYPES)[number];

// How a credential identity is bound to devices: one device, a flat group, or
// a location subtree. Null = org-wide (any device in the org).
export const DEVICE_INGRESS_SCOPE_KINDS = [
    'device',
    'group',
    'location'
] as const;
export type DeviceIngressScopeKind =
    (typeof DEVICE_INGRESS_SCOPE_KINDS)[number];

export const DEVICE_INGRESS_CONNECTION_RESULTS = [
    'accepted',
    'waiting_room',
    'rejected'
] as const;
export type DeviceIngressConnectionResult =
    (typeof DEVICE_INGRESS_CONNECTION_RESULTS)[number];

export const DEVICE_INGRESS_REJECTION_SEVERITIES = [
    'fixable',
    'blocked'
] as const;
export type DeviceIngressRejectionSeverity =
    (typeof DEVICE_INGRESS_REJECTION_SEVERITIES)[number];

export const DEVICE_INGRESS_REJECTION_REASONS = [
    'token_expired',
    'pending_token_not_finalized',
    'certificate_expired',
    'certificate_not_yet_valid',
    'wrong_transport',
    'legacy_ws_disabled',
    'connection_cap_reached',
    'rate_limit_exceeded',
    'identity_disabled',
    'device_not_bound',
    'token_revoked',
    'certificate_revoked',
    'certificate_cross_org',
    'device_id_mismatch',
    'blocked_ip',
    'operator_quarantine',
    'credential_replay_suspected',
    'unknown_security_model',
    'malformed_handshake'
] as const;
export type DeviceIngressRejectionReason =
    (typeof DEVICE_INGRESS_REJECTION_REASONS)[number];

export const DEVICE_INGRESS_APPLY_METHODS = [
    'ble',
    'local_http',
    'ws_rpc',
    'connector',
    'manual'
] as const;
export type DeviceIngressApplyMethod =
    (typeof DEVICE_INGRESS_APPLY_METHODS)[number];

export const DEVICE_INGRESS_PROFILE_IDS = [
    'wall-display-local-ws',
    'shelly-pro-em-wss-token',
    'shelly-pro-em-wss-certificate',
    'modbus-tcp-connector'
] as const;
export type DeviceIngressProfileId =
    (typeof DEVICE_INGRESS_PROFILE_IDS)[number];

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_WRITE = {component: 'devices', operation: 'update' as const};
const PERM_SETUP_WRITE = {
    component: 'devices',
    operation: 'update' as const,
    note: 'devices/update; certificate setup also requires organizations/update'
};

const UUID_SCHEMA: JsonSchema = {type: 'string', format: 'uuid'};
const ID_SCHEMA: JsonSchema = {type: 'string', minLength: 1, maxLength: 160};
const OPTIONAL_ID_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    minLength: 1,
    maxLength: 160
};
const EXTERNAL_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 160,
    pattern: '^[A-Za-z0-9_.:-]+$'
};
const OPTIONAL_EXTERNAL_ID_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    minLength: 1,
    maxLength: 160,
    pattern: '^[A-Za-z0-9_.:-]+$'
};
const DATE_TIME_SCHEMA: JsonSchema = {type: 'string', format: 'date-time'};
const DATE_TIME_NULL_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    format: 'date-time'
};
export const DEVICE_INGRESS_EMPTY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const DEVICE_INGRESS_SECURITY_MODEL_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_SECURITY_MODELS]
};
export const DEVICE_INGRESS_TRANSPORT_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_TRANSPORTS]
};
export const DEVICE_INGRESS_RISK_LEVEL_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_RISK_LEVELS]
};
export const DEVICE_INGRESS_IDENTITY_STATE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_IDENTITY_STATES]
};
export const DEVICE_INGRESS_CREDENTIAL_TYPE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_CREDENTIAL_TYPES]
};
export const DEVICE_INGRESS_CREDENTIAL_STATE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_CREDENTIAL_STATES]
};
export const DEVICE_INGRESS_SUBJECT_TYPE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_SUBJECT_TYPES]
};
export const DEVICE_INGRESS_SCOPE_KIND_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    enum: [...DEVICE_INGRESS_SCOPE_KINDS, null]
};
export const DEVICE_INGRESS_REJECTION_SEVERITY_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_REJECTION_SEVERITIES]
};
export const DEVICE_INGRESS_REJECTION_REASON_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_REJECTION_REASONS]
};
export const DEVICE_INGRESS_PROFILE_ID_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_INGRESS_PROFILE_IDS]
};

export interface DeviceIngressProfile {
    id: DeviceIngressProfileId;
    name: string;
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
    appliesTo: Record<string, unknown>;
    warnings?: string[];
}

export interface DeviceIngressIdentityResponse {
    id: string;
    organizationId: string;
    subjectType: DeviceIngressSubjectType;
    subjectId: string;
    displayName: string;
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
    status: DeviceIngressIdentityState;
    expectedExternalId: string | null;
    scopeKind: DeviceIngressScopeKind | null;
    scopeRef: string | null;
    reportedExternalIds: string[];
    lastSeenAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface DeviceIngressCredentialResponse {
    id: string;
    identityId: string;
    credentialType: DeviceIngressCredentialType;
    state: DeviceIngressCredentialState;
    tokenPrefix: string | null;
    certificateId: string | null;
    certificateFingerprint: string | null;
    notBefore: string | null;
    notAfter: string | null;
    lastUsedAt: string | null;
}

export interface DeviceIngressIdentityCreateParams {
    subjectType: DeviceIngressSubjectType;
    subjectId: string;
    displayName: string;
    securityModel: DeviceIngressSecurityModel;
    transport: DeviceIngressTransport;
    riskLevel: DeviceIngressRiskLevel;
    expectedExternalId?: string | null;
    scopeKind?: DeviceIngressScopeKind | null;
    scopeRef?: string | null;
}
export const DEVICE_INGRESS_IDENTITY_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'subjectType',
        'subjectId',
        'displayName',
        'securityModel',
        'transport',
        'riskLevel'
    ],
    additionalProperties: false,
    properties: {
        subjectType: DEVICE_INGRESS_SUBJECT_TYPE_SCHEMA,
        subjectId: ID_SCHEMA,
        displayName: {type: 'string', minLength: 1, maxLength: 160},
        securityModel: DEVICE_INGRESS_SECURITY_MODEL_SCHEMA,
        transport: DEVICE_INGRESS_TRANSPORT_SCHEMA,
        riskLevel: DEVICE_INGRESS_RISK_LEVEL_SCHEMA,
        expectedExternalId: OPTIONAL_EXTERNAL_ID_SCHEMA,
        scopeKind: DEVICE_INGRESS_SCOPE_KIND_SCHEMA,
        scopeRef: OPTIONAL_ID_SCHEMA
    }
};

export interface DeviceIngressIdentityGetParams {
    id: string;
}
export const DEVICE_INGRESS_IDENTITY_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: UUID_SCHEMA}
};

export interface DeviceIngressIdentityUpdateParams {
    id: string;
    displayName?: string;
    expectedExternalId?: string | null;
}
export const DEVICE_INGRESS_IDENTITY_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: UUID_SCHEMA,
        displayName: {type: 'string', minLength: 1, maxLength: 160},
        expectedExternalId: OPTIONAL_EXTERNAL_ID_SCHEMA
    }
};

export interface DeviceIngressIdentityListParams {
    status?: DeviceIngressIdentityState;
    securityModel?: DeviceIngressSecurityModel;
    transport?: DeviceIngressTransport;
    limit?: number;
    offset?: number;
}
export const DEVICE_INGRESS_IDENTITY_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        status: DEVICE_INGRESS_IDENTITY_STATE_SCHEMA,
        securityModel: DEVICE_INGRESS_SECURITY_MODEL_SCHEMA,
        transport: DEVICE_INGRESS_TRANSPORT_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    }
};

export interface DeviceIngressCredentialCreateTokenParams {
    identityId: string;
    validityDays?: number;
}
export const DEVICE_INGRESS_CREDENTIAL_CREATE_TOKEN_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['identityId'],
        additionalProperties: false,
        properties: {
            identityId: UUID_SCHEMA,
            validityDays: {type: 'integer', minimum: 1, maximum: 3650}
        }
    };

export interface DeviceIngressCredentialRotateParams {
    identityId: string;
    credentialType: DeviceIngressCredentialType;
    validityDays?: number;
    certificateId?: string;
}
export const DEVICE_INGRESS_CREDENTIAL_ROTATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['identityId', 'credentialType'],
    additionalProperties: false,
    properties: {
        identityId: UUID_SCHEMA,
        credentialType: DEVICE_INGRESS_CREDENTIAL_TYPE_SCHEMA,
        validityDays: {type: 'integer', minimum: 1, maximum: 3650},
        certificateId: UUID_SCHEMA
    }
};

export interface DeviceIngressCredentialIdParams {
    credentialId: string;
}
export const DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['credentialId'],
    additionalProperties: false,
    properties: {credentialId: UUID_SCHEMA}
};

export interface DeviceIngressCredentialListExpiringParams {
    days?: number;
    limit?: number;
    offset?: number;
}
export const DEVICE_INGRESS_CREDENTIAL_LIST_EXPIRING_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        additionalProperties: false,
        properties: {
            days: {type: 'integer', minimum: 1, maximum: 3650},
            limit: {type: 'integer', minimum: 1, maximum: 500},
            offset: {type: 'integer', minimum: 0}
        }
    };

export const DEVICE_INGRESS_ROTATION_JOB_STATE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: ['queued', 'sent', 'waiting', 'finalized', 'failed', 'cancelled']
};

export interface DeviceIngressRotationStartParams {
    identityIds: string[];
}
export const DEVICE_INGRESS_ROTATION_START_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['identityIds'],
    additionalProperties: false,
    properties: {
        identityIds: {
            type: 'array',
            minItems: 1,
            maxItems: 1000,
            uniqueItems: true,
            items: UUID_SCHEMA
        }
    }
};

export interface DeviceIngressRotationListParams {
    batchId?: string;
    state?:
        | 'queued'
        | 'sent'
        | 'waiting'
        | 'finalized'
        | 'failed'
        | 'cancelled';
    limit?: number;
    offset?: number;
}
export const DEVICE_INGRESS_ROTATION_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        batchId: UUID_SCHEMA,
        state: DEVICE_INGRESS_ROTATION_JOB_STATE_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    }
};

const ROTATION_JOB_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'batchId',
        'identityId',
        'oldCredentialId',
        'newCredentialId',
        'state',
        'errorCode',
        'sentAt',
        'createdBy',
        'createdAt',
        'updatedAt',
        'expectedExternalId'
    ],
    additionalProperties: false,
    properties: {
        id: UUID_SCHEMA,
        organizationId: {type: 'string'},
        batchId: UUID_SCHEMA,
        identityId: UUID_SCHEMA,
        oldCredentialId: UUID_SCHEMA,
        newCredentialId: {type: ['string', 'null'], format: 'uuid'},
        state: DEVICE_INGRESS_ROTATION_JOB_STATE_SCHEMA,
        errorCode: {
            type: ['string', 'null'],
            enum: [
                'offline',
                'not_applied',
                'send_failed',
                'cancelled_by_operator',
                null
            ]
        },
        sentAt: DATE_TIME_NULL_SCHEMA,
        createdBy: {type: 'string'},
        createdAt: DATE_TIME_SCHEMA,
        updatedAt: DATE_TIME_SCHEMA,
        expectedExternalId: {
            ...OPTIONAL_EXTERNAL_ID_SCHEMA,
            description:
                'Device id from the identity. Null on Rotation.Start and Rotation.Cancel responses; List and Get fill it.'
        }
    }
};

const ROTATION_STARTED_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['batchId', 'jobs'],
    additionalProperties: false,
    properties: {
        batchId: UUID_SCHEMA,
        jobs: {type: 'array', items: ROTATION_JOB_RESPONSE}
    }
};

const ROTATION_JOB_WRAPPED_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['success', 'job'],
    additionalProperties: false,
    properties: {success: {type: 'boolean'}, job: ROTATION_JOB_RESPONSE}
};

export interface DeviceIngressEnrollmentTokenCreateParams {
    validityMinutes: number;
    maxUses?: number;
    preferredProfileId?: DeviceIngressProfileId;
}
// Static ceilings; deployment can tighten further via env (the component
// clamps against tuning before minting).
export const DEVICE_INGRESS_ENROLLMENT_TOKEN_CREATE_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['validityMinutes'],
        additionalProperties: false,
        properties: {
            validityMinutes: {type: 'integer', minimum: 1, maximum: 1440},
            maxUses: {type: 'integer', minimum: 1, maximum: 1000},
            preferredProfileId: DEVICE_INGRESS_PROFILE_ID_SCHEMA
        }
    };

export const DEVICE_INGRESS_ENROLLMENT_TOKEN_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export interface DeviceIngressEnrollmentTokenRevokeParams {
    id: string;
}
export const DEVICE_INGRESS_ENROLLMENT_TOKEN_REVOKE_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: {id: UUID_SCHEMA}
    };

export interface DeviceIngressConnectionGetParams {
    id: string;
}
export const DEVICE_INGRESS_CONNECTION_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: UUID_SCHEMA}
};

export interface DeviceIngressConnectionDisconnectParams {
    id: string;
    reason?: string;
}
export const DEVICE_INGRESS_CONNECTION_DISCONNECT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: UUID_SCHEMA,
        reason: {type: 'string', minLength: 1, maxLength: 160}
    }
};

export interface DeviceIngressConnectionListParams {
    identityId?: string;
    result?: 'accepted' | 'waiting_room' | 'rejected';
    limit?: number;
    offset?: number;
}
export const DEVICE_INGRESS_CONNECTION_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        identityId: UUID_SCHEMA,
        result: {type: 'string', enum: [...DEVICE_INGRESS_CONNECTION_RESULTS]},
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    }
};

export interface DeviceIngressWaitingRoomListParams {
    state?: 'open' | 'approved' | 'rejected' | 'expired';
    limit?: number;
    offset?: number;
}
export const DEVICE_INGRESS_WAITING_ROOM_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        state: {
            type: 'string',
            enum: ['open', 'approved', 'rejected', 'expired']
        },
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    }
};

// Get and Probe both reference one waiting-room entry by id — one schema.
export interface DeviceIngressWaitingRoomRefParams {
    waitingRoomId: string;
}
export const DEVICE_INGRESS_WAITING_ROOM_REF_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['waitingRoomId'],
    additionalProperties: false,
    properties: {waitingRoomId: UUID_SCHEMA}
};

export interface DeviceIngressWaitingRoomApproveParams {
    waitingRoomId: string;
    action: 'bind_existing_device' | 'create_new_device' | 'bind_connector';
    deviceId?: string;
    // Optional: a plain approve defaults to the device's connected security.
    profileId?: DeviceIngressProfileId;
}
export const DEVICE_INGRESS_WAITING_ROOM_APPROVE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['waitingRoomId', 'action'],
    additionalProperties: false,
    properties: {
        waitingRoomId: UUID_SCHEMA,
        action: {
            type: 'string',
            enum: [
                'bind_existing_device',
                'create_new_device',
                'bind_connector'
            ]
        },
        deviceId: OPTIONAL_ID_SCHEMA,
        profileId: DEVICE_INGRESS_PROFILE_ID_SCHEMA
    }
};

export interface DeviceIngressWaitingRoomRejectParams {
    waitingRoomId: string;
    reasonCode: DeviceIngressRejectionReason;
    detail?: string;
}
export const DEVICE_INGRESS_WAITING_ROOM_REJECT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['waitingRoomId', 'reasonCode'],
    additionalProperties: false,
    properties: {
        waitingRoomId: UUID_SCHEMA,
        reasonCode: DEVICE_INGRESS_REJECTION_REASON_SCHEMA,
        detail: {type: 'string', minLength: 1, maxLength: 1024}
    }
};

export interface DeviceIngressRejectionListParams {
    severity?: DeviceIngressRejectionSeverity;
    reasonCode?: DeviceIngressRejectionReason;
    limit?: number;
    offset?: number;
}
export const DEVICE_INGRESS_REJECTION_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        severity: DEVICE_INGRESS_REJECTION_SEVERITY_SCHEMA,
        reasonCode: DEVICE_INGRESS_REJECTION_REASON_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    }
};

export interface DeviceIngressRejectionResolveParams {
    id: string;
    note?: string;
}
export const DEVICE_INGRESS_REJECTION_RESOLVE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: UUID_SCHEMA,
        note: {type: 'string', minLength: 1, maxLength: 1024}
    }
};

export interface DeviceIngressSetupPlanParams {
    reportedExternalId: string;
    model?: string;
    firmware?: string;
    capabilities?: Record<string, unknown>;
    preferredProfileId?: DeviceIngressProfileId;
    certificateId?: string;
    certificateCsrPem?: string;
    issueCertificate?: boolean;
    certificateName?: string;
    certificateValidityDays?: number;
}
export const DEVICE_INGRESS_SETUP_PLAN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['reportedExternalId'],
    additionalProperties: false,
    properties: {
        reportedExternalId: EXTERNAL_ID_SCHEMA,
        model: {type: 'string', minLength: 1, maxLength: 120},
        firmware: {type: 'string', minLength: 1, maxLength: 120},
        capabilities: {type: 'object', maxBytes: 8192},
        preferredProfileId: DEVICE_INGRESS_PROFILE_ID_SCHEMA,
        certificateId: UUID_SCHEMA,
        certificateCsrPem: {type: 'string', minLength: 1, maxLength: 65536},
        issueCertificate: {type: 'boolean'},
        certificateName: {type: 'string', minLength: 1, maxLength: 160},
        certificateValidityDays: {type: 'integer', minimum: 1, maximum: 3650}
    }
};

export interface DeviceIngressSetupBundleParams {
    sessionId: string;
}
export const DEVICE_INGRESS_SETUP_BUNDLE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['sessionId'],
    additionalProperties: false,
    properties: {sessionId: UUID_SCHEMA}
};

export interface DeviceIngressSetupReportApplyParams {
    sessionId: string;
    status: 'applied' | 'partial' | 'failed';
    applyMethod: DeviceIngressApplyMethod;
    errorCode?: string;
    errorMessage?: string;
}
export const DEVICE_INGRESS_SETUP_REPORT_APPLY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['sessionId', 'status', 'applyMethod'],
    additionalProperties: false,
    properties: {
        sessionId: UUID_SCHEMA,
        status: {type: 'string', enum: ['applied', 'partial', 'failed']},
        applyMethod: {
            type: 'string',
            enum: [...DEVICE_INGRESS_APPLY_METHODS]
        },
        errorCode: {type: 'string', minLength: 1, maxLength: 80},
        errorMessage: {type: 'string', minLength: 1, maxLength: 1024}
    }
};

const PROFILE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['id', 'name', 'securityModel', 'transport', 'riskLevel'],
    additionalProperties: true,
    properties: {
        id: DEVICE_INGRESS_PROFILE_ID_SCHEMA,
        name: {type: 'string'},
        securityModel: DEVICE_INGRESS_SECURITY_MODEL_SCHEMA,
        transport: DEVICE_INGRESS_TRANSPORT_SCHEMA,
        riskLevel: DEVICE_INGRESS_RISK_LEVEL_SCHEMA
    }
};

// The stored identity row, field for field, as toIdentity builds it in
// deviceIngress/deviceIngressRepository.ts. Every identity reply is this row.
const IDENTITY_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'subjectType',
        'subjectId',
        'displayName',
        'securityModel',
        'transport',
        'riskLevel',
        'status',
        'expectedExternalId',
        'scopeKind',
        'scopeRef',
        'reportedExternalIds',
        'lastSeenAt',
        'createdAt',
        'updatedAt'
    ],
    additionalProperties: false,
    properties: {
        id: UUID_SCHEMA,
        organizationId: {type: 'string'},
        subjectType: DEVICE_INGRESS_SUBJECT_TYPE_SCHEMA,
        subjectId: ID_SCHEMA,
        displayName: {type: 'string'},
        securityModel: DEVICE_INGRESS_SECURITY_MODEL_SCHEMA,
        transport: DEVICE_INGRESS_TRANSPORT_SCHEMA,
        riskLevel: DEVICE_INGRESS_RISK_LEVEL_SCHEMA,
        status: DEVICE_INGRESS_IDENTITY_STATE_SCHEMA,
        expectedExternalId: OPTIONAL_EXTERNAL_ID_SCHEMA,
        scopeKind: DEVICE_INGRESS_SCOPE_KIND_SCHEMA,
        scopeRef: OPTIONAL_ID_SCHEMA,
        reportedExternalIds: {type: 'array', items: EXTERNAL_ID_SCHEMA},
        lastSeenAt: DATE_TIME_NULL_SCHEMA,
        createdAt: DATE_TIME_SCHEMA,
        updatedAt: DATE_TIME_SCHEMA
    }
};

// The stored credential row, as toCredential builds it in the repository.
const CREDENTIAL_ROW_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'identityId',
        'credentialType',
        'state',
        'tokenPrefix',
        'certificateId',
        'certificateFingerprint',
        'notBefore',
        'notAfter',
        'lastUsedAt',
        'createdAt',
        'updatedAt'
    ],
    additionalProperties: false,
    properties: {
        id: UUID_SCHEMA,
        organizationId: {type: 'string'},
        identityId: UUID_SCHEMA,
        credentialType: DEVICE_INGRESS_CREDENTIAL_TYPE_SCHEMA,
        state: DEVICE_INGRESS_CREDENTIAL_STATE_SCHEMA,
        tokenPrefix: {type: ['string', 'null']},
        certificateId: {type: ['string', 'null'], format: 'uuid'},
        certificateFingerprint: {type: ['string', 'null']},
        notBefore: DATE_TIME_NULL_SCHEMA,
        notAfter: DATE_TIME_NULL_SCHEMA,
        lastUsedAt: DATE_TIME_NULL_SCHEMA,
        createdAt: DATE_TIME_SCHEMA,
        updatedAt: DATE_TIME_SCHEMA
    }
};

const EXPIRING_CREDENTIAL_RESPONSE: JsonSchema = {
    ...CREDENTIAL_ROW_RESPONSE,
    required: [
        ...(CREDENTIAL_ROW_RESPONSE.required ?? []),
        'expectedExternalId'
    ],
    properties: {
        ...(CREDENTIAL_ROW_RESPONSE.properties ?? {}),
        expectedExternalId: OPTIONAL_EXTERNAL_ID_SCHEMA
    }
};

// Only ever sent in the reply that mints it — the store keeps a hash.
const TOKEN_ONCE_SCHEMA: JsonSchema = {
    type: 'string',
    description: 'The raw token, returned this once and never again.'
};

// A connector profile mints no credential, so a plan can carry null; a token
// profile puts the raw token in the plan's credential.
const CREDENTIAL_RESPONSE: JsonSchema = {
    ...CREDENTIAL_ROW_RESPONSE,
    type: ['object', 'null'],
    properties: {
        ...(CREDENTIAL_ROW_RESPONSE.properties ?? {}),
        tokenOnce: TOKEN_ONCE_SCHEMA
    }
};

const SETUP_CERTIFICATE_INSTALL_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['userCaPem', 'clientCertPem'],
    additionalProperties: false,
    properties: {
        userCaPem: {type: 'string'},
        clientCertPem: {type: 'string'},
        clientKeyPem: {type: 'string'}
    }
};

const SETUP_CERTIFICATE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['certificateId', 'requiresClientKey'],
    additionalProperties: true,
    anyOf: [
        {
            properties: {requiresClientKey: {const: false}}
        },
        {
            properties: {
                requiresClientKey: {const: true},
                install: {
                    ...SETUP_CERTIFICATE_INSTALL_RESPONSE,
                    required: ['userCaPem', 'clientCertPem', 'clientKeyPem']
                }
            }
        }
    ],
    properties: {
        certificateId: UUID_SCHEMA,
        fingerprintSha256: {type: ['string', 'null']},
        notBefore: DATE_TIME_NULL_SCHEMA,
        notAfter: DATE_TIME_NULL_SCHEMA,
        requiresClientKey: {type: 'boolean'},
        install: SETUP_CERTIFICATE_INSTALL_RESPONSE
    }
};

const SETUP_DEVICE_CONFIG_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['ws'],
    additionalProperties: true,
    properties: {
        ws: {
            type: 'object',
            required: ['enable', 'server'],
            additionalProperties: true,
            properties: {
                enable: {type: 'boolean'},
                server: {type: 'string'},
                ssl_ca: {type: 'string'}
            }
        }
    }
};

const SETUP_BUNDLE_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'organizationId',
        'identityId',
        'securityModel',
        'transport',
        'riskLevel',
        'applyMethod',
        'deviceConfig',
        'requiresReboot'
    ],
    additionalProperties: true,
    properties: {
        organizationId: {type: 'string'},
        identityId: UUID_SCHEMA,
        securityModel: DEVICE_INGRESS_SECURITY_MODEL_SCHEMA,
        transport: DEVICE_INGRESS_TRANSPORT_SCHEMA,
        riskLevel: DEVICE_INGRESS_RISK_LEVEL_SCHEMA,
        applyMethod: {type: 'string', enum: [...DEVICE_INGRESS_APPLY_METHODS]},
        deviceConfig: SETUP_DEVICE_CONFIG_RESPONSE,
        certificates: SETUP_CERTIFICATE_RESPONSE,
        tokenOnce: {type: 'string'},
        warnings: {type: 'array', items: {type: 'string'}},
        requiresReboot: {type: 'boolean'},
        sessionId: UUID_SCHEMA
    }
};

const SETUP_PLAN_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'sessionId',
        'identity',
        'credential',
        'profile',
        'preferredApplyMethod',
        'expiresAt',
        'bundle'
    ],
    additionalProperties: true,
    properties: {
        sessionId: UUID_SCHEMA,
        identity: IDENTITY_RESPONSE,
        credential: CREDENTIAL_RESPONSE,
        profile: PROFILE_RESPONSE,
        preferredApplyMethod: {
            type: 'string',
            enum: [...DEVICE_INGRESS_APPLY_METHODS]
        },
        expiresAt: {type: 'string', format: 'date-time'},
        bundle: SETUP_BUNDLE_RESPONSE
    }
};

// Every column of device_ingress_setup_session, as toSetupSession maps it.
const SETUP_SESSION_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'reportedExternalId',
        'profileId',
        'status',
        'applyMethod',
        'bundle',
        'errorCode',
        'errorMessage',
        'bundleFetchCount',
        'expiresAt',
        'createdAt',
        'updatedAt'
    ],
    additionalProperties: true,
    properties: {
        id: UUID_SCHEMA,
        organizationId: {type: 'string'},
        reportedExternalId: {type: 'string'},
        profileId: DEVICE_INGRESS_PROFILE_ID_SCHEMA,
        status: {type: 'string'},
        applyMethod: {
            type: ['string', 'null'],
            enum: [...DEVICE_INGRESS_APPLY_METHODS, null]
        },
        bundle: SETUP_BUNDLE_RESPONSE,
        errorCode: {type: ['string', 'null']},
        errorMessage: {type: ['string', 'null']},
        bundleFetchCount: {type: 'integer'},
        expiresAt: {type: 'string', format: 'date-time'},
        createdAt: {type: 'string', format: 'date-time'},
        updatedAt: {type: 'string', format: 'date-time'}
    }
};

export interface DeviceIngressAuthMethodsResponse {
    token: boolean;
    approvedId: boolean;
    certificate: boolean;
    keysChecked: boolean;
}

const AUTH_METHODS_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['token', 'approvedId', 'certificate', 'keysChecked'],
    additionalProperties: false,
    properties: {
        token: {
            type: 'boolean',
            description:
                'URL token login is accepted (the cryptographic login).'
        },
        approvedId: {
            type: 'boolean',
            description:
                'Approved credential-less devices are admitted by reported id (grandfather).'
        },
        certificate: {
            type: 'boolean',
            description:
                'WS client-certificate login. Always false — stock Shelly WS has no client cert.'
        },
        keysChecked: {
            type: 'boolean',
            description:
                'False when this server admits devices without checking their key; key rotation then waits.'
        }
    }
};

// The enrollment-token row, as toEnrollmentToken builds it. No secret here:
// only the prefix is stored, the token itself went out at mint time.
const ENROLLMENT_TOKEN_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'tokenPrefix',
        'preferredProfileId',
        'state',
        'maxUses',
        'useCount',
        'notAfter',
        'createdBy',
        'createdAt',
        'updatedAt',
        'lastUsedAt',
        'revokedAt'
    ],
    additionalProperties: false,
    properties: {
        id: UUID_SCHEMA,
        organizationId: {type: 'string'},
        tokenPrefix: {type: 'string'},
        preferredProfileId: {
            type: ['string', 'null'],
            enum: [...DEVICE_INGRESS_PROFILE_IDS, null]
        },
        state: {type: 'string', enum: ['active', 'consumed', 'revoked']},
        maxUses: {type: 'integer'},
        useCount: {type: 'integer'},
        notAfter: DATE_TIME_SCHEMA,
        createdBy: {type: ['string', 'null']},
        createdAt: DATE_TIME_SCHEMA,
        updatedAt: DATE_TIME_SCHEMA,
        lastUsedAt: DATE_TIME_NULL_SCHEMA,
        revokedAt: DATE_TIME_NULL_SCHEMA
    }
};

// The connection row, as toConnection builds it. observedTransport is what the
// client claimed, so it stays a free string, not the transport enum.
const CONNECTION_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'identityId',
        'credentialId',
        'reportedExternalId',
        'observedTransport',
        'result',
        'reasonCode',
        'remoteAddressHash',
        'safeDetail',
        'userAgent',
        'createdAt',
        'disconnectedAt',
        'disconnectReason'
    ],
    additionalProperties: false,
    properties: {
        id: UUID_SCHEMA,
        organizationId: {type: 'string'},
        identityId: {type: ['string', 'null'], format: 'uuid'},
        credentialId: {type: ['string', 'null'], format: 'uuid'},
        reportedExternalId: OPTIONAL_EXTERNAL_ID_SCHEMA,
        observedTransport: {type: 'string'},
        result: {type: 'string', enum: [...DEVICE_INGRESS_CONNECTION_RESULTS]},
        reasonCode: {type: ['string', 'null']},
        remoteAddressHash: {type: ['string', 'null']},
        safeDetail: {type: 'object', additionalProperties: true},
        userAgent: {type: ['string', 'null']},
        createdAt: DATE_TIME_SCHEMA,
        disconnectedAt: DATE_TIME_NULL_SCHEMA,
        disconnectReason: {type: ['string', 'null']}
    }
};

// The rejection row, as toRejection builds it.
const REJECTION_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'identityId',
        'credentialId',
        'waitingRoomId',
        'reasonCode',
        'severity',
        'reportedExternalId',
        'observedTransport',
        'safeDetail',
        'createdAt',
        'resolvedAt',
        'resolvedBy',
        'resolutionNote'
    ],
    additionalProperties: false,
    properties: {
        id: UUID_SCHEMA,
        organizationId: {type: 'string'},
        identityId: {type: ['string', 'null'], format: 'uuid'},
        credentialId: {type: ['string', 'null'], format: 'uuid'},
        waitingRoomId: {type: ['string', 'null'], format: 'uuid'},
        reasonCode: DEVICE_INGRESS_REJECTION_REASON_SCHEMA,
        severity: DEVICE_INGRESS_REJECTION_SEVERITY_SCHEMA,
        reportedExternalId: OPTIONAL_EXTERNAL_ID_SCHEMA,
        observedTransport: {type: ['string', 'null']},
        safeDetail: {type: 'object', additionalProperties: true},
        createdAt: DATE_TIME_SCHEMA,
        resolvedAt: DATE_TIME_NULL_SCHEMA,
        resolvedBy: {type: ['string', 'null']},
        resolutionNote: {type: ['string', 'null']}
    }
};

const IDENTITY_STATUS_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['success', 'identity'],
    additionalProperties: false,
    properties: {success: {type: 'boolean'}, identity: IDENTITY_RESPONSE}
};

// CreateToken always mints a token, so tokenOnce is always there.
const CREDENTIAL_CREATED_RESPONSE: JsonSchema = {
    ...CREDENTIAL_ROW_RESPONSE,
    required: [...(CREDENTIAL_ROW_RESPONSE.required ?? []), 'tokenOnce'],
    properties: {
        ...(CREDENTIAL_ROW_RESPONSE.properties ?? {}),
        tokenOnce: TOKEN_ONCE_SCHEMA
    }
};

// Rotate mints a token only for credentialType 'token'; the certificate path
// binds an existing cert and has no secret to hand back.
const CREDENTIAL_ROTATED_RESPONSE: JsonSchema = {
    ...CREDENTIAL_ROW_RESPONSE,
    properties: {
        ...(CREDENTIAL_ROW_RESPONSE.properties ?? {}),
        tokenOnce: TOKEN_ONCE_SCHEMA
    }
};

// Finalize, Cancel and Revoke all answer with the credential they moved.
const CREDENTIAL_ACTION_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['success', 'credential'],
    additionalProperties: false,
    properties: {
        success: {type: 'boolean'},
        credential: CREDENTIAL_ROW_RESPONSE
    }
};

const ENROLLMENT_TOKEN_CREATED_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['url', 'tokenOnce', 'expiresAt'],
    additionalProperties: false,
    properties: {
        url: {type: 'string'},
        tokenOnce: TOKEN_ONCE_SCHEMA,
        expiresAt: DATE_TIME_SCHEMA
    }
};

const ENROLLMENT_TOKEN_LIST_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['items'],
    additionalProperties: false,
    properties: {
        items: {type: 'array', items: ENROLLMENT_TOKEN_RESPONSE}
    }
};

const CONNECTION_DISCONNECTED_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['success', 'connection'],
    additionalProperties: false,
    properties: {success: {type: 'boolean'}, connection: CONNECTION_RESPONSE}
};

const REJECTION_RESOLVED_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['success', 'rejection'],
    additionalProperties: false,
    properties: {success: {type: 'boolean'}, rejection: REJECTION_RESPONSE}
};

const SETUP_APPLY_REPORTED_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['success', 'session'],
    additionalProperties: false,
    properties: {success: {type: 'boolean'}, session: SETUP_SESSION_RESPONSE}
};

const b = new DescribeBuilder('deviceIngress', {
    kind: 'fleet-manager',
    description:
        'Manage device ingress identities, credentials, Waiting Room, Rejected connections, and provisioning.'
});

b.registerMethod('Profile.List', {
    params: DEVICE_INGRESS_EMPTY_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['items'],
        properties: {items: {type: 'array', items: PROFILE_RESPONSE}}
    },
    permission: PERM_READ,
    description: 'List built-in device ingress security/config profiles.'
});
b.registerMethod('AuthMethods', {
    params: DEVICE_INGRESS_EMPTY_PARAMS_SCHEMA,
    response: AUTH_METHODS_RESPONSE,
    permission: PERM_READ,
    description:
        'Which device auth methods this deployment accepts — the single source of truth for the UI. Certificate is always false for Shelly WS.'
});
b.registerMethod('Identity.Create', {
    params: DEVICE_INGRESS_IDENTITY_CREATE_PARAMS_SCHEMA,
    response: IDENTITY_RESPONSE,
    permission: PERM_WRITE,
    description: 'Create an org-scoped ingress identity.'
});
b.registerMethod('Identity.Get', {
    params: DEVICE_INGRESS_IDENTITY_GET_PARAMS_SCHEMA,
    response: IDENTITY_RESPONSE,
    permission: PERM_READ,
    description: 'Get one org-scoped ingress identity.'
});
b.registerMethod('Identity.Update', {
    params: DEVICE_INGRESS_IDENTITY_UPDATE_PARAMS_SCHEMA,
    response: IDENTITY_RESPONSE,
    permission: PERM_WRITE,
    description: 'Update operator-editable ingress identity metadata.'
});
b.registerMethod('Identity.Enable', {
    params: DEVICE_INGRESS_IDENTITY_GET_PARAMS_SCHEMA,
    response: IDENTITY_STATUS_RESPONSE,
    permission: PERM_WRITE,
    description:
        'Enable a pending or disabled ingress identity so its credentials can connect. Already active is a no-op; quarantined and deleted stay closed.'
});
b.registerMethod('Identity.Disable', {
    params: DEVICE_INGRESS_IDENTITY_GET_PARAMS_SCHEMA,
    response: IDENTITY_STATUS_RESPONSE,
    permission: PERM_WRITE,
    description: 'Disable an ingress identity and close live connections.'
});
b.registerMethod('Identity.List', {
    params: DEVICE_INGRESS_IDENTITY_LIST_PARAMS_SCHEMA,
    response: listResponseSchema(IDENTITY_RESPONSE),
    permission: PERM_READ,
    description: 'List org-scoped ingress identities.'
});
b.registerMethod('Credential.CreateToken', {
    params: DEVICE_INGRESS_CREDENTIAL_CREATE_TOKEN_PARAMS_SCHEMA,
    response: CREDENTIAL_CREATED_RESPONSE,
    permission: PERM_WRITE,
    description:
        'Create a direct-token credential and return the raw token once.'
});
b.registerMethod('Credential.Rotate', {
    params: DEVICE_INGRESS_CREDENTIAL_ROTATE_PARAMS_SCHEMA,
    response: CREDENTIAL_ROTATED_RESPONSE,
    permission: PERM_WRITE,
    description: 'Create a pending replacement credential.'
});
b.registerMethod('Credential.FinalizeRotation', {
    params: DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA,
    response: CREDENTIAL_ACTION_RESPONSE,
    permission: PERM_WRITE,
    description: 'Finalize a pending credential rotation.'
});
b.registerMethod('Credential.CancelRotation', {
    params: DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA,
    response: CREDENTIAL_ACTION_RESPONSE,
    permission: PERM_WRITE,
    description: 'Cancel a pending credential rotation.'
});
b.registerMethod('Credential.Revoke', {
    params: DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA,
    response: CREDENTIAL_ACTION_RESPONSE,
    permission: PERM_WRITE,
    description: 'Revoke a credential and close matching live sockets.'
});
b.registerMethod('Credential.ListExpiring', {
    params: DEVICE_INGRESS_CREDENTIAL_LIST_EXPIRING_PARAMS_SCHEMA,
    response: listResponseSchema(EXPIRING_CREDENTIAL_RESPONSE),
    permission: PERM_READ,
    description:
        'List active credentials whose end date falls inside the next N days, soonest first. Default N comes from FM_DEVICE_INGRESS_CREDENTIAL_EXPIRY_WARN_DAYS.'
});
b.registerMethod('EnrollmentToken.Create', {
    params: DEVICE_INGRESS_ENROLLMENT_TOKEN_CREATE_PARAMS_SCHEMA,
    response: ENROLLMENT_TOKEN_CREATED_RESPONSE,
    permission: PERM_WRITE,
    description:
        'Mint a device-agnostic, time-boxed enrollment token; returns the one-time link.'
});
b.registerMethod('EnrollmentToken.List', {
    params: DEVICE_INGRESS_ENROLLMENT_TOKEN_LIST_PARAMS_SCHEMA,
    response: ENROLLMENT_TOKEN_LIST_RESPONSE,
    permission: PERM_READ,
    description: 'List the org enrollment tokens.'
});
b.registerMethod('EnrollmentToken.Revoke', {
    params: DEVICE_INGRESS_ENROLLMENT_TOKEN_REVOKE_PARAMS_SCHEMA,
    response: SUCCESS_RESPONSE_SCHEMA,
    permission: PERM_WRITE,
    description: 'Revoke an active enrollment token before it is used.'
});
b.registerMethod('Connection.List', {
    params: DEVICE_INGRESS_CONNECTION_LIST_PARAMS_SCHEMA,
    response: listResponseSchema(CONNECTION_RESPONSE),
    permission: PERM_READ,
    description: 'List ingress connection history and live connection rows.'
});
b.registerMethod('Connection.Get', {
    params: DEVICE_INGRESS_CONNECTION_GET_PARAMS_SCHEMA,
    response: CONNECTION_RESPONSE,
    permission: PERM_READ,
    description: 'Get one org-scoped ingress connection row.'
});
b.registerMethod('Connection.Disconnect', {
    params: DEVICE_INGRESS_CONNECTION_DISCONNECT_PARAMS_SCHEMA,
    response: CONNECTION_DISCONNECTED_RESPONSE,
    permission: PERM_WRITE,
    description: 'Disconnect a live ingress connection and mark history.'
});
b.registerMethod('Rejection.List', {
    params: DEVICE_INGRESS_REJECTION_LIST_PARAMS_SCHEMA,
    response: listResponseSchema(REJECTION_RESPONSE),
    permission: PERM_READ,
    description: 'List rejected ingress attempts with fixable/blocked filters.'
});
b.registerMethod('Rejection.Resolve', {
    params: DEVICE_INGRESS_REJECTION_RESOLVE_PARAMS_SCHEMA,
    response: REJECTION_RESOLVED_RESPONSE,
    permission: PERM_WRITE,
    description: 'Resolve a rejected ingress entry after operator action.'
});
b.registerMethod('Setup.Plan', {
    params: DEVICE_INGRESS_SETUP_PLAN_PARAMS_SCHEMA,
    response: SETUP_PLAN_RESPONSE,
    permission: PERM_SETUP_WRITE,
    description:
        'Create a mobile/local provisioning plan. Certificate setup also requires certificate management permission.'
});
b.registerMethod('Setup.Bundle', {
    params: DEVICE_INGRESS_SETUP_BUNDLE_PARAMS_SCHEMA,
    response: SETUP_SESSION_RESPONSE,
    permission: PERM_SETUP_WRITE,
    description:
        'Fetch a short-lived provisioning bundle. The device key is never returned again: the saved address has no key. Certificate bundles also require certificate management permission.'
});
b.registerMethod('Setup.ReportApply', {
    params: DEVICE_INGRESS_SETUP_REPORT_APPLY_PARAMS_SCHEMA,
    response: SETUP_APPLY_REPORTED_RESPONSE,
    permission: PERM_WRITE,
    description: 'Report mobile/local provisioning apply result.'
});
b.registerMethod('Rotation.Start', {
    params: DEVICE_INGRESS_ROTATION_START_PARAMS_SCHEMA,
    response: ROTATION_STARTED_RESPONSE,
    permission: PERM_WRITE,
    description:
        'Queue a token rotation for each identity. Every device in the batch restarts once when its new address is applied. Refuses identities that are not active or already rotating.'
});
b.registerMethod('Rotation.List', {
    params: DEVICE_INGRESS_ROTATION_LIST_PARAMS_SCHEMA,
    response: listResponseSchema(ROTATION_JOB_RESPONSE),
    permission: PERM_READ,
    description: 'List rotation jobs by batch or state.'
});
b.registerMethod('Rotation.Cancel', {
    params: DEVICE_INGRESS_IDENTITY_GET_PARAMS_SCHEMA,
    response: ROTATION_JOB_WRAPPED_RESPONSE,
    permission: PERM_WRITE,
    description:
        'Cancel a queued or waiting rotation job and revoke its pending key. The device keeps its current key.'
});

export const DEVICE_INGRESS_DESCRIBE: DescribeOutput = b.build();
