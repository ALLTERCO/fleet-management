/**
 * Public API types for the `certificate.*` namespace — X.509 cert store.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export const CERTIFICATE_KINDS = [
    'root_ca',
    'client_pair',
    'server_bundle',
    'device',
    'other'
] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

export const CERTIFICATE_KIND_LABELS: Record<CertificateKind, string> = {
    root_ca: 'Root CA',
    client_pair: 'Client cert + key',
    server_bundle: 'Server bundle',
    device: 'Device leaf',
    other: 'Other'
};

export const CERTIFICATE_SOURCES = ['imported', 'fm-issued'] as const;
export type CertificateSource = (typeof CERTIFICATE_SOURCES)[number];

export const CERTIFICATE_SLOTS = [
    'root_ca',
    'client_cert',
    'client_key',
    'server_ca',
    'server_cert',
    'server_key'
] as const;
export type CertificateSlot = (typeof CERTIFICATE_SLOTS)[number];

export const CERTIFICATE_KEY_ALGOS = [
    'rsa-2048',
    'rsa-3072',
    'rsa-4096',
    'ecdsa-p256',
    'ecdsa-p384',
    'ecdsa-p521'
] as const;
export type CertificateKeyAlgo = (typeof CERTIFICATE_KEY_ALGOS)[number];

// Extended X.509 metadata extracted at import time. Stored in
// organization.certificates.metadata as JSONB so adding fields later
// doesn't require a schema migration.
export interface CertificateMetadata {
    signature_algorithm: string | null;
    key_bits: number | null;
    key_curve: string | null;
    serial_number: string;
    subject_o: string | null;
    subject_ou: string | null;
    issuer_o: string | null;
    issuer_ou: string | null;
    san_dns: string[];
    san_ip: string[];
    key_usage: string[];
    extended_key_usage: string[];
    chain_includes_root: boolean;
}

export interface CertificateResponse {
    id: string;
    tenant_id: string;
    name: string;
    kind: CertificateKind;
    fingerprint_sha256: string;
    subject_cn: string | null;
    issuer_cn: string | null;
    sans: string[] | null;
    key_algo: string | null;
    chain_depth: number | null;
    basic_constraints_ca: boolean | null;
    not_before: string | null;
    not_after: string | null;
    slot_compat: string[] | null;
    device_compatible: boolean;
    incompat_reasons: string[] | null;
    source: CertificateSource;
    created_at: string;
    created_by: string | null;
    last_used_at: string | null;
    metadata: CertificateMetadata | null;
    tags: string[];
    // Strong typed FKs to organization.groups (M:N).
    device_group_ids: number[];
}

export interface CertificateImportParams {
    name: string;
    kind: CertificateKind;
    pem: string;
    privateKeyPem?: string;
    tags?: string[];
}
export const CERTIFICATE_IMPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name', 'kind', 'pem'],
    properties: {
        name: {type: 'string', minLength: 1, maxLength: 200},
        kind: {type: 'string', enum: [...CERTIFICATE_KINDS]},
        pem: {type: 'string', minLength: 1, maxLength: 524288},
        privateKeyPem: {type: 'string', minLength: 1, maxLength: 65536},
        tags: {
            type: 'array',
            maxItems: 32,
            items: {type: 'string', minLength: 1, maxLength: 64}
        }
    },
    additionalProperties: false
};

export interface CertificateListParams {
    kind?: CertificateKind;
    source?: CertificateSource;
    slot?: CertificateSlot;
    tag?: string;
    groupId?: number;
    expiringWithinDays?: number;
    limit?: number;
    offset?: number;
}
export const CERTIFICATE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        kind: {type: 'string', enum: [...CERTIFICATE_KINDS]},
        source: {type: 'string', enum: [...CERTIFICATE_SOURCES]},
        slot: {type: 'string', enum: [...CERTIFICATE_SLOTS]},
        tag: {type: 'string', minLength: 1, maxLength: 64},
        groupId: {type: 'integer', minimum: 1},
        expiringWithinDays: {type: 'integer', minimum: 1, maximum: 3650},
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    },
    additionalProperties: false
};

export interface CertificateSetGroupsParams {
    id: string;
    groupIds: number[];
}
export const CERTIFICATE_SET_GROUPS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'groupIds'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        groupIds: {
            type: 'array',
            maxItems: 256,
            items: {type: 'integer', minimum: 1}
        }
    },
    additionalProperties: false
};

export interface CertificateSetGroupsResponse {
    id: string;
    device_group_ids: number[];
}

export interface CertificateSetTagsParams {
    id: string;
    tags: string[];
}
export const CERTIFICATE_SET_TAGS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'tags'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        tags: {
            type: 'array',
            maxItems: 32,
            items: {type: 'string', minLength: 1, maxLength: 64}
        }
    },
    additionalProperties: false
};

export interface CertificateSetTagsResponse {
    id: string;
    tags: string[];
}

export interface CertificateGetParams {
    id: string;
    includePem?: boolean;
}
export const CERTIFICATE_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        includePem: {type: 'boolean'}
    },
    additionalProperties: false
};

export interface CertificateUpdateParams {
    id: string;
    name?: string;
}
export const CERTIFICATE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        name: {type: 'string', minLength: 1, maxLength: 200}
    },
    additionalProperties: false
};

export interface CertificateDeleteParams {
    id: string;
}
export const CERTIFICATE_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

export interface CertificateExportParams {
    id: string;
    includePrivateKey?: boolean;
}
export const CERTIFICATE_EXPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        includePrivateKey: {type: 'boolean'}
    },
    additionalProperties: false
};

export interface CertificateIssueDeviceParams {
    shellyId: string;
    validityDays?: number;
    name?: string;
}

export type CertificateGetIssueDefaultsParams = Record<string, never>;
export const CERTIFICATE_GET_ISSUE_DEFAULTS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false
};

export interface CertificateIssueDefaults {
    defaultValidityDays: number;
    maxValidityDays: number;
}

export interface CertificatePushTargetSummary {
    deviceIds?: string[];
    groupIds?: number[];
    tagKeys?: string[];
}

export interface CertificatePreflightPushParams {
    certificateId: string;
    slot: CertificateSlot;
    target: CertificatePushTargetSummary;
}

export interface CertificatePreflightSkip {
    shellyId: string;
    reason: string;
}
export interface CertificatePreflightWarning {
    shellyId: string;
    kind: string;
}
export interface CertificatePreflightResult {
    compatible: string[];
    skipped: CertificatePreflightSkip[];
    warnings: CertificatePreflightWarning[];
}

export interface CertificatePushToDevicesParams {
    certificateId: string;
    slot: CertificateSlot;
    target: CertificatePushTargetSummary;
}
export const CERTIFICATE_PUSH_TARGET_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        deviceIds: {type: 'array', items: {type: 'string', minLength: 1}},
        groupIds: {type: 'array', items: {type: 'integer', minimum: 1}},
        tagKeys: {type: 'array', items: {type: 'string', minLength: 1}}
    },
    additionalProperties: false
};
export const CERTIFICATE_PUSH_TO_DEVICES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['certificateId', 'slot', 'target'],
    properties: {
        certificateId: {type: 'string', format: 'uuid'},
        slot: {type: 'string', enum: [...CERTIFICATE_SLOTS]},
        target: CERTIFICATE_PUSH_TARGET_SCHEMA
    },
    additionalProperties: false
};
export const CERTIFICATE_PREFLIGHT_PUSH_PARAMS_SCHEMA: JsonSchema =
    CERTIFICATE_PUSH_TO_DEVICES_PARAMS_SCHEMA;

export interface CertificatePushStatusParams {
    jobId: string;
}
export const CERTIFICATE_PUSH_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['jobId'],
    properties: {jobId: {type: 'string', format: 'uuid'}},
    additionalProperties: false
};

export interface CertificateListPushesParams {
    certificateId?: string;
    deviceId?: string;
    jobId?: string;
    limit?: number;
    offset?: number;
}
export const CERTIFICATE_LIST_PUSHES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        certificateId: {type: 'string', format: 'uuid'},
        deviceId: {type: 'string', minLength: 1},
        jobId: {type: 'string', format: 'uuid'},
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    },
    additionalProperties: false
};

export type CertificatePushStatus =
    | 'queued'
    | 'in_progress'
    | 'applied'
    | 'failed'
    | 'rolled_back';

export interface CertificateJobResponse {
    id: string;
    tenant_id: string;
    certificate_id: string;
    slot: CertificateSlot;
    target_summary: CertificatePushTargetSummary;
    status: 'queued' | 'running' | 'done' | 'failed';
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    created_by: string | null;
}

export interface CertificatePushRow {
    id: number;
    job_id: string;
    certificate_id: string;
    device_id: string;
    slot: CertificateSlot;
    status: CertificatePushStatus;
    last_error: string | null;
    applied_at: string | null;
    requires_reboot: boolean;
    retry_count: number;
}
export const CERTIFICATE_ISSUE_DEVICE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyId'],
    properties: {
        shellyId: {type: 'string', minLength: 1, maxLength: 64},
        validityDays: {type: 'integer', minimum: 1, maximum: 3650},
        name: {type: 'string', minLength: 1, maxLength: 200}
    },
    additionalProperties: false
};

export interface CertificateSignCsrParams {
    csrPem: string;
    validityDays?: number;
    // Store the signed cert under this name. If omitted, falls back
    // to the CSR's subject CN.
    name?: string;
}
export const CERTIFICATE_SIGN_CSR_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['csrPem'],
    properties: {
        csrPem: {type: 'string', minLength: 1, maxLength: 65536},
        validityDays: {type: 'integer', minimum: 1, maximum: 3650},
        name: {type: 'string', minLength: 1, maxLength: 200}
    },
    additionalProperties: false
};

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

export const CERTIFICATE_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'certificate',
    {
        kind: 'fleet-manager',
        description:
            'Manage the X.509 certificate store and issue, sign, and push device certs.'
    }
)
    .registerMethod('Describe', {
        params: EMPTY_PARAMS,
        response: ANY_RESPONSE,
        permission: {note: 'public'},
        description: 'Component metadata.'
    })
    .registerMethod('List', {
        params: CERTIFICATE_LIST_PARAMS_SCHEMA,
        response: LIST_RESPONSE,
        permission: READ_PERM,
        description: 'List certificates with optional filters.'
    })
    .registerMethod('Get', {
        params: CERTIFICATE_GET_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description:
            'Full metadata for one cert. PEM body included only when includePem=true (admin).'
    })
    .registerMethod('Import', {
        params: CERTIFICATE_IMPORT_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Import an unencrypted PEM cert (and optional unencrypted private key). Encrypted keys / PFX are rejected per Shelly TLS KB.'
    })
    .registerMethod('Update', {
        params: CERTIFICATE_UPDATE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Update mutable cert fields (name only). PEM is immutable after import.'
    })
    .registerMethod('Delete', {
        params: CERTIFICATE_DELETE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Delete a cert. Refuses if currently pushed and not yet replaced.'
    })
    .registerMethod('SetTags', {
        params: CERTIFICATE_SET_TAGS_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Replace the tag set on a cert. Free-form labels for filter/search.'
    })
    .registerMethod('SetGroups', {
        params: CERTIFICATE_SET_GROUPS_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Replace the device-group bindings (typed FK to organization.groups).'
    })
    .registerMethod('Export', {
        params: CERTIFICATE_EXPORT_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Export cert PEM (+ optional private key). Audited every call.'
    })
    .registerMethod('IssueDeviceCert', {
        params: CERTIFICATE_ISSUE_DEVICE_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'FM signs a leaf cert for a shellyID against the local Shelly Fleet Manager Root CA.'
    })
    .registerMethod('SignCsr', {
        params: CERTIFICATE_SIGN_CSR_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'FM signs an operator-supplied CSR against the local Shelly Fleet Manager Root CA. Operator keeps the private key on the device that generated the CSR.'
    })
    .registerMethod('GetIssueDefaults', {
        params: CERTIFICATE_GET_ISSUE_DEFAULTS_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description:
            'Returns {defaultValidityDays, maxValidityDays} from FM env. Frontend reads these instead of mirroring FM_UI_CERT_* runtime config.'
    })
    .registerMethod('PreflightPush', {
        params: CERTIFICATE_PREFLIGHT_PUSH_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description:
            'Resolve the target and report which devices are compatible vs skipped (offline / firmware too old / unsupported key algo / slot incompat) plus warnings (clock skew, enhanced_security off).'
    })
    .registerMethod('PushToDevices', {
        params: CERTIFICATE_PUSH_TO_DEVICES_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: ADMIN_PERM,
        description:
            'Queue a push job that fans the cert out to the resolved target devices in the chosen slot. Returns {jobId, deviceCount}.'
    })
    .registerMethod('PushStatus', {
        params: CERTIFICATE_PUSH_STATUS_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'Polling fallback for the WS push event stream.'
    })
    .registerMethod('ListPushes', {
        params: CERTIFICATE_LIST_PUSHES_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: READ_PERM,
        description: 'List push history scoped by cert / device / job.'
    })
    .build();
