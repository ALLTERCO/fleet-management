/**
 * Public API types for the `Firmware.*` namespace — firmware library CRUD.
 *
 * Single source of truth for the library-item shape and every method's
 * param / response types. Backend component imports these; frontend also
 * imports via the `@api` tsconfig + vite alias so the two sides stay
 * byte-identical on every contract change.
 *
 * Methods covered:
 *   - Firmware.ListLibrary
 *   - Firmware.CreateLibraryDownloadUrl
 *   - Firmware.UpdateLibraryEntry
 *   - Firmware.DeleteLibraryEntry
 *
 * Device-update methods (RegisterManualUpdate / SetAutoUpdate* /
 * TriggerAutoUpdate) predate this file; their types live inline in
 * FirmwareComponent until a follow-up moves them here.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {UPLOAD_TICKET_RESPONSE_SCHEMA} from './upload';

// --- Domain type ---------------------------------------------------------

/**
 * A firmware binary stored in the library. Written once at upload time
 * (`POST /media/uploadFirmwareFile` — stays HTTP), then read / patched /
 * deleted via the Firmware.*Library RPC methods.
 */
export interface FirmwareLibraryItem {
    /** UUID assigned at upload time — primary key */
    id: string;
    /** Human-readable label shown in the UI; defaults to the filename stem */
    name: string;
    /** Original filename as uploaded by the user, pre-sanitization */
    originalFileName: string;
    /** On-disk filename inside `uploads/firmware-library/` */
    storedFileName: string;
    /** Unix milliseconds when the item was stored */
    uploadedAt: number;
    /** Username from the uploading session ('unknown' if unavailable) */
    uploadedBy: string;
    /** Byte size of the stored file */
    fileSize: number;
    /** SHA-256 hex digest of the stored file */
    checksum: string;
    /** Optional Shelly app identifier this firmware targets */
    app?: string;
    /** Optional Shelly model number this firmware targets */
    model?: string;
    /** Optional firmware version string (e.g. "1.4.0") */
    ver?: string;
    /** Optional Shelly-assigned firmware build id (path-like: "…/abc123") */
    fwId?: string;
    /** Release channel — empty string clears, `custom` for out-of-band builds */
    channel?: 'stable' | 'beta' | 'custom';
    /** Free-form tags, comma-split on upload, capped at 20 entries */
    tags: string[];
}

/**
 * Resource type label emitted in `data.details.resourceType` when a
 * `Firmware.*Library` method raises `ResourceNotFound`. Frontend
 * consumers match on this to drive UI behavior (e.g. pruning stale
 * rows). Centralized here so backend throw-sites and frontend
 * check-sites share one literal.
 */
export const FIRMWARE_LIBRARY_ITEM_RESOURCE_TYPE = 'firmware_library_item';

// --- Regex / path literals (shared between backend validators and tests) -

/**
 * Canonical pattern for library-item IDs. Single source of truth for both
 * the JSON-schema `pattern` field and the runtime regex check performed
 * inside the RPC handlers.
 */
export const FIRMWARE_LIBRARY_ID_PATTERN = '^[\\w.-]+$';
export const FIRMWARE_LIBRARY_ID_REGEX = new RegExp(
    FIRMWARE_LIBRARY_ID_PATTERN
);

// --- Params / response per method ----------------------------------------

export type FirmwareListLibraryParams = Record<string, never>;

