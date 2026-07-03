// OTA.* — staged firmware update (url-based Update or chunked Start/Write/Commit).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;

export interface OtaShellyOnlyParams {
    shellyID: string;
}
export const OTA_SHELLY_ONLY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface OtaUpdateParams {
    shellyID: string;
    url: string;
}
export const OTA_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'url'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        // Any url the device accepts; the device performs the fetch, not FM.
        url: {
            type: 'string',
            minLength: 1,
            maxLength: 4096
        }
    }
};

export interface OtaStartParams {
    shellyID: string;
    size: number;
}
export const OTA_START_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'size'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        size: {type: 'integer', minimum: 1}
    }
};

export interface OtaWriteParams {
    shellyID: string;
    offset: number;
    data: string;
}
export const OTA_WRITE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'offset', 'data'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        offset: {type: 'integer', minimum: 0},
        data: {type: 'string'}
    }
};

export interface OtaDataParams {
    shellyID: string;
    data: string;
}
export const OTA_DATA_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'data'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        data: {type: 'string'}
    }
};

const RESP_NULL: JsonSchema = {type: 'null'};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

const b = new DescribeBuilder('ota', {
    kind: 'device',
    description:
        'Relay staged firmware updates to a Shelly device via url-based or chunked upload.'
});

b.registerMethod('Update', {
    params: OTA_UPDATE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'OTA.Update — start url-based firmware update.'
});

b.registerMethod('Start', {
    params: OTA_START_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'OTA.Start — begin a chunked firmware upload of `size` bytes.'
});

b.registerMethod('Write', {
    params: OTA_WRITE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'OTA.Write — write a base64 chunk at offset.'
});

b.registerMethod('Data', {
    params: OTA_DATA_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'OTA.Data — append the next sequential base64 chunk.'
});

b.registerMethod('Commit', {
    params: OTA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'OTA.Commit — finalize the chunked upload and reboot.'
});

b.registerMethod('Abort', {
    params: OTA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'OTA.Abort — cancel an active chunked upload.'
});

b.registerMethod('Revert', {
    params: OTA_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'OTA.Revert — roll back to the previous firmware image.'
});

export const OTA_DESCRIBE: DescribeOutput = b.build();
