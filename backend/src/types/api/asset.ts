import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export interface VisualAssetDto {
    id: string;
    url: string;
    sha256: string;
    contentType: string;
    sizeBytes: number;
    label: string | null;
    uploadedBy: string | null;
    context: string;
    created: string;
}

const VISUAL_ASSET_DTO_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'url',
        'sha256',
        'contentType',
        'sizeBytes',
        'label',
        'uploadedBy',
        'context',
        'created'
    ],
    properties: {
        id: {type: 'string', format: 'uuid'},
        url: {type: 'string'},
        sha256: {type: 'string', minLength: 64, maxLength: 64},
        contentType: {type: 'string'},
        sizeBytes: {type: 'integer', minimum: 1},
        label: {type: ['string', 'null'], maxLength: 255},
        uploadedBy: {type: ['string', 'null']},
        context: {type: 'string', maxLength: 32},
        created: {type: 'string'}
    }
};

const ASSET_CONTENT_TYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/svg+xml'
] as const;
const ASSET_UPLOAD_MAX_BASE64_CHARS = 1_398_104;
const ASSET_READ_MAX_CHUNK_BYTES = 128 * 1024;

export interface AssetUploadParams {
    organizationId?: string;
    contentType: (typeof ASSET_CONTENT_TYPES)[number];
    data: string;
    label?: string | null;
    context?: string;
}

export const ASSET_UPLOAD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['contentType', 'data'],
    properties: {
        organizationId: {type: 'string', minLength: 1, maxLength: 120},
        contentType: {type: 'string', enum: [...ASSET_CONTENT_TYPES]},
        data: {
            type: 'string',
            minLength: 4,
            maxLength: ASSET_UPLOAD_MAX_BASE64_CHARS,
            description:
                'Canonical padded standard base64. Decoded input is capped at 1 MiB and may be lower when FM_VIRTUAL_IMAGE_MAX_BYTES is lower.'
        },
        label: {type: ['string', 'null'], maxLength: 255},
        context: {type: 'string', minLength: 1, maxLength: 32}
    }
};

export interface AssetReadChunkParams {
    organizationId?: string;
    id: string;
    offset?: number;
    maxBytes?: number;
}

export const ASSET_READ_CHUNK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        organizationId: {type: 'string', minLength: 1, maxLength: 120},
        id: {type: 'string', format: 'uuid'},
        offset: {type: 'integer', minimum: 0},
        maxBytes: {
            type: 'integer',
            minimum: 1,
            maximum: ASSET_READ_MAX_CHUNK_BYTES,
            default: 65_536
        }
    }
};

export interface AssetReadChunkResult {
    id: string;
    contentType: string;
    sha256: string;
    totalSizeBytes: number;
    offset: number;
    nextOffset: number;
    eof: boolean;
    data: string;
}

export const ASSET_READ_CHUNK_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'contentType',
        'sha256',
        'totalSizeBytes',
        'offset',
        'nextOffset',
        'eof',
        'data'
    ],
    properties: {
        id: {type: 'string', format: 'uuid'},
        contentType: {type: 'string'},
        sha256: {type: 'string', minLength: 64, maxLength: 64},
        totalSizeBytes: {type: 'integer', minimum: 1},
        offset: {type: 'integer', minimum: 0},
        nextOffset: {type: 'integer', minimum: 0},
        eof: {type: 'boolean'},
        data: {
            type: 'string',
            description: 'Canonical standard base64 for this chunk.'
        }
    }
};

export interface AssetListParams {
    organizationId?: string;
    limit?: number;
    cursor?: string;
    search?: string;
    context?: string;
}

export const ASSET_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: {type: 'string', minLength: 1, maxLength: 120},
        limit: {type: 'integer', minimum: 1, maximum: 200},
        cursor: {type: 'string'},
        search: {type: 'string', maxLength: 100},
        context: {type: 'string', maxLength: 32}
    }
};

export interface AssetListResult {
    items: VisualAssetDto[];
    nextCursor: string | null;
}

export const ASSET_LIST_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['items', 'nextCursor'],
    properties: {
        items: {type: 'array', items: VISUAL_ASSET_DTO_SCHEMA},
        nextCursor: {type: ['string', 'null']}
    }
};

