// irlibrary.*: org-level IR code library (learn once, deploy fleet-wide).
// FM-served CRUD + file import (IRDB CSV / Flipper .ir) + push-to-device.
// Code payloads are stored faithfully; the on-device code-write shape is
// not pinned by the BR2 preview-firmware notes yet, so PushToDevice
// passes the stored payload through and is marked hardware-pending.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    MAX_BATCH_SIZE,
    NAME_SCHEMA,
    ORG_ID_SCHEMA,
    SHELLY_ID_SCHEMA
} from './_shared';

export const IR_LIBRARY_SOURCES = [
    'learned',
    'import_irdb',
    'import_flipper',
    'manual'
] as const;
export type IrLibrarySource = (typeof IR_LIBRARY_SOURCES)[number];

/** Sources a caller may claim on Save; import_* is set by ImportFile only. */
export const IR_LIBRARY_SAVE_SOURCES = ['learned', 'manual'] as const;

// DoS caps. Import content cap covers the largest real IRDB/Flipper files
// with slack; payloads are single IR codes (raw Flipper data is a few KB).
export const IR_LIBRARY_IMPORT_MAX_CHARS = 512 * 1024;
export const IR_LIBRARY_PAYLOAD_MAX_BYTES = 16 * 1024;
export const IR_LIBRARY_IMPORT_MAX_ENTRIES = MAX_BATCH_SIZE;
export const IR_LIBRARY_PUSH_MAX_ENTRIES = 50;
export const IR_CATALOG_IMPORT_MAX_REMOTES = 20;

/** One remote in the bundled starter catalog (content stays server-side). */
export interface IrCatalogRemote {
    id: string;
    name: string;
    brand: string;
    deviceType: string;
    codeCount: number;
    protocols: string[];
    sourceRepo: string;
    sourcePath: string;
    license: string;
}

export interface IrLibraryEntry {
    id: number;
    organizationId: string;
    name: string;
    brand: string | null;
    deviceType: string | null;
    protocol: string | null;
    payload: Record<string, unknown>;
    source: IrLibrarySource;
    sourceDetail: string | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string | null;
}

const BRAND_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    minLength: 1,
    maxLength: 120
};
const DEVICE_TYPE_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    minLength: 1,
    maxLength: 64
};
const PROTOCOL_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    minLength: 1,
    maxLength: 64
};
const PAYLOAD_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: IR_LIBRARY_PAYLOAD_MAX_BYTES,
    description:
        'Faithful IR code payload (IRDB row, Flipper signal, or device-read code).'
};
const SOURCE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...IR_LIBRARY_SOURCES]
};
const SOURCE_DETAIL_SCHEMA: JsonSchema = {
    type: ['string', 'null'],
    maxLength: 250
};
const ENTRY_ID_SCHEMA: JsonSchema = {type: 'integer', minimum: 1};

const ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'organizationId',
        'name',
        'brand',
        'deviceType',
        'protocol',
        'payload',
        'source',
        'sourceDetail',
        'createdBy',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: ENTRY_ID_SCHEMA,
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        brand: BRAND_SCHEMA,
        deviceType: DEVICE_TYPE_SCHEMA,
        protocol: PROTOCOL_SCHEMA,
        payload: PAYLOAD_SCHEMA,
        source: SOURCE_SCHEMA,
        sourceDetail: SOURCE_DETAIL_SCHEMA,
        createdBy: {type: ['string', 'null']},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

const ENTRY_LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: ENTRY_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const IRLIBRARY_LIST_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        query: {type: 'string', minLength: 1, maxLength: 120},
        brand: {type: 'string', minLength: 1, maxLength: 120},
        deviceType: {type: 'string', minLength: 1, maxLength: 64},
        source: SOURCE_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    }
};

export const IRLIBRARY_SAVE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['name', 'payload'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        brand: BRAND_SCHEMA,
        deviceType: DEVICE_TYPE_SCHEMA,
        protocol: PROTOCOL_SCHEMA,
        payload: PAYLOAD_SCHEMA,
        source: {type: 'string', enum: [...IR_LIBRARY_SAVE_SOURCES]},
        sourceDetail: SOURCE_DETAIL_SCHEMA
    }
};

export const IRLIBRARY_UPDATE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id', 'patch'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: ENTRY_ID_SCHEMA,
        patch: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: NAME_SCHEMA,
                brand: BRAND_SCHEMA,
                deviceType: DEVICE_TYPE_SCHEMA,
                protocol: PROTOCOL_SCHEMA,
                payload: PAYLOAD_SCHEMA
            }
        }
    }
};

