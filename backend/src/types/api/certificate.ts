/**
 * Public API types for the `certificate.*` namespace — X.509 cert store.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {listResponseSchema, SUCCESS_RESPONSE_SCHEMA} from './_shared';

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
    client_pair: 'Client certificate',
    server_bundle: 'Server certificate',
    device: 'Device certificate',
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

// Each cert fn returns a different column list, so each gets its own type.
// fn_certificate_update_name stops at these core columns.
export interface CertificateCoreResponse {
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
}

interface CertificateMetaColumns {
    metadata: CertificateMetadata | null;
    tags: string[];
}

// List rows: core columns plus the aggregated group ids.
export interface CertificateResponse
    extends CertificateCoreResponse,
        CertificateMetaColumns {
    // Strong typed FKs to organization.groups (M:N).
    device_group_ids: number[];
}

// Get adds the PEM body, null unless the caller asked and may see it.
export interface CertificateGetResponse extends CertificateResponse {
    pem: string | null;
}

// fn_certificate_import aggregates no group ids; it flags a re-import.
export interface CertificateImportedResponse
    extends CertificateCoreResponse,
        CertificateMetaColumns {
    was_existing: boolean;
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

// Declared once so the schemas below and the types share one list.
export const CERTIFICATE_PUSH_STATUSES = [
    'queued',
    'in_progress',
    'applied',
    'failed',
    'rolled_back'
] as const;
export type CertificatePushStatus = (typeof CERTIFICATE_PUSH_STATUSES)[number];

export const CERTIFICATE_JOB_STATUSES = [
    'queued',
    'running',
    'done',
    'failed'
] as const;
export type CertificateJobStatus = (typeof CERTIFICATE_JOB_STATUSES)[number];

export interface CertificateJobResponse {
    id: string;
    tenant_id: string;
    certificate_id: string;
    slot: CertificateSlot;
    target_summary: CertificatePushTargetSummary;
    status: CertificateJobStatus;
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

// ---- Response schemas ---------------------------------------------------

// Fourteen methods declared `response: {type: 'object'}`, which generates as
// Record<string, unknown>, so a template had to guess. Shapes below are read
// off CertificateComponent.ts and the fn_certificate_* migrations.

// X.509 details the parser extracts. Rows stored before the metadata column
// existed carry `{}`, so no field is required.
const CERTIFICATE_METADATA_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        signature_algorithm: {type: ['string', 'null']},
        key_bits: {type: ['integer', 'null']},
        key_curve: {type: ['string', 'null']},
        serial_number: {type: 'string'},
        subject_o: {type: ['string', 'null']},
        subject_ou: {type: ['string', 'null']},
        issuer_o: {type: ['string', 'null']},
        issuer_ou: {type: ['string', 'null']},
        san_dns: {type: 'array', items: {type: 'string'}},
        san_ip: {type: 'array', items: {type: 'string'}},
        key_usage: {type: 'array', items: {type: 'string'}},
        extended_key_usage: {type: 'array', items: {type: 'string'}},
        chain_includes_root: {type: 'boolean'}
    }
};

const CERTIFICATE_ID_SCHEMA: JsonSchema = {type: 'string', format: 'uuid'};
const CERTIFICATE_TAGS_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'string'}
};
const CERTIFICATE_GROUP_IDS_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'integer'}
};
const NULLABLE_TIMESTAMP: JsonSchema = {
    type: ['string', 'null'],
    format: 'date-time'
};
const NULLABLE_STRING_ARRAY: JsonSchema = {
    anyOf: [{type: 'array', items: {type: 'string'}}, {type: 'null'}]
};

// The columns every cert reader returns. fn_certificate_update_name stops
// here; the list, get and import fns each add their own extras below.
const CERTIFICATE_CORE_PROPERTIES: Record<string, JsonSchema> = {
    id: CERTIFICATE_ID_SCHEMA,
    tenant_id: {type: 'string'},
    name: {type: 'string'},
    kind: {type: 'string', enum: [...CERTIFICATE_KINDS]},
    fingerprint_sha256: {type: 'string'},
    subject_cn: {type: ['string', 'null']},
    issuer_cn: {type: ['string', 'null']},
    sans: NULLABLE_STRING_ARRAY,
    key_algo: {type: ['string', 'null']},
    chain_depth: {type: ['integer', 'null']},
    basic_constraints_ca: {type: ['boolean', 'null']},
    not_before: NULLABLE_TIMESTAMP,
    not_after: NULLABLE_TIMESTAMP,
    slot_compat: {
        anyOf: [
            {
                type: 'array',
                items: {type: 'string', enum: [...CERTIFICATE_SLOTS]}
            },
            {type: 'null'}
        ]
    },
    device_compatible: {type: 'boolean'},
    incompat_reasons: NULLABLE_STRING_ARRAY,
    source: {type: 'string', enum: [...CERTIFICATE_SOURCES]},
    created_at: {type: 'string', format: 'date-time'},
    created_by: {type: ['string', 'null']},
    last_used_at: NULLABLE_TIMESTAMP
};
const CERTIFICATE_CORE_REQUIRED = Object.keys(CERTIFICATE_CORE_PROPERTIES);

// One stored cert as List returns it — core columns plus the aggregates.
const CERTIFICATE_ROW_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        ...CERTIFICATE_CORE_REQUIRED,
        'metadata',
        'tags',
        'device_group_ids'
    ],
    properties: {
        ...CERTIFICATE_CORE_PROPERTIES,
        metadata: CERTIFICATE_METADATA_SCHEMA,
        tags: CERTIFICATE_TAGS_SCHEMA,
        device_group_ids: CERTIFICATE_GROUP_IDS_SCHEMA
    }
};

// Get is the list row plus the PEM body, which is null unless the caller
// asked for it AND is an admin.
const CERTIFICATE_GET_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [...(CERTIFICATE_ROW_SCHEMA.required ?? []), 'pem'],
    properties: {
        ...(CERTIFICATE_ROW_SCHEMA.properties ?? {}),
        pem: {type: ['string', 'null']}
    }
};

// fn_certificate_import answers with the stored row plus `was_existing`. It
// does not aggregate device_group_ids, so that field is absent here.
const CERTIFICATE_IMPORTED_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        ...CERTIFICATE_CORE_REQUIRED,
        'metadata',
        'tags',
        'was_existing'
    ],
    properties: {
        ...CERTIFICATE_CORE_PROPERTIES,
        metadata: CERTIFICATE_METADATA_SCHEMA,
        tags: CERTIFICATE_TAGS_SCHEMA,
        was_existing: {type: 'boolean'}
    }
};

// fn_certificate_update_name returns the core columns only.
const CERTIFICATE_UPDATED_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: CERTIFICATE_CORE_REQUIRED,
    properties: {...CERTIFICATE_CORE_PROPERTIES}
};

const CERTIFICATE_SET_TAGS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'tags'],
    properties: {id: CERTIFICATE_ID_SCHEMA, tags: CERTIFICATE_TAGS_SCHEMA}
};

const CERTIFICATE_SET_GROUPS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'device_group_ids'],
    properties: {
        id: CERTIFICATE_ID_SCHEMA,
        device_group_ids: CERTIFICATE_GROUP_IDS_SCHEMA
    }
};

// privateKeyPem ships only when asked for and a key is actually stored.
const CERTIFICATE_EXPORT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'pem'],
    properties: {
        id: CERTIFICATE_ID_SCHEMA,
        name: {type: 'string'},
        pem: {type: 'string'},
        privateKeyPem: {type: 'string'}
    }
};

const CERTIFICATE_ISSUE_DEFAULTS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['defaultValidityDays', 'maxValidityDays'],
    properties: {
        defaultValidityDays: {type: 'integer', minimum: 1},
        maxValidityDays: {type: 'integer', minimum: 1}
    }
};

// `warnings` is declared because preflight always returns the key, even
// though nothing currently pushes into it.
const CERTIFICATE_PREFLIGHT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['compatible', 'skipped', 'warnings'],
    properties: {
        compatible: {type: 'array', items: {type: 'string'}},
        skipped: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['shellyId', 'reason'],
                properties: {
                    shellyId: {type: 'string'},
                    reason: {type: 'string'}
                }
            }
        },
        warnings: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['shellyId', 'kind'],
                properties: {
                    shellyId: {type: 'string'},
                    kind: {type: 'string'}
                }
            }
        }
    }
};

const CERTIFICATE_PUSH_TO_DEVICES_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['jobId', 'deviceCount'],
    properties: {
        jobId: {type: 'string', format: 'uuid'},
        deviceCount: {type: 'integer', minimum: 0}
    }
};

const CERTIFICATE_PUSH_ROW_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'job_id',
        'certificate_id',
        'device_id',
        'slot',
        'status',
        'last_error',
        'applied_at',
        'requires_reboot',
        'retry_count'
    ],
    properties: {
        id: {type: 'integer'},
        job_id: {type: 'string', format: 'uuid'},
        certificate_id: CERTIFICATE_ID_SCHEMA,
        device_id: {type: 'string'},
        slot: {type: 'string', enum: [...CERTIFICATE_SLOTS]},
        status: {type: 'string', enum: [...CERTIFICATE_PUSH_STATUSES]},
        last_error: {type: ['string', 'null']},
        applied_at: NULLABLE_TIMESTAMP,
        requires_reboot: {type: 'boolean'},
        retry_count: {type: 'integer', minimum: 0}
    }
};

const CERTIFICATE_PUSH_STATUS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['job', 'rows'],
    properties: {
        job: {
            type: 'object',
            additionalProperties: false,
            required: [
                'id',
                'tenant_id',
                'certificate_id',
                'slot',
                'target_summary',
                'status',
                'started_at',
                'finished_at',
                'created_at',
                'created_by'
            ],
            properties: {
                id: {type: 'string', format: 'uuid'},
                tenant_id: {type: 'string'},
                certificate_id: CERTIFICATE_ID_SCHEMA,
                slot: {type: 'string', enum: [...CERTIFICATE_SLOTS]},
                target_summary: CERTIFICATE_PUSH_TARGET_SCHEMA,
                status: {type: 'string', enum: [...CERTIFICATE_JOB_STATUSES]},
                started_at: NULLABLE_TIMESTAMP,
                finished_at: NULLABLE_TIMESTAMP,
                created_at: {type: 'string', format: 'date-time'},
                created_by: {type: ['string', 'null']}
            }
        },
        rows: {type: 'array', items: CERTIFICATE_PUSH_ROW_SCHEMA}
    }
};

const EMPTY_PARAMS: JsonSchema = {type: 'object', properties: {}};
const ANY_RESPONSE: JsonSchema = {type: 'object', additionalProperties: true};
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
        safety: {operation: 'read'},
        params: CERTIFICATE_LIST_PARAMS_SCHEMA,
        response: listResponseSchema(CERTIFICATE_ROW_SCHEMA),
        permission: READ_PERM,
        description: 'List certificates with optional filters.'
    })
    .registerMethod('Get', {
        safety: {operation: 'read'},
        params: CERTIFICATE_GET_PARAMS_SCHEMA,
        response: CERTIFICATE_GET_RESPONSE_SCHEMA,
        permission: READ_PERM,
        description:
            'Full metadata for one cert. PEM body included only when includePem=true (admin).'
    })
    .registerMethod('Import', {
        safety: {operation: 'create'},
        params: CERTIFICATE_IMPORT_PARAMS_SCHEMA,
        response: CERTIFICATE_IMPORTED_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'Import an unencrypted PEM cert (and optional unencrypted private key). Encrypted keys / PFX are rejected per Shelly TLS KB.'
    })
    .registerMethod('Update', {
        safety: {operation: 'update'},
        params: CERTIFICATE_UPDATE_PARAMS_SCHEMA,
        response: CERTIFICATE_UPDATED_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'Update mutable cert fields (name only). PEM is immutable after import.'
    })
    .registerMethod('Delete', {
        safety: {operation: 'delete'},
        params: CERTIFICATE_DELETE_PARAMS_SCHEMA,
        response: SUCCESS_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'Delete a cert. Refuses if currently pushed and not yet replaced.'
    })
    .registerMethod('SetTags', {
        safety: {operation: 'update'},
        params: CERTIFICATE_SET_TAGS_PARAMS_SCHEMA,
        response: CERTIFICATE_SET_TAGS_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'Replace the tag set on a cert. Free-form labels for filter/search.'
    })
    .registerMethod('SetGroups', {
        safety: {operation: 'update'},
        params: CERTIFICATE_SET_GROUPS_PARAMS_SCHEMA,
        response: CERTIFICATE_SET_GROUPS_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'Replace the device-group bindings (typed FK to organization.groups).'
    })
    .registerMethod('Export', {
        params: CERTIFICATE_EXPORT_PARAMS_SCHEMA,
        response: CERTIFICATE_EXPORT_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'Export cert PEM (+ optional private key). Audited every call.'
    })
    .registerMethod('IssueDeviceCert', {
        safety: {operation: 'create'},
        params: CERTIFICATE_ISSUE_DEVICE_PARAMS_SCHEMA,
        response: CERTIFICATE_IMPORTED_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'FM signs a leaf cert for a shellyID against the local Shelly Fleet Manager Root CA.'
    })
    .registerMethod('SignCsr', {
        safety: {operation: 'create'},
        params: CERTIFICATE_SIGN_CSR_PARAMS_SCHEMA,
        response: CERTIFICATE_IMPORTED_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'FM signs an operator-supplied CSR against the local Shelly Fleet Manager Root CA. Operator keeps the private key on the device that generated the CSR.'
    })
    .registerMethod('GetIssueDefaults', {
        safety: {operation: 'read'},
        params: CERTIFICATE_GET_ISSUE_DEFAULTS_PARAMS_SCHEMA,
        response: CERTIFICATE_ISSUE_DEFAULTS_RESPONSE_SCHEMA,
        permission: READ_PERM,
        description:
            'Returns {defaultValidityDays, maxValidityDays} from FM env. Frontend reads these instead of mirroring FM_UI_CERT_* runtime config.'
    })
    .registerMethod('PreflightPush', {
        safety: {operation: 'read'},
        params: CERTIFICATE_PREFLIGHT_PUSH_PARAMS_SCHEMA,
        response: CERTIFICATE_PREFLIGHT_RESPONSE_SCHEMA,
        permission: READ_PERM,
        description:
            'Resolve the target and report which devices are compatible vs skipped (offline / firmware too old / unsupported key algo / slot incompat) plus warnings (clock skew, enhanced_security off).'
    })
    .registerMethod('PushToDevices', {
        safety: {operation: 'execute'},
        params: CERTIFICATE_PUSH_TO_DEVICES_PARAMS_SCHEMA,
        response: CERTIFICATE_PUSH_TO_DEVICES_RESPONSE_SCHEMA,
        permission: ADMIN_PERM,
        description:
            'Queue a push job that fans the cert out to the resolved target devices in the chosen slot. Returns {jobId, deviceCount}.'
    })
    .registerMethod('PushStatus', {
        safety: {operation: 'read'},
        params: CERTIFICATE_PUSH_STATUS_PARAMS_SCHEMA,
        response: CERTIFICATE_PUSH_STATUS_RESPONSE_SCHEMA,
        permission: READ_PERM,
        description: 'Polling fallback for the WS push event stream.'
    })
    .registerMethod('ListPushes', {
        safety: {operation: 'read'},
        params: CERTIFICATE_LIST_PUSHES_PARAMS_SCHEMA,
        response: listResponseSchema(CERTIFICATE_PUSH_ROW_SCHEMA),
        permission: READ_PERM,
        description: 'List push history scoped by cert / device / job.'
    })
    .build();
