/**
 * Public API types for the `backup.*` namespace — device backup lifecycle.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {listResponseSchema, SUCCESS_RESPONSE_SCHEMA} from './_shared';

const SHELLY_ID: JsonSchema = {type: 'string', minLength: 1};
const ID: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    pattern: '^[\\w.-]+$'
};
const NAME: JsonSchema = {type: 'string', minLength: 1, maxLength: 200};

// One stored backup record, as normalizeStoredBackup builds it. Every read and
// every mutation answers with this; the file bytes come from GetFile.
const BACKUP_METADATA_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'device',
        'name',
        'shellyID',
        'deviceName',
        'model',
        'app',
        'fwVersion',
        'createdAt',
        'createdDateKey',
        'fileSize',
        'contents',
        'contentsSummary',
        'groupIds',
        'groupNames',
        'source',
        'metadata'
    ],
    properties: {
        id: ID,
        // Null on legacy records captured before the owner was stamped.
        organizationId: {type: ['string', 'null']},
        device: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'external_id'],
            properties: {
                id: {type: ['integer', 'null']},
                external_id: {type: 'string'}
            }
        },
        name: {type: 'string'},
        shellyID: {type: 'string'},
        deviceName: {type: 'string'},
        model: {type: 'string'},
        app: {type: 'string'},
        fwVersion: {type: 'string'},
        createdAt: {type: 'integer', description: 'epoch milliseconds'},
        createdDateKey: {type: 'string'},
        fileSize: {type: 'integer', minimum: 0},
        contents: {type: 'object', additionalProperties: {type: 'boolean'}},
        contentsSummary: {type: 'string'},
        groupIds: {type: 'array', items: {type: 'integer'}},
        groupNames: {type: 'array', items: {type: 'string'}},
        source: {type: 'string', enum: ['device', 'imported']},
        metadata: {type: 'object', additionalProperties: true}
    }
};

// Create and rename may overwrite a same-named backup; the replaced id is
// reported only when that happened.
const BACKUP_MUTATION_RESPONSE: JsonSchema = {
    ...BACKUP_METADATA_SCHEMA,
    properties: {
        ...(BACKUP_METADATA_SCHEMA.properties ?? {}),
        replacedBackupId: ID
    }
};

const BACKUP_GET_RESPONSE: JsonSchema = {
    anyOf: [BACKUP_METADATA_SCHEMA, {type: 'null'}],
    description: 'Null when no backup carries that id.'
};

const LIST_RESPONSE = listResponseSchema(BACKUP_METADATA_SCHEMA);

export const BACKUP_LIST_PARAMS: JsonSchema = {
    type: 'object',
    properties: {
        shellyID: SHELLY_ID,
        limit: {type: 'integer', minimum: 0, description: '0 = unlimited'},
        offset: {type: 'integer', minimum: 0}
    }
};

export const BACKUP_GET_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: ID}
};

export const BACKUP_DOWNLOAD_PARAMS: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    properties: {
        shellyID: SHELLY_ID,
        name: NAME,
        contents: {type: 'object', additionalProperties: {type: 'boolean'}}
    }
};

export interface BackupStartDownloadJobParams {
    shellyIDs: string[];
    name?: string;
    contents?: Record<string, boolean>;
    idempotencyKey?: string;
}

export interface BackupStartJobResponse {
    jobId: string;
}

export interface BackupStartRestoreJobParams {
    id: string;
    shellyID: string;
    restore?: Record<string, boolean>;
    idempotencyKey?: string;
}

export const BACKUP_START_DOWNLOAD_JOB_PARAMS: JsonSchema = {
    type: 'object',
    required: ['shellyIDs'],
    additionalProperties: false,
    properties: {
        shellyIDs: {
            type: 'array',
            items: SHELLY_ID,
            minItems: 1,
            maxItems: 500
        },
        name: NAME,
        contents: {type: 'object', additionalProperties: {type: 'boolean'}},
        idempotencyKey: {type: 'string', minLength: 8, maxLength: 128}
    }
};

export const BACKUP_START_JOB_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['jobId'],
    additionalProperties: false,
    properties: {jobId: {type: 'string', minLength: 1}}
};

export const BACKUP_RENAME_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id', 'name'],
    properties: {id: ID, name: NAME}
};

export const BACKUP_DELETE_PARAMS = BACKUP_GET_PARAMS;

export const BACKUP_RESTORE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id', 'shellyID'],
    properties: {
        id: ID,
        shellyID: SHELLY_ID,
        restore: {type: 'object', additionalProperties: {type: 'boolean'}}
    }
};

export const BACKUP_START_RESTORE_JOB_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id', 'shellyID'],
    additionalProperties: false,
    properties: {
        id: ID,
        shellyID: SHELLY_ID,
        restore: {type: 'object', additionalProperties: {type: 'boolean'}},
        idempotencyKey: {type: 'string', minLength: 8, maxLength: 128}
    }
};

export const BACKUP_GETFILE_PARAMS = BACKUP_GET_PARAMS;

export const BACKUP_GETFILE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['data', 'name'],
    properties: {
        data: {type: 'string', description: 'base64 payload'},
        name: {type: 'string'},
        size: {type: 'integer', minimum: 0}
    }
};

export const BACKUP_DESCRIBE: DescribeOutput = new DescribeBuilder('backup', {
    kind: 'fleet-manager',
    description:
        'Manage device backups — create, list, rename, delete, download, and restore.'
})
    .registerMethod('List', {
        params: BACKUP_LIST_PARAMS,
        response: LIST_RESPONSE,
        permission: {component: 'devices', operation: 'read'},
        description: 'List device backups, optionally filtered by shellyID.'
    })
    .registerMethod('Get', {
        params: BACKUP_GET_PARAMS,
        response: BACKUP_GET_RESPONSE,
        permission: {component: 'devices', operation: 'read'},
        description: 'Fetch backup metadata by id.'
    })
    .registerMethod('DownloadFromDevice', {
        params: BACKUP_DOWNLOAD_PARAMS,
        response: BACKUP_MUTATION_RESPONSE,
        permission: {component: 'devices', operation: 'update'},
        description: 'Pull a fresh backup from a device and persist it.'
    })
    .registerMethod('StartDownloadJob', {
        params: BACKUP_START_DOWNLOAD_JOB_PARAMS,
        response: BACKUP_START_JOB_RESPONSE,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Queue a backend-owned backup creation job for one or more devices.'
    })
    .registerMethod('Rename', {
        params: BACKUP_RENAME_PARAMS,
        response: BACKUP_MUTATION_RESPONSE,
        permission: {component: 'devices', operation: 'update'},
        description: 'Rename a stored backup.'
    })
    .registerMethod('Delete', {
        params: BACKUP_DELETE_PARAMS,
        response: SUCCESS_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'delete'},
        description: 'Delete a backup by id.'
    })
    .registerMethod('RestoreToDevice', {
        params: BACKUP_RESTORE_PARAMS,
        response: SUCCESS_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description: 'Restore a backup to a device.'
    })
    .registerMethod('StartRestoreJob', {
        params: BACKUP_START_RESTORE_JOB_PARAMS,
        response: BACKUP_START_JOB_RESPONSE,
        permission: {component: 'devices', operation: 'update'},
        description: 'Queue a backend-owned backup restore job for one device.'
    })
    .registerMethod('GetFile', {
        params: BACKUP_GETFILE_PARAMS,
        response: BACKUP_GETFILE_RESPONSE,
        permission: {component: 'devices', operation: 'read'},
        description: 'Return the raw backup payload (base64) and metadata.'
    })
    .build();
