import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export const FILE_TRANSFER_MAX_CHUNK_BYTES = 512 * 1024;

export type FileUploadKind =
    | 'backup_import'
    | 'firmware'
    | 'background'
    | 'profile_picture'
    | 'report_image'
    | 'email_asset'
    | 'floor_plan'
    | 'visual_asset';

export interface FileTransferTarget {
    locationId?: number;
    username?: string;
    resourceKind?: 'virtual-device' | 'bluetooth-device' | 'group';
    resourceId?: string;
    reportName?: string;
}

export interface FileTransferOptions {
    requestedName?: string;
    retention?: 'temporary' | 'library';
    name?: string;
    app?: string;
    model?: string;
    ver?: string;
    fwId?: string;
    channel?: 'stable' | 'beta' | 'custom';
    tags?: string;
    label?: string | null;
    context?: string;
}

export interface FileTransferBeginParams {
    kind: FileUploadKind;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    contentType: string;
    target?: FileTransferTarget;
    options?: FileTransferOptions;
}

export interface FileTransferUploadParams {
    uploadId: string;
}

export interface FileTransferWriteChunkParams extends FileTransferUploadParams {
    offset: number;
    data: string;
}

export type FileDownloadKind =
    | 'backup'
    | 'firmware_library'
    | 'firmware_temporary'
    | 'report_export'
    | 'audit_export'
    | 'email_asset'
    | 'visual_asset'
    | 'background'
    | 'profile_picture'
    | 'report_image'
    | 'floor_plan';

export interface FileTransferReadChunkParams {
    kind: FileDownloadKind;
    artifactId: string;
    offset?: number;
    maxBytes?: number;
}

const UPLOAD_ID: JsonSchema = {type: 'string', format: 'uuid'};
const SHA256: JsonSchema = {
    type: 'string',
    pattern: '^[a-fA-F0-9]{64}$'
};

const TARGET_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        locationId: {type: 'integer', minimum: 1},
        username: {type: 'string', minLength: 1, maxLength: 255},
        resourceKind: {
            type: 'string',
            enum: ['virtual-device', 'bluetooth-device', 'group']
        },
        resourceId: {type: 'string', minLength: 1, maxLength: 255},
        reportName: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
            pattern: '^[a-zA-Z0-9_-]+$'
        }
    }
};

const OPTIONS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        requestedName: {type: 'string', minLength: 1, maxLength: 200},
        retention: {type: 'string', enum: ['temporary', 'library']},
        name: {type: 'string', minLength: 1, maxLength: 120},
        app: {type: 'string', minLength: 1, maxLength: 120},
        model: {type: 'string', minLength: 1, maxLength: 120},
        ver: {type: 'string', minLength: 1, maxLength: 120},
        fwId: {type: 'string', minLength: 1, maxLength: 120},
        channel: {type: 'string', enum: ['stable', 'beta', 'custom']},
        tags: {type: 'string', maxLength: 1000},
        label: {type: ['string', 'null'], maxLength: 255},
        context: {type: 'string', maxLength: 255}
    }
};

export const FILE_TRANSFER_BEGIN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['kind', 'fileName', 'sizeBytes', 'sha256', 'contentType'],
    additionalProperties: false,
    properties: {
        kind: {
            type: 'string',
            enum: [
                'backup_import',
                'firmware',
                'background',
                'profile_picture',
                'report_image',
                'email_asset',
                'floor_plan',
                'visual_asset'
            ]
        },
        fileName: {type: 'string', minLength: 1, maxLength: 255},
        sizeBytes: {type: 'integer', minimum: 1, maximum: 67_108_864},
        sha256: SHA256,
        contentType: {type: 'string', minLength: 1, maxLength: 120},
        target: TARGET_SCHEMA,
        options: OPTIONS_SCHEMA
    }
};

export const FILE_TRANSFER_UPLOAD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['uploadId'],
    additionalProperties: false,
    properties: {uploadId: UPLOAD_ID}
};

export const FILE_TRANSFER_WRITE_CHUNK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['uploadId', 'offset', 'data'],
    additionalProperties: false,
    properties: {
        uploadId: UPLOAD_ID,
        offset: {type: 'integer', minimum: 0},
        data: {type: 'string', minLength: 4}
    }
};

export const FILE_TRANSFER_READ_CHUNK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['kind', 'artifactId'],
    additionalProperties: false,
    properties: {
        kind: {
            type: 'string',
            enum: [
                'backup',
                'firmware_library',
                'firmware_temporary',
                'report_export',
                'audit_export',
                'email_asset',
                'visual_asset',
                'background',
                'profile_picture',
                'report_image',
                'floor_plan'
            ]
        },
        artifactId: {type: 'string', minLength: 1, maxLength: 255},
        offset: {type: 'integer', minimum: 0},
        maxBytes: {
            type: 'integer',
            minimum: 1,
            maximum: FILE_TRANSFER_MAX_CHUNK_BYTES
        }
    }
};