export interface FirmwareListLibraryResponse {
    items: FirmwareLibraryItem[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

export interface FirmwareCreateLibraryDownloadUrlParams {
    id: string;
}

export interface FirmwareCreateLibraryDownloadUrlResponse {
    /** Relative path under `/media/firmware-file/{token}`. 1-hour TTL. */
    url: string;
}

export interface FirmwareUpdateLibraryEntryParams {
    id: string;
    name?: string;
    app?: string;
    model?: string;
    ver?: string;
    fwId?: string;
    /** 'stable'|'beta'|'custom' to set, '' to clear, omit to leave */
    channel?: string;
    /** Comma-separated tags; backend splits + trims + caps at 20 */
    tags?: string;
}

export interface FirmwareUpdateLibraryEntryResponse {
    success: true;
    item: FirmwareLibraryItem;
}

export interface FirmwareDeleteLibraryEntryParams {
    id: string;
}

export interface FirmwareDeleteLibraryEntryResponse {
    success: true;
}

// --- JSON Schemas (runtime validation + Describe) -----------------------

const ID_FIELD_SCHEMA: JsonSchema = {
    type: 'string',
    pattern: FIRMWARE_LIBRARY_ID_PATTERN,
    minLength: 1,
    maxLength: 120,
    description: 'Firmware library item ID (UUID or safe filename stem)'
};

export const FIRMWARE_LIST_LIBRARY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const FIRMWARE_LIST_LIBRARY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: {type: 'object'}},
        total: {type: 'number'},
        limit: {type: 'number'},
        offset: {type: 'number'},
        has_more: {type: 'boolean'}
    }
};

export const FIRMWARE_CREATE_LIBRARY_DOWNLOAD_URL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: ID_FIELD_SCHEMA}
};

export const FIRMWARE_CREATE_LIBRARY_DOWNLOAD_URL_RESPONSE_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['url'],
        properties: {url: {type: 'string'}}
    };

export const FIRMWARE_UPDATE_LIBRARY_ENTRY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: ID_FIELD_SCHEMA,
        name: {type: 'string', maxLength: 120},
        app: {type: 'string', maxLength: 120},
        model: {type: 'string', maxLength: 120},
        ver: {type: 'string', maxLength: 120},
        fwId: {type: 'string', maxLength: 120},
        channel: {type: 'string', enum: ['stable', 'beta', 'custom', '']},
        tags: {type: 'string', maxLength: 500}
    }
};

export const FIRMWARE_UPDATE_LIBRARY_ENTRY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['success', 'item'],
    properties: {
        success: {type: 'boolean', const: true},
        item: {type: 'object'}
    }
};

export const FIRMWARE_DELETE_LIBRARY_ENTRY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: ID_FIELD_SCHEMA}
};

export const FIRMWARE_DELETE_LIBRARY_ENTRY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['success'],
    properties: {success: {type: 'boolean', const: true}}
};

// --- Device-update schemas (auto-update + manual register) ---------------

const SHELLY_ID_LIST: JsonSchema = {
    type: 'array',
    items: {type: 'string', minLength: 1},
    minItems: 1
};

const ACK: JsonSchema = {type: 'object', additionalProperties: true};

const AUTO_UPDATE_MODE_VALUES = ['off', 'stable', 'beta'] as const;
export type FirmwareAutoUpdateMode = (typeof AUTO_UPDATE_MODE_VALUES)[number];

export interface FirmwareRegisterManualUpdateParams {
    shellyIDs: string[];
    ttlMs?: number;
    ownerToken?: string;
}
export const FIRMWARE_REGISTER_MANUAL_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyIDs'],
    additionalProperties: false,
    properties: {
        shellyIDs: SHELLY_ID_LIST,
        ttlMs: {type: 'integer', minimum: 60000, maximum: 30 * 60 * 1000},
        ownerToken: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export interface FirmwareUnregisterManualUpdateParams {
    shellyIDs: string[];
    ownerToken?: string;
}
export const FIRMWARE_UNREGISTER_MANUAL_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyIDs'],
    additionalProperties: false,
    properties: {
        shellyIDs: SHELLY_ID_LIST,
        ownerToken: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export interface FirmwareStartUpdateJobParams {
    shellyIDs: string[];
    channel?: 'stable' | 'beta';
    url?: string;
    targetBuildIdHint?: string;
    idempotencyKey?: string;
    /** Permit flashing a build that is not newer than the device's current
     * firmware. Off by default so a stale image can't silently downgrade. */
    allowDowngrade?: boolean;
}

export interface FirmwareStartUpdateJobResponse {
    jobId: string;
}

export const FIRMWARE_START_UPDATE_JOB_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyIDs'],
    additionalProperties: false,
    properties: {
        shellyIDs: SHELLY_ID_LIST,
        channel: {type: 'string', enum: ['stable', 'beta']},
        // Any url the device accepts. The device performs the fetch (not FM),
        // and FM-hosted firmware is still checksum-verified at dispatch time.
        url: {
            type: 'string',
            minLength: 1,
            maxLength: 4096
        },
        targetBuildIdHint: {type: 'string', minLength: 1, maxLength: 256},
        idempotencyKey: {type: 'string', minLength: 1, maxLength: 160},
        allowDowngrade: {type: 'boolean'}
    }
};

export const FIRMWARE_START_UPDATE_JOB_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['jobId'],
    additionalProperties: false,
    properties: {
        jobId: {type: 'string', minLength: 1}
    }
};

