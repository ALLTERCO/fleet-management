/**
 * Public API types for the `Camera.*` namespace — capture, zones,
 * privacy, on-device storage. Backend wraps the device-side Camera /
 * CameraZone / Storage RPCs with auth + audit + domain errors.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

// --- Param / response types ---------------------------------------------

export interface CameraShellyTarget {
    shellyID: string;
    id: number;
}

export interface CameraSetConfigParams extends CameraShellyTarget {
    config: Record<string, unknown>;
}

export interface CameraGetCapabilitiesParams extends CameraShellyTarget {}

export interface CameraCaptureImageParams extends CameraShellyTarget {}

export interface CameraStartRecordingParams extends CameraShellyTarget {}

export interface CameraStopRecordingParams extends CameraShellyTarget {}

export interface CameraAddZoneParams extends CameraShellyTarget {
    config: Record<string, unknown>;
}

export interface CameraDeleteZoneParams {
    shellyID: string;
    id: number;
}

export interface CameraZoneSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}

export interface CameraStorageListParams {
    shellyID: string;
    id?: number;
}

export interface CameraStorageDeleteParams {
    shellyID: string;
    id?: number;
    name: string;
}

export interface CameraStorageFormatParams {
    shellyID: string;
    id?: number;
}

export interface CameraStorageEjectParams {
    shellyID: string;
    id?: number;
}

export interface CameraStorageGetConfigParams {
    shellyID: string;
    id?: number;
}

export interface CameraStorageSetConfigParams {
    shellyID: string;
    id?: number;
    config: Record<string, unknown>;
}

// --- JSON Schemas -------------------------------------------------------

const SHELLY_ID: JsonSchema = {type: 'string', minLength: 1, maxLength: 120};
const CHANNEL_ID: JsonSchema = {type: 'integer', minimum: 0};
const CONFIG_OBJECT: JsonSchema = {type: 'object'};

const SHELLY_AND_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: CHANNEL_ID}
};

const SHELLY_AND_OPTIONAL_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: CHANNEL_ID}
};

export const CAMERA_SET_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: CHANNEL_ID, config: CONFIG_OBJECT}
};

export const CAMERA_GET_CAPABILITIES_SCHEMA = SHELLY_AND_ID;
export const CAMERA_CAPTURE_IMAGE_SCHEMA = SHELLY_AND_ID;
export const CAMERA_START_RECORDING_SCHEMA = SHELLY_AND_ID;
export const CAMERA_STOP_RECORDING_SCHEMA = SHELLY_AND_ID;

export interface CameraGetConfigParams extends CameraShellyTarget {}
export const CAMERA_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = SHELLY_AND_ID;

export interface CameraGetStatusParams extends CameraShellyTarget {}
export const CAMERA_GET_STATUS_PARAMS_SCHEMA: JsonSchema = SHELLY_AND_ID;

export interface CameraZoneGetConfigParams extends CameraShellyTarget {}
export const CAMERA_ZONE_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = SHELLY_AND_ID;

export interface CameraZoneGetStatusParams extends CameraShellyTarget {}
export const CAMERA_ZONE_GET_STATUS_PARAMS_SCHEMA: JsonSchema = SHELLY_AND_ID;

export interface CameraStorageGetStatusParams {
    shellyID: string;
    id?: number;
}
export const CAMERA_STORAGE_GET_STATUS_PARAMS_SCHEMA: JsonSchema =
    SHELLY_AND_OPTIONAL_ID;

export interface CameraStorageUploadParams {
    shellyID: string;
    id?: number;
    name: string;
    data: string;
    offset?: number;
    last?: boolean;
}
export const CAMERA_STORAGE_UPLOAD_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'name', 'data'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: CHANNEL_ID,
        name: {type: 'string', minLength: 1, maxLength: 256},
        data: {type: 'string'},
        offset: {type: 'integer', minimum: 0},
        last: {type: 'boolean'}
    }
};

export const CAMERA_ADD_ZONE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: CHANNEL_ID, config: CONFIG_OBJECT}
};

export const CAMERA_DELETE_ZONE_SCHEMA = SHELLY_AND_ID;

export const CAMERA_ZONE_SET_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: CHANNEL_ID, config: CONFIG_OBJECT}
};

export const CAMERA_STORAGE_LIST_SCHEMA = SHELLY_AND_OPTIONAL_ID;
export const CAMERA_STORAGE_FORMAT_SCHEMA = SHELLY_AND_OPTIONAL_ID;
export const CAMERA_STORAGE_EJECT_SCHEMA = SHELLY_AND_OPTIONAL_ID;
export const CAMERA_STORAGE_GET_CONFIG_SCHEMA = SHELLY_AND_OPTIONAL_ID;

export const CAMERA_STORAGE_DELETE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'name'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: CHANNEL_ID,
        name: {type: 'string', minLength: 1, maxLength: 256}
    }
};

export const CAMERA_STORAGE_SET_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: CHANNEL_ID, config: CONFIG_OBJECT}
};

export interface CameraStreamerOfferParams {
    shellyID: string;
    ice_servers: unknown[];
    stream_id: number;
}
export interface CameraStreamerAnswerParams {
    shellyID: string;
    session_id: string;
    sdp: string;
    candidates: unknown[];
    end_of_candidates: boolean;
}
export interface CameraStreamerSetStreamSourceParams {
    shellyID: string;
    session_id: string;
    stream_id: number;
}
export const CAMERA_STREAMER_OFFER_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'ice_servers', 'stream_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        ice_servers: {type: 'array'},
        stream_id: {type: 'integer'}
    }
};

export const CAMERA_STREAMER_ANSWER_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'shellyID',
        'session_id',
        'sdp',
        'candidates',
        'end_of_candidates'
    ],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        session_id: {type: 'string'},
        sdp: {type: 'string'},
        candidates: {type: 'array'},
        end_of_candidates: {type: 'boolean'}
    }
};

export const CAMERA_STREAMER_SET_STREAM_SOURCE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'session_id', 'stream_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        session_id: {type: 'string'},
        stream_id: {type: 'integer'}
    }
};

// --- Describe ------------------------------------------------------------

const ACK: JsonSchema = {type: 'object'};

export const CAMERA_DESCRIBE: DescribeOutput = new DescribeBuilder('camera', {
    kind: 'device',
    description:
        'Capture, record, and stream camera video plus manage zones and storage.'
})
    .registerMethod('SetConfig', {
        params: CAMERA_SET_CONFIG_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Apply a partial camera config update.'
    })
    .registerMethod('GetConfig', {
        params: CAMERA_GET_CONFIG_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Camera.GetConfig.'
    })
    .registerMethod('GetStatus', {
        params: CAMERA_GET_STATUS_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Camera.GetStatus.'
    })
    .registerMethod('Zone.GetConfig', {
        params: CAMERA_ZONE_GET_CONFIG_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'CameraZone.GetConfig.'
    })
    .registerMethod('Zone.GetStatus', {
        params: CAMERA_ZONE_GET_STATUS_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'CameraZone.GetStatus.'
    })
    .registerMethod('Storage.GetStatus', {
        params: CAMERA_STORAGE_GET_STATUS_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Storage.GetStatus.'
    })
    .registerMethod('Storage.Upload', {
        params: CAMERA_STORAGE_UPLOAD_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Storage.Upload — chunked file upload.'
    })
    .registerMethod('GetCapabilities', {
        params: CAMERA_GET_CAPABILITIES_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Return the camera capability set for this channel.'
    })
    .registerMethod('CaptureImage', {
        params: CAMERA_CAPTURE_IMAGE_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'execute'},
        description: 'Trigger a one-shot image capture.'
    })
    .registerMethod('StartRecording', {
        params: CAMERA_START_RECORDING_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'execute'},
        description: 'Start recording to on-device storage.'
    })
    .registerMethod('StopRecording', {
        params: CAMERA_STOP_RECORDING_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'execute'},
        description: 'Stop an active recording.'
    })
    .registerMethod('AddZone', {
        params: CAMERA_ADD_ZONE_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Add a detection zone to the camera.'
    })
    .registerMethod('DeleteZone', {
        params: CAMERA_DELETE_ZONE_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Remove a detection zone by id.'
    })
    .registerMethod('Zone.SetConfig', {
        params: CAMERA_ZONE_SET_CONFIG_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Apply a partial zone config update.'
    })
    .registerMethod('Storage.List', {
        params: CAMERA_STORAGE_LIST_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'List files in on-device storage.'
    })
    .registerMethod('Storage.Delete', {
        params: CAMERA_STORAGE_DELETE_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Delete a named file from on-device storage.'
    })
    .registerMethod('Storage.Format', {
        params: CAMERA_STORAGE_FORMAT_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Format on-device storage (destructive).'
    })
    .registerMethod('Storage.Eject', {
        params: CAMERA_STORAGE_EJECT_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Eject the storage medium.'
    })
    .registerMethod('Storage.GetConfig', {
        params: CAMERA_STORAGE_GET_CONFIG_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Return on-device storage config.'
    })
    .registerMethod('Storage.SetConfig', {
        params: CAMERA_STORAGE_SET_CONFIG_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Apply a partial storage config update.'
    })
    .registerMethod('Streamer.Offer', {
        params: CAMERA_STREAMER_OFFER_PARAMS_SCHEMA,
        response: {
            type: 'object',
            properties: {
                sdp: {type: 'string'},
                session_id: {type: 'string'},
                candidates: {type: 'array'}
            }
        },
        permission: {component: 'devices', operation: 'execute'},
        description: 'Streamer.Offer — initiate WebRTC session.'
    })
    .registerMethod('Streamer.Answer', {
        params: CAMERA_STREAMER_ANSWER_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'execute'},
        description: 'Streamer.Answer — complete WebRTC handshake.'
    })
    .registerMethod('Streamer.SetStreamSource', {
        params: CAMERA_STREAMER_SET_STREAM_SOURCE_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'execute'},
        description: 'Streamer.SetStreamSource — switch active stream.'
    })
    .build();