const BEGIN_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['uploadId', 'nextOffset', 'expiresAt', 'maxChunkBytes'],
    additionalProperties: false,
    properties: {
        uploadId: UPLOAD_ID,
        nextOffset: {type: 'integer', minimum: 0},
        expiresAt: {type: 'string', format: 'date-time'},
        maxChunkBytes: {type: 'integer', minimum: 1}
    }
};

const WRITE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['uploadId', 'nextOffset', 'complete'],
    additionalProperties: false,
    properties: {
        uploadId: UPLOAD_ID,
        nextOffset: {type: 'integer', minimum: 0},
        complete: {type: 'boolean'}
    }
};

const GET_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'uploadId',
        'kind',
        'status',
        'nextOffset',
        'sizeBytes',
        'sha256',
        'expiresAt'
    ],
    additionalProperties: false,
    properties: {
        uploadId: UPLOAD_ID,
        kind: {type: 'string'},
        status: {
            type: 'string',
            enum: [
                'open',
                'finalizing',
                'finalized',
                'cancelled',
                'outcome_unknown'
            ]
        },
        nextOffset: {type: 'integer', minimum: 0},
        sizeBytes: {type: 'integer', minimum: 1},
        sha256: SHA256,
        expiresAt: {type: 'string', format: 'date-time'},
        result: {type: 'object', additionalProperties: true}
    }
};

const FINALIZE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['uploadId', 'kind', 'sizeBytes', 'sha256', 'result'],
    additionalProperties: false,
    properties: {
        uploadId: UPLOAD_ID,
        kind: {type: 'string'},
        sizeBytes: {type: 'integer', minimum: 1},
        sha256: SHA256,
        result: {type: 'object', additionalProperties: true}
    }
};

const CANCEL_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['cancelled'],
    additionalProperties: false,
    properties: {cancelled: {type: 'boolean'}}
};

const READ_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'fileName',
        'contentType',
        'sizeBytes',
        'sha256',
        'offset',
        'nextOffset',
        'eof',
        'dataBase64'
    ],
    additionalProperties: false,
    properties: {
        fileName: {type: 'string'},
        contentType: {type: 'string'},
        sizeBytes: {type: 'integer', minimum: 0},
        sha256: SHA256,
        offset: {type: 'integer', minimum: 0},
        nextOffset: {type: 'integer', minimum: 0},
        eof: {type: 'boolean'},
        dataBase64: {type: 'string'}
    }
};

export const FILE_TRANSFER_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'fileTransfer',
    {
        kind: 'fleet-manager',
        description:
            'Transfer bounded files through permission-checked Fleet artifact adapters.'
    }
)
    .setLimits({maxChunkBytes: FILE_TRANSFER_MAX_CHUNK_BYTES})
    .registerMethod('Begin', {
        params: FILE_TRANSFER_BEGIN_PARAMS_SCHEMA,
        response: BEGIN_RESPONSE,
        permission: {note: 'target upload permission'},
        safety: {operation: 'create', idempotent: false},
        description:
            'Create a credential-bound upload session after checking the target permission.'
    })
    .registerMethod('WriteChunk', {
        params: FILE_TRANSFER_WRITE_CHUNK_PARAMS_SCHEMA,
        response: WRITE_RESPONSE,
        permission: {note: 'upload session owner'},
        safety: {operation: 'update', idempotent: true},
        description: 'Write one canonical base64 chunk at the required offset.'
    })
    .registerMethod('Get', {
        params: FILE_TRANSFER_UPLOAD_PARAMS_SCHEMA,
        response: GET_RESPONSE,
        permission: {note: 'upload session owner'},
        safety: {operation: 'read', idempotent: true},
        description:
            'Read the authoritative offset and status of an owner-bound upload.'
    })
    .registerMethod('Finalize', {
        params: FILE_TRANSFER_UPLOAD_PARAMS_SCHEMA,
        response: FINALIZE_RESPONSE,
        permission: {note: 'upload session owner'},
        safety: {operation: 'create', idempotent: false, destructive: true},
        description:
            'Verify and promote a complete upload through its canonical target service.'
    })
    .registerMethod('Cancel', {
        params: FILE_TRANSFER_UPLOAD_PARAMS_SCHEMA,
        response: CANCEL_RESPONSE,
        permission: {note: 'upload session owner'},
        safety: {operation: 'delete', idempotent: true},
        description: 'Cancel an open upload and remove its temporary bytes.'
    })
    .registerMethod('ReadChunk', {
        params: FILE_TRANSFER_READ_CHUNK_PARAMS_SCHEMA,
        response: READ_RESPONSE,
        permission: {note: 'live artifact permission and ownership'},
        safety: {operation: 'read', idempotent: true},
        description: 'Read a bounded chunk from an owner-bound Fleet artifact.'
    })
    .build();
