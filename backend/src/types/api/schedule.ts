/** Public API types for the `schedule.*` namespace — mirrors device-side
 *  `Schedule.*` 1:1 per the official Shelly Gen2+ docs. Replaces the legacy
 *  `automation.Schedule.*` umbrella. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

// --- Domain types --------------------------------------------------------

/**
 * One scheduled call on the device. Maps to a Shelly `ScheduleJob`.
 * `timespec` uses the 6-field cron format
 * `"SEC MIN HOUR MDAY MON DOW"` (e.g. `"0 0 8 * * MON,TUE,WED"`).
 */
export interface ScheduleJob {
    id: number;
    enable: boolean;
    timespec: string;
    calls: Array<{method: string; params?: Record<string, unknown>}>;
}

/** Resource-type label used in `ResourceNotFound.data.details.resourceType`. */
export const SCHEDULE_JOB_RESOURCE_TYPE = 'schedule_job';

// --- Params / response per method ---------------------------------------

export interface ScheduleListParams {
    shellyID: string;
}

export interface ScheduleListResponse {
    items: ScheduleJob[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

export interface ScheduleCreateParams {
    shellyID: string;
    enable?: boolean;
    timespec: string;
    calls: Array<{method: string; params?: Record<string, unknown>}>;
}

export interface ScheduleCreateResponse {
    id: number;
}

export interface ScheduleUpdateParams {
    shellyID: string;
    id: number;
    enable?: boolean;
    timespec?: string;
    calls?: Array<{method: string; params?: Record<string, unknown>}>;
}

export interface ScheduleUpdateResponse {
    success: true;
}

export interface ScheduleDeleteParams {
    shellyID: string;
    id: number;
}

export interface ScheduleDeleteResponse {
    success: true;
}

export interface ScheduleDeleteAllParams {
    shellyID: string;
}

export interface ScheduleDeleteAllResponse {
    success: true;
}

// --- JSON Schemas -------------------------------------------------------

const SHELLY_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120,
    description: 'Target Shelly device identifier'
};

const CALL_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['method'],
    additionalProperties: false,
    properties: {
        method: {type: 'string', minLength: 1, maxLength: 120},
        params: {type: 'object'}
    }
};

export const SCHEDULE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA}
};

export const SCHEDULE_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'timespec', 'calls'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        enable: {type: 'boolean'},
        timespec: {type: 'string', minLength: 1, maxLength: 120},
        calls: {type: 'array', items: CALL_SCHEMA, minItems: 1, maxItems: 20}
    }
};

export const SCHEDULE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: {type: 'integer', minimum: 0},
        enable: {type: 'boolean'},
        timespec: {type: 'string', minLength: 1, maxLength: 120},
        calls: {type: 'array', items: CALL_SCHEMA, minItems: 1, maxItems: 20}
    }
};

export const SCHEDULE_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: {type: 'integer', minimum: 0}
    }
};

export const SCHEDULE_DELETE_ALL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA}
};

const SCHEDULE_JOB_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'enable', 'timespec', 'calls'],
    properties: {
        id: {type: 'integer'},
        enable: {type: 'boolean'},
        timespec: {type: 'string'},
        calls: {type: 'array', items: CALL_SCHEMA}
    }
};

const LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: SCHEDULE_JOB_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const SUCCESS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['success'],
    properties: {success: {type: 'boolean', const: true}}
};

const CREATE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'integer'}}
};

const PERM_DEVICE_READ = {component: 'devices', operation: 'read'} as const;
const PERM_DEVICE_EXEC = {component: 'devices', operation: 'execute'} as const;

export const SCHEDULE_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'schedule',
    {
        kind: 'device',
        description:
            'Manage cron-style schedule jobs stored on the target Shelly device.'
    }
)
    .registerMethod('List', {
        params: SCHEDULE_LIST_PARAMS_SCHEMA,
        response: LIST_RESPONSE_SCHEMA,
        permission: PERM_DEVICE_READ,
        description: 'List cron-style schedules stored on the target device.'
    })
    .registerMethod('Create', {
        params: SCHEDULE_CREATE_PARAMS_SCHEMA,
        response: CREATE_RESPONSE_SCHEMA,
        permission: PERM_DEVICE_EXEC,
        description: 'Add a new schedule job; returns the device-assigned id.'
    })
    .registerMethod('Update', {
        params: SCHEDULE_UPDATE_PARAMS_SCHEMA,
        response: SUCCESS_SCHEMA,
        permission: PERM_DEVICE_EXEC,
        description: 'Partial-update an existing schedule job by id.'
    })
    .registerMethod('Delete', {
        params: SCHEDULE_DELETE_PARAMS_SCHEMA,
        response: SUCCESS_SCHEMA,
        permission: PERM_DEVICE_EXEC,
        description: 'Remove a schedule job by id.'
    })
    .registerMethod('DeleteAll', {
        params: SCHEDULE_DELETE_ALL_PARAMS_SCHEMA,
        response: SUCCESS_SCHEMA,
        permission: PERM_DEVICE_EXEC,
        description: 'Wipe every schedule job on the target device.'
    })
    .build();
