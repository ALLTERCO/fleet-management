/** Shared JSON-schema fragments used by multiple api/* modules. */

import type {JsonSchema} from './_schema';

// Zitadel org ids — opaque alphanumeric-plus-separator strings.
export const ORG_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120,
    pattern: '^[A-Za-z0-9._-]+$'
};

// Spec §7.1 name: required, trimmed, 1..120; `\S` rejects whitespace-only.
export const NAME_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    pattern: '\\S'
};

// DoS caps — enforced by validateParams via maxProperties + maxBytes.
export const METADATA_MAX_PROPERTIES = 100;
export const METADATA_MAX_BYTES = 64 * 1024;

/** Upper bound on array size for any batch RPC (add/remove members, ids,
 *  rule scopes, ...). Raise deliberately — hot-path schemas share this cap. */
export const MAX_BATCH_SIZE = 500;
export const METADATA_SCHEMA: JsonSchema = {
    type: 'object',
    maxProperties: METADATA_MAX_PROPERTIES,
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: true
};

// Spec §4 summary_counts_t.
export interface SummaryCounts {
    childLocations?: number;
    childGroups?: number;
    devices?: number;
    entities?: number;
    locations?: number;
    tags?: number;
    descendantDevices?: number;
    descendantEntities?: number;
    groupsReferencingLocation?: number;
}

export const SUMMARY_COUNTS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        childLocations: {type: 'integer', minimum: 0},
        childGroups: {type: 'integer', minimum: 0},
        devices: {type: 'integer', minimum: 0},
        entities: {type: 'integer', minimum: 0},
        locations: {type: 'integer', minimum: 0},
        tags: {type: 'integer', minimum: 0},
        descendantDevices: {type: 'integer', minimum: 0},
        descendantEntities: {type: 'integer', minimum: 0},
        groupsReferencingLocation: {type: 'integer', minimum: 0}
    }
};

// Email attachment primitives. Each item references its payload by
// either `url` (external fetch) or `assetId` (row in
// notifications.email_assets). Exactly-one-of enforcement lives in the
// backend handler (validateEmailAttachments) — not in the shared schema
// because validateParams doesn't model oneOf.
export interface EmailAttachment {
    filename: string;
    url?: string;
    assetId?: number;
    cid?: string;
    contentType?: string;
}

export const EMAIL_ATTACHMENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['filename'],
    properties: {
        filename: {type: 'string', minLength: 1, maxLength: 255},
        url: {type: 'string', minLength: 1, maxLength: 2048},
        assetId: {type: 'integer', minimum: 1},
        cid: {type: 'string', minLength: 1, maxLength: 120},
        contentType: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export const EMAIL_ATTACHMENTS_SCHEMA: JsonSchema = {
    type: 'array',
    items: EMAIL_ATTACHMENT_SCHEMA
};

// Shelly device identity used by public device-facing APIs.
export const SHELLY_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120,
    description: 'Target Shelly device identifier'
};

export const DEVICE_CONFIG_PATCH_SCHEMA: JsonSchema = {
    type: 'object',
    description:
        'Partial config patch — device is final authority on valid keys'
};

export const SHELLY_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        config: DEVICE_CONFIG_PATCH_SCHEMA
    }
};

export const RESTART_REQUIRED_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}},
    description:
        'Shelly SetConfig response — device reports whether reboot needed'
};

export const TLS_UPLOAD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'append'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        data: {
            type: ['string', 'null'],
            description: 'PEM contents, or null to delete'
        },
        append: {type: 'boolean'}
    }
};

export const TLS_UPLOAD_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {length: {type: 'integer'}},
    description: 'Shelly TLS upload response: uploaded byte length'
};
