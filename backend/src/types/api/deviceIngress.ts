// deviceIngress.* — trusted device, connector, and provisioning ingress.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

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
        'status'
    ],
    additionalProperties: true,
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
        lastSeenAt: DATE_TIME_NULL_SCHEMA
    }
};

const CREDENTIAL_RESPONSE: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: true,
    properties: {
        id: UUID_SCHEMA,
        identityId: UUID_SCHEMA,
        credentialType: DEVICE_INGRESS_CREDENTIAL_TYPE_SCHEMA,
        state: DEVICE_INGRESS_CREDENTIAL_STATE_SCHEMA,
        tokenPrefix: {type: ['string', 'null']},
        certificateId: {type: ['string', 'null'], format: 'uuid'},
        certificateFingerprint: {type: ['string', 'null']},
        notBefore: DATE_TIME_NULL_SCHEMA,
        notAfter: DATE_TIME_NULL_SCHEMA
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

const SETUP_SESSION_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['id', 'organizationId', 'profileId', 'status', 'bundle'],
    additionalProperties: true,
    properties: {
        id: UUID_SCHEMA,
        organizationId: {type: 'string'},
        profileId: DEVICE_INGRESS_PROFILE_ID_SCHEMA,
        status: {type: 'string'},
        bundle: SETUP_BUNDLE_RESPONSE,
        bundleFetchCount: {type: 'integer'},
        expiresAt: {type: 'string', format: 'date-time'}
    }
};

export interface DeviceIngressAuthMethodsResponse {
    token: boolean;
    approvedId: boolean;
    certificate: boolean;
}

const AUTH_METHODS_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['token', 'approvedId', 'certificate'],
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
        }
    }
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
b.registerMethod('Identity.Disable', {
    params: DEVICE_INGRESS_IDENTITY_GET_PARAMS_SCHEMA,
    response: {type: 'object', description: 'disabled identity'},
    permission: PERM_WRITE,
    description: 'Disable an ingress identity and close live connections.'
});
b.registerMethod('Identity.List', {
    params: DEVICE_INGRESS_IDENTITY_LIST_PARAMS_SCHEMA,
    response: {type: 'object', description: 'items plus pagination'},
    permission: PERM_READ,
    description: 'List org-scoped ingress identities.'
});
b.registerMethod('Credential.CreateToken', {
    params: DEVICE_INGRESS_CREDENTIAL_CREATE_TOKEN_PARAMS_SCHEMA,
    response: {
        type: 'object',
        description: 'credential plus tokenOnce'
    },
    permission: PERM_WRITE,
    description:
        'Create a direct-token credential and return the raw token once.'
});
b.registerMethod('Credential.Rotate', {
    params: DEVICE_INGRESS_CREDENTIAL_ROTATE_PARAMS_SCHEMA,
    response: {type: 'object', description: 'pending credential summary'},
    permission: PERM_WRITE,
    description: 'Create a pending replacement credential.'
});
b.registerMethod('Credential.FinalizeRotation', {
    params: DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA,
    response: {type: 'object', description: '{success:true}'},
    permission: PERM_WRITE,
    description: 'Finalize a pending credential rotation.'
});
b.registerMethod('Credential.CancelRotation', {
    params: DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA,
    response: {type: 'object', description: '{success:true}'},
    permission: PERM_WRITE,
    description: 'Cancel a pending credential rotation.'
});
b.registerMethod('Credential.Revoke', {
    params: DEVICE_INGRESS_CREDENTIAL_ID_PARAMS_SCHEMA,
    response: {type: 'object', description: '{success:true}'},
    permission: PERM_WRITE,
    description: 'Revoke a credential and close matching live sockets.'
});
b.registerMethod('EnrollmentToken.Create', {
    params: DEVICE_INGRESS_ENROLLMENT_TOKEN_CREATE_PARAMS_SCHEMA,
    response: {type: 'object', description: 'url, tokenOnce, expiresAt'},
    permission: PERM_WRITE,
    description:
        'Mint a device-agnostic, time-boxed enrollment token; returns the one-time link.'
});
b.registerMethod('EnrollmentToken.List', {
    params: DEVICE_INGRESS_ENROLLMENT_TOKEN_LIST_PARAMS_SCHEMA,
    response: {type: 'object', description: 'enrollment tokens (no secrets)'},
    permission: PERM_READ,
    description: 'List the org enrollment tokens.'
});
b.registerMethod('EnrollmentToken.Revoke', {
    params: DEVICE_INGRESS_ENROLLMENT_TOKEN_REVOKE_PARAMS_SCHEMA,
    response: {type: 'object', description: '{success:true}'},
    permission: PERM_WRITE,
    description: 'Revoke an active enrollment token before it is used.'
});
b.registerMethod('Connection.List', {
    params: DEVICE_INGRESS_CONNECTION_LIST_PARAMS_SCHEMA,
    response: {type: 'object', description: 'items plus pagination'},
    permission: PERM_READ,
    description: 'List ingress connection history and live connection rows.'
});
b.registerMethod('Connection.Get', {
    params: DEVICE_INGRESS_CONNECTION_GET_PARAMS_SCHEMA,
    response: {type: 'object', description: 'one connection row'},
    permission: PERM_READ,
    description: 'Get one org-scoped ingress connection row.'
});
b.registerMethod('Connection.Disconnect', {
    params: DEVICE_INGRESS_CONNECTION_DISCONNECT_PARAMS_SCHEMA,
    response: {type: 'object', description: '{success:true}'},
    permission: PERM_WRITE,
    description: 'Disconnect a live ingress connection and mark history.'
});
b.registerMethod('Rejection.List', {
    params: DEVICE_INGRESS_REJECTION_LIST_PARAMS_SCHEMA,
    response: {type: 'object', description: 'items plus pagination'},
    permission: PERM_READ,
    description: 'List rejected ingress attempts with fixable/blocked filters.'
});
b.registerMethod('Rejection.Resolve', {
    params: DEVICE_INGRESS_REJECTION_RESOLVE_PARAMS_SCHEMA,
    response: {type: 'object', description: 'resolved rejection row'},
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
        'Fetch a short-lived provisioning bundle. Certificate bundles also require certificate management permission.'
});
b.registerMethod('Setup.ReportApply', {
    params: DEVICE_INGRESS_SETUP_REPORT_APPLY_PARAMS_SCHEMA,
    response: {type: 'object', description: '{success:true}'},
    permission: PERM_WRITE,
    description: 'Report mobile/local provisioning apply result.'
});

export const DEVICE_INGRESS_DESCRIBE: DescribeOutput = b.build();