export const IRLIBRARY_DELETE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: ENTRY_ID_SCHEMA
    }
};

export const IRLIBRARY_IMPORT_FILE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['filename', 'content'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        filename: {type: 'string', minLength: 1, maxLength: 255},
        content: {
            type: 'string',
            minLength: 1,
            maxLength: IR_LIBRARY_IMPORT_MAX_CHARS,
            description: 'File text (IRDB .csv or Flipper .ir).'
        },
        brand: BRAND_SCHEMA,
        deviceType: DEVICE_TYPE_SCHEMA,
        dryRun: {
            type: 'boolean',
            description: 'Parse and preview only; nothing is stored.'
        }
    }
};

const IMPORT_SKIP_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['line', 'reason'],
    properties: {
        line: {type: 'integer'},
        reason: {type: 'string'}
    }
};

const IMPORT_PREVIEW_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name', 'protocol', 'payload'],
    properties: {
        name: NAME_SCHEMA,
        protocol: PROTOCOL_SCHEMA,
        payload: PAYLOAD_SCHEMA
    }
};

const IMPORT_FILE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['format', 'parsed', 'imported', 'skipped', 'dryRun'],
    properties: {
        format: {type: 'string', enum: ['irdb_csv', 'flipper_ir']},
        parsed: {type: 'integer'},
        imported: {type: 'integer'},
        skipped: {type: 'array', items: IMPORT_SKIP_SCHEMA},
        dryRun: {type: 'boolean'},
        preview: {
            type: 'array',
            items: IMPORT_PREVIEW_ENTRY_SCHEMA,
            description: 'Parsed codes (dry run only).'
        },
        entries: {
            type: 'array',
            items: ENTRY_SCHEMA,
            description: 'Stored entries (non-dry-run only).'
        }
    }
};

const CATALOG_REMOTE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'name',
        'brand',
        'deviceType',
        'codeCount',
        'protocols',
        'sourceRepo',
        'sourcePath',
        'license'
    ],
    properties: {
        id: {type: 'string'},
        name: NAME_SCHEMA,
        brand: {type: 'string'},
        deviceType: {type: 'string'},
        codeCount: {type: 'integer'},
        protocols: {type: 'array', items: {type: 'string'}},
        sourceRepo: {type: 'string'},
        sourcePath: {
            type: 'string',
            description: 'File path inside the source repository.'
        },
        license: {
            type: 'string',
            description: 'SPDX license id of the bundled data (CC0-1.0).'
        }
    }
};

const CATALOG_LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: CATALOG_REMOTE_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const IRLIBRARY_CATALOG_LIST_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        query: {type: 'string', minLength: 1, maxLength: 120},
        brand: {type: 'string', minLength: 1, maxLength: 120},
        deviceType: {type: 'string', minLength: 1, maxLength: 64},
        limit: {type: 'integer', minimum: 1, maximum: 500},
        offset: {type: 'integer', minimum: 0}
    }
};

export const IRLIBRARY_IMPORT_CATALOG_PARAMS: JsonSchema = {
    type: 'object',
    required: ['ids'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        ids: {
            type: 'array',
            minItems: 1,
            maxItems: IR_CATALOG_IMPORT_MAX_REMOTES,
            items: {type: 'string', minLength: 1, maxLength: 200},
            description: 'Catalog remote ids from CatalogList.'
        },
        dryRun: {
            type: 'boolean',
            description: 'Parse and preview only; nothing is stored.'
        }
    }
};

const IMPORT_CATALOG_REMOTE_RESULT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'name', 'parsed', 'imported', 'skipped'],
    properties: {
        id: {type: 'string'},
        name: NAME_SCHEMA,
        parsed: {type: 'integer'},
        imported: {type: 'integer'},
        skipped: {type: 'array', items: IMPORT_SKIP_SCHEMA}
    }
};

const IMPORT_CATALOG_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['imported', 'dryRun', 'remotes'],
    properties: {
        imported: {type: 'integer'},
        dryRun: {type: 'boolean'},
        remotes: {type: 'array', items: IMPORT_CATALOG_REMOTE_RESULT_SCHEMA},
        entries: {
            type: 'array',
            items: ENTRY_SCHEMA,
            description: 'Stored entries (non-dry-run only).'
        }
    }
};

