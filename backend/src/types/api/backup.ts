/**
 * Public API types for the `backup.*` namespace — device backup lifecycle.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const SHELLY_ID: JsonSchema = {type: 'string', minLength: 1};
const ID: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    pattern: '^[\\w.-]+$'
};
const NAME: JsonSchema = {type: 'string', minLength: 1, maxLength: 200};

const ACK: JsonSchema = {type: 'object', additionalProperties: true};

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
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Fetch backup metadata by id.'
    })
    .registerMethod('DownloadFromDevice', {
        params: BACKUP_DOWNLOAD_PARAMS,
        response: ACK,
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
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Rename a stored backup.'
    })
    .registerMethod('Delete', {
        params: BACKUP_DELETE_PARAMS,
        response: ACK,
        permission: {component: 'devices', operation: 'delete'},
        description: 'Delete a backup by id.'
    })
    .registerMethod('RestoreToDevice', {
        params: BACKUP_RESTORE_PARAMS,
        response: ACK,
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