export interface AssetSetLabelParams {
    id: string;
    label: string | null;
    organizationId?: string;
}

export const ASSET_SET_LABEL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        label: {type: ['string', 'null'], maxLength: 255},
        organizationId: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export interface AssetDeleteParams {
    id: string;
    organizationId?: string;
}

export const ASSET_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
        id: {type: 'string', format: 'uuid'},
        organizationId: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export interface AssetDeleteResult {
    deleted: true;
    id: string;
}

export const ASSET_DELETE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['deleted', 'id'],
    properties: {
        deleted: {type: 'boolean', enum: [true]},
        id: {type: 'string', format: 'uuid'}
    }
};

export const ASSET_MIGRATE_IMAGES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export type AssetMigrateImagesParams = Record<string, never>;

export interface AssetMigrateImagesTableResult {
    table: string;
    scanned: number;
    alreadyUuid: number;
    migrated: number;
    fileMissing: number;
    failed: number;
}

export interface AssetMigrateImagesResult {
    actor: string;
    startedAt: string;
    finishedAt: string;
    tables: AssetMigrateImagesTableResult[];
}

const TABLE_RESULT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'table',
        'scanned',
        'alreadyUuid',
        'migrated',
        'fileMissing',
        'failed'
    ],
    properties: {
        table: {type: 'string'},
        scanned: {type: 'integer', minimum: 0},
        alreadyUuid: {type: 'integer', minimum: 0},
        migrated: {type: 'integer', minimum: 0},
        fileMissing: {type: 'integer', minimum: 0},
        failed: {type: 'integer', minimum: 0}
    }
};

export const ASSET_MIGRATE_IMAGES_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['actor', 'startedAt', 'finishedAt', 'tables'],
    properties: {
        actor: {type: 'string'},
        startedAt: {type: 'string'},
        finishedAt: {type: 'string'},
        tables: {type: 'array', items: TABLE_RESULT_SCHEMA}
    }
};

export const ASSET_DESCRIBE: DescribeOutput = new DescribeBuilder('asset', {
    kind: 'fleet-manager',
    description:
        'Manage and transfer reusable images in the visual asset library.'
})
    .registerMethod('Upload', {
        safety: {operation: 'create'},
        params: ASSET_UPLOAD_PARAMS_SCHEMA,
        response: VISUAL_ASSET_DTO_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Upload one bounded base64 image. The stored asset is sanitized and deduplicated by content hash.'
    })
    .registerMethod('ReadChunk', {
        safety: {operation: 'read'},
        params: ASSET_READ_CHUNK_PARAMS_SCHEMA,
        response: ASSET_READ_CHUNK_RESPONSE,
        permission: {component: 'devices', operation: 'read'},
        description:
            'Read a bounded base64 chunk of one organization-owned visual asset. Continue with nextOffset until eof is true.'
    })
    .registerMethod('List', {
        params: ASSET_LIST_PARAMS_SCHEMA,
        response: ASSET_LIST_RESPONSE,
        permission: {component: 'devices', operation: 'read'},
        description:
            "List the organization's visual assets. Used by the asset picker to show reusable images across all device decoration surfaces."
    })
    .registerMethod('SetLabel', {
        params: ASSET_SET_LABEL_PARAMS_SCHEMA,
        response: VISUAL_ASSET_DTO_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description: 'Rename a stored asset for easier library discovery.'
    })
    .registerMethod('Delete', {
        params: ASSET_DELETE_PARAMS_SCHEMA,
        response: ASSET_DELETE_RESPONSE,
        permission: {component: 'devices', operation: 'delete'},
        description:
            'Remove an asset. Refuses (AssetInUse) if any device or group still references it.'
    })
    .registerMethod('MigrateImages', {
        safety: {operation: 'execute'},
        params: ASSET_MIGRATE_IMAGES_PARAMS_SCHEMA,
        response: ASSET_MIGRATE_IMAGES_RESPONSE,
        permission: {note: 'tenant-admin only'},
        description:
            'One-shot: rewrite image-path columns into asset UUIDs. Idempotent.'
    })
    .build();