export const IRLIBRARY_PUSH_TO_DEVICE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'entryIds'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        shellyID: SHELLY_ID_SCHEMA,
        entryIds: {
            type: 'array',
            minItems: 1,
            maxItems: IR_LIBRARY_PUSH_MAX_ENTRIES,
            items: ENTRY_ID_SCHEMA
        },
        irDeviceId: {
            type: 'integer',
            minimum: 0,
            description: 'Existing irdevice:N component to write codes into.'
        },
        createDeviceName: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description:
                'Create a new irdevice with this name and push into it.'
        }
    }
};

const PUSH_RESULT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['entryId', 'ok'],
    properties: {
        entryId: ENTRY_ID_SCHEMA,
        ok: {type: 'boolean'},
        error: {type: 'string'},
        response: {type: 'object', description: 'Device-defined response.'}
    }
};

const PUSH_TO_DEVICE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'shellyID',
        'irDeviceId',
        'createdDevice',
        'hardwarePinned',
        'results'
    ],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        irDeviceId: {type: ['integer', 'null']},
        createdDevice: {type: 'boolean'},
        hardwarePinned: {
            type: 'boolean',
            description:
                'Always false until firmware docs pin the IRCode write shape.'
        },
        results: {type: 'array', items: PUSH_RESULT_SCHEMA}
    }
};

const DELETED_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deleted', 'id'],
    properties: {
        deleted: {type: 'boolean'},
        id: ENTRY_ID_SCHEMA
    }
};

export const IRLIBRARY_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'irlibrary',
    {
        kind: 'fleet-manager',
        description:
            'Org-level IR code library: store learned/imported IR codes once, push them to any IR-capable device.'
    }
)
    .registerMethod('List', {
        params: IRLIBRARY_LIST_PARAMS,
        response: ENTRY_LIST_ENVELOPE,
        permission: {component: 'configurations', operation: 'read'},
        description:
            'List library entries with brand/device-type/source filters and name search.'
    })
    .registerMethod('Save', {
        params: IRLIBRARY_SAVE_PARAMS,
        response: ENTRY_SCHEMA,
        permission: {component: 'configurations', operation: 'create'},
        description:
            'Store one IR code (learned from a device or entered manually). Payload is kept faithful.'
    })
    .registerMethod('Update', {
        params: IRLIBRARY_UPDATE_PARAMS,
        response: ENTRY_SCHEMA,
        permission: {component: 'configurations', operation: 'update'},
        description:
            'Partial-update an entry. Null clears brand/deviceType/protocol; source is immutable.'
    })
    .registerMethod('Delete', {
        params: IRLIBRARY_DELETE_PARAMS,
        response: DELETED_SCHEMA,
        permission: {component: 'configurations', operation: 'delete'},
        description: 'Delete one library entry.'
    })
    .registerMethod('ImportFile', {
        params: IRLIBRARY_IMPORT_FILE_PARAMS,
        response: IMPORT_FILE_RESPONSE_SCHEMA,
        permission: {component: 'configurations', operation: 'create'},
        description:
            'Import IR codes from an IRDB .csv or Flipper .ir file. dryRun returns a parse preview without storing. Unknown formats are rejected.'
    })
    .registerMethod('CatalogList', {
        params: IRLIBRARY_CATALOG_LIST_PARAMS,
        response: CATALOG_LIST_ENVELOPE,
        permission: {component: 'configurations', operation: 'read'},
        description:
            'Browse the bundled IR starter catalog (curated from Flipper-IRDB, CC0-1.0) with brand/device-type filters and name search. Read-only; nothing is fetched at runtime.'
    })
    .registerMethod('ImportCatalog', {
        params: IRLIBRARY_IMPORT_CATALOG_PARAMS,
        response: IMPORT_CATALOG_RESPONSE_SCHEMA,
        permission: {component: 'configurations', operation: 'create'},
        description:
            'Import selected catalog remotes into the org library through the standard Flipper parser, with catalog provenance in sourceDetail. dryRun previews parse results without storing.'
    })
    .registerMethod('PushToDevice', {
        params: IRLIBRARY_PUSH_TO_DEVICE_PARAMS,
        response: PUSH_TO_DEVICE_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'execute'},
        description:
            'Write library entries to an IR controller via IR.AddDevice/IRCode.SetConfig. Preview firmware: the code-write shape is not documented, so the stored payload is passed through faithfully (hardware-pending).'
    })
    .build();