export interface FirmwareSetAutoUpdateParams {
    shellyID: string;
    enabled: boolean;
}
export const FIRMWARE_SET_AUTO_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'enabled'],
    additionalProperties: false,
    properties: {
        shellyID: {type: 'string', minLength: 1},
        enabled: {type: 'boolean'}
    }
};

export interface FirmwareSetAutoUpdateBulkParams {
    shellyIDs: string[];
    enabled: boolean;
}
export const FIRMWARE_SET_AUTO_UPDATE_BULK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyIDs', 'enabled'],
    additionalProperties: false,
    properties: {shellyIDs: SHELLY_ID_LIST, enabled: {type: 'boolean'}}
};

export interface FirmwareSetAutoUpdateModeParams {
    shellyID: string;
    mode: FirmwareAutoUpdateMode;
}
export const FIRMWARE_SET_AUTO_UPDATE_MODE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'mode'],
    additionalProperties: false,
    properties: {
        shellyID: {type: 'string', minLength: 1},
        mode: {type: 'string', enum: [...AUTO_UPDATE_MODE_VALUES]}
    }
};

export interface FirmwareSetAutoUpdateModeBulkParams {
    shellyIDs: string[];
    mode: FirmwareAutoUpdateMode;
}
export const FIRMWARE_SET_AUTO_UPDATE_MODE_BULK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyIDs', 'mode'],
    additionalProperties: false,
    properties: {
        shellyIDs: SHELLY_ID_LIST,
        mode: {type: 'string', enum: [...AUTO_UPDATE_MODE_VALUES]}
    }
};

export interface FirmwareSetAutoUpdateChannelParams {
    channel: 'stable' | 'beta';
}
export const FIRMWARE_SET_AUTO_UPDATE_CHANNEL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['channel'],
    additionalProperties: false,
    properties: {
        channel: {type: 'string', enum: ['stable', 'beta']}
    }
};

export interface FirmwareGetAutoUpdateStatusParams {
    shellyID: string;
}
export const FIRMWARE_GET_AUTO_UPDATE_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: {type: 'string', minLength: 1}}
};

export interface FirmwareGetAutoUpdateModeParams {
    shellyID: string;
}
export const FIRMWARE_GET_AUTO_UPDATE_MODE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: {type: 'string', minLength: 1}}
};

export type FirmwareGetAutoUpdateChannelParams = Record<string, never>;
export const FIRMWARE_GET_AUTO_UPDATE_CHANNEL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export type FirmwareGetAutoUpdateDevicesParams = Record<string, never>;
export const FIRMWARE_GET_AUTO_UPDATE_DEVICES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export type FirmwareGetAutoUpdateModesParams = Record<string, never>;
export const FIRMWARE_GET_AUTO_UPDATE_MODES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export type FirmwareGetLastAutoUpdateRunParams = Record<string, never>;
export const FIRMWARE_GET_LAST_AUTO_UPDATE_RUN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export type FirmwareTriggerAutoUpdateParams = Record<string, never>;
export const FIRMWARE_TRIGGER_AUTO_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export type FirmwareAutoUpdateResultStatus =
    | 'queued'
    | 'no_update'
    | 'offline'
    | 'failed'
    | 'skipped';

export interface FirmwareAutoUpdateResult {
    shellyID: string;
    status: FirmwareAutoUpdateResultStatus;
    channel?: 'stable' | 'beta';
    jobId?: string;
    error?: string;
}

export interface FirmwareAutoUpdateJobRef {
    jobId: string;
    tenantId: string;
    channel: 'stable' | 'beta';
    shellyIDs: string[];
}

export interface FirmwareTriggerAutoUpdateResponse {
    checked: number;
    queued: number;
    skipped: number;
    failed: number;
    jobs: FirmwareAutoUpdateJobRef[];
    results: FirmwareAutoUpdateResult[];
}

export const FIRMWARE_TRIGGER_AUTO_UPDATE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['checked', 'queued', 'skipped', 'failed', 'jobs', 'results'],
    additionalProperties: false,
    properties: {
        checked: {type: 'integer', minimum: 0},
        queued: {type: 'integer', minimum: 0},
        skipped: {type: 'integer', minimum: 0},
        failed: {type: 'integer', minimum: 0},
        jobs: {
            type: 'array',
            items: {
                type: 'object',
                required: ['jobId', 'tenantId', 'channel', 'shellyIDs'],
                additionalProperties: false,
                properties: {
                    jobId: {type: 'string', minLength: 1},
                    tenantId: {type: 'string', minLength: 1},
                    channel: {type: 'string', enum: ['stable', 'beta']},
                    shellyIDs: SHELLY_ID_LIST
                }
            }
        },
        results: {
            type: 'array',
            items: {
                type: 'object',
                required: ['shellyID', 'status'],
                additionalProperties: false,
                properties: {
                    shellyID: {type: 'string', minLength: 1},
                    status: {
                        type: 'string',
                        enum: [
                            'queued',
                            'no_update',
                            'offline',
                            'failed',
                            'skipped'
                        ]
                    },
                    channel: {type: 'string', enum: ['stable', 'beta']},
                    jobId: {type: 'string', minLength: 1},
                    error: {type: 'string', minLength: 1}
                }
            }
        }
    }
};

// --- Describe ------------------------------------------------------------

export const FIRMWARE_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'firmware',
    {
        kind: 'fleet-manager',
        description:
            'Manage the firmware library and orchestrate device update jobs and auto-update.'
    }
)
    .registerMethod('RegisterManualUpdate', {
        params: FIRMWARE_REGISTER_MANUAL_UPDATE_PARAMS_SCHEMA,
        response: ACK,
        permission: {note: 'per-device execute or admin'},
        description: 'Register a manual update for one or more devices.'
    })
    .registerMethod('UnregisterManualUpdate', {
        params: FIRMWARE_UNREGISTER_MANUAL_UPDATE_PARAMS_SCHEMA,
        response: ACK,
        permission: {note: 'per-device execute or admin'},
        description: 'Cancel a previously registered manual update.'
    })
    .registerMethod('StartUpdateJob', {
        params: FIRMWARE_START_UPDATE_JOB_PARAMS_SCHEMA,
        response: FIRMWARE_START_UPDATE_JOB_RESPONSE_SCHEMA,
        permission: {note: 'per-device execute or admin'},
        description:
            'Start a backend-owned firmware update job for one or more devices.'
    })
    .registerMethod('GetAutoUpdateDevices', {
        params: FIRMWARE_GET_AUTO_UPDATE_DEVICES_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'List devices with auto-update configured.'
    })
    .registerMethod('GetAutoUpdateModes', {
        params: FIRMWARE_GET_AUTO_UPDATE_MODES_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Return the supported auto-update modes.'
    })
    .registerMethod('SetAutoUpdate', {
        params: FIRMWARE_SET_AUTO_UPDATE_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Enable or disable auto-update for a single device.'
    })
    .registerMethod('SetAutoUpdateBulk', {
        params: FIRMWARE_SET_AUTO_UPDATE_BULK_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Bulk enable/disable auto-update.'
    })
    .registerMethod('GetAutoUpdateStatus', {
        params: FIRMWARE_GET_AUTO_UPDATE_STATUS_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Return the current auto-update status for a device.'
    })
    .registerMethod('GetAutoUpdateMode', {
        params: FIRMWARE_GET_AUTO_UPDATE_MODE_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Return the auto-update mode for a device.'
    })
    .registerMethod('SetAutoUpdateMode', {
        params: FIRMWARE_SET_AUTO_UPDATE_MODE_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Set the auto-update mode for a single device.'
    })
    .registerMethod('SetAutoUpdateModeBulk', {
        params: FIRMWARE_SET_AUTO_UPDATE_MODE_BULK_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Bulk set the auto-update mode for a list of devices.'
    })
    .registerMethod('GetAutoUpdateChannel', {
        params: FIRMWARE_GET_AUTO_UPDATE_CHANNEL_PARAMS_SCHEMA,
        response: ACK,
        permission: {note: 'provider-support-only'},
        description: 'Return the global default firmware channel (stable/beta).'
    })
    .registerMethod('SetAutoUpdateChannel', {
        params: FIRMWARE_SET_AUTO_UPDATE_CHANNEL_PARAMS_SCHEMA,
        response: ACK,
        permission: {note: 'provider-support-only'},
        description:
            'Set the global default firmware channel (stable/beta) for legacy enables.'
    })
    .registerMethod('GetLastAutoUpdateRun', {
        params: FIRMWARE_GET_LAST_AUTO_UPDATE_RUN_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Return metadata for the most recent scheduler run.'
    })
    .registerMethod('TriggerAutoUpdate', {
        params: FIRMWARE_TRIGGER_AUTO_UPDATE_PARAMS_SCHEMA,
        response: FIRMWARE_TRIGGER_AUTO_UPDATE_RESPONSE_SCHEMA,
        permission: {note: 'provider-support-only'},
        description:
            'Check auto-update candidates and enqueue durable firmware update jobs.'
    })
    .registerMethod('ListLibrary', {
        params: FIRMWARE_LIST_LIBRARY_PARAMS_SCHEMA,
        response: FIRMWARE_LIST_LIBRARY_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'List firmware library entries (uploaded binaries + metadata).'
    })
    .registerMethod('CreateUploadTicket', {
        params: FIRMWARE_LIST_LIBRARY_PARAMS_SCHEMA,
        response: UPLOAD_TICKET_RESPONSE_SCHEMA,
        permission: {note: 'provider-support-only'},
        description:
            'Mint a short-lived ticket for POST /media/uploadFirmwareFile.'
    })
    .registerMethod('CreateLibraryDownloadUrl', {
        params: FIRMWARE_CREATE_LIBRARY_DOWNLOAD_URL_PARAMS_SCHEMA,
        response: FIRMWARE_CREATE_LIBRARY_DOWNLOAD_URL_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description: 'Mint a 1-hour download URL for a library entry.'
    })
    .registerMethod('UpdateLibraryEntry', {
        params: FIRMWARE_UPDATE_LIBRARY_ENTRY_PARAMS_SCHEMA,
        response: FIRMWARE_UPDATE_LIBRARY_ENTRY_RESPONSE_SCHEMA,
        permission: {note: 'provider-support-only'},
        description: 'Patch metadata on a library entry.'
    })
    .registerMethod('DeleteLibraryEntry', {
        params: FIRMWARE_DELETE_LIBRARY_ENTRY_PARAMS_SCHEMA,
        response: FIRMWARE_DELETE_LIBRARY_ENTRY_RESPONSE_SCHEMA,
        permission: {note: 'provider-support-only'},
        description: 'Delete a library entry by id.'
    })
    .build();
