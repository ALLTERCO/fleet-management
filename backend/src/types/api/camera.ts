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

export interface CameraCaptureImageParams extends CameraShellyTarget {
    stream?: number;
}

// duration + stream are required — an id-only StartRecording fails on-device.
export interface CameraStartRecordingParams extends CameraShellyTarget {
    duration: number;
    stream: number;
}

export interface CameraStopRecordingParams extends CameraShellyTarget {
    rec_id?: string; // omit to stop all active recordings
}

// AddZone params are flat (not wrapped in `config`) per the CameraZone doc and
// verified on-device — a `config`-wrapped payload fails with "too few coordinates".
export interface CameraAddZoneParams extends CameraShellyTarget {
    enable: boolean;
    type: string; // 'motion' | 'privacy'
    coordinates: number[]; // normalized 0..10000 grid, >= 2 points (4 values)
    color?: number[]; // [r,g,b] 0..255
    name?: string;
}

// DeleteZone needs the camera `id` AND the `zone_id`; the device rejects a
// single-id payload ("Missing or bad argument 'id'!").
export interface CameraDeleteZoneParams {
    shellyID: string;
    id: number; // camera component id
    zone_id: number; // zone to delete
}

export interface CameraZoneSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}

export interface CameraStorageListParams {
    shellyID: string;
    id?: number;
    offset?: number; // pagination — Storage.List returns a page from this index
}

export interface CameraStorageDeleteParams {
    shellyID: string;
    id?: number;
    media_id: string; // per Storage doc; List rows are keyed by media_id
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

export const CAMERA_CAPTURE_IMAGE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: CHANNEL_ID, stream: CHANNEL_ID}
};

export const CAMERA_START_RECORDING_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'duration', 'stream'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: CHANNEL_ID,
        duration: {type: 'integer', minimum: 1},
        stream: CHANNEL_ID
    }
};

export const CAMERA_STOP_RECORDING_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: CHANNEL_ID,
        rec_id: {type: 'string', minLength: 1, maxLength: 64}
    }
};

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

export const CAMERA_ADD_ZONE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'enable', 'type', 'coordinates'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: CHANNEL_ID,
        enable: {type: 'boolean'},
        type: {type: 'string', enum: ['motion', 'privacy']},
        coordinates: {type: 'array', items: {type: 'number'}, minItems: 4},
        color: {
            type: 'array',
            items: {type: 'integer', minimum: 0, maximum: 255}
        },
        name: {type: 'string', maxLength: 64}
    }
};

export const CAMERA_DELETE_ZONE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'zone_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: CHANNEL_ID,
        zone_id: {type: 'integer', minimum: 0}
    }
};

export const CAMERA_ZONE_SET_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: CHANNEL_ID, config: CONFIG_OBJECT}
};

export const CAMERA_STORAGE_LIST_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: CHANNEL_ID,
        offset: {type: 'integer', minimum: 0}
    }
};
export const CAMERA_STORAGE_FORMAT_SCHEMA = SHELLY_AND_OPTIONAL_ID;
export const CAMERA_STORAGE_EJECT_SCHEMA = SHELLY_AND_OPTIONAL_ID;
export const CAMERA_STORAGE_GET_CONFIG_SCHEMA = SHELLY_AND_OPTIONAL_ID;

export const CAMERA_STORAGE_DELETE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'media_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: CHANNEL_ID,
        media_id: {type: 'string', minLength: 1, maxLength: 64}
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
export interface CameraStreamerStopParams {
    shellyID: string;
    session_id: string;
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

export const CAMERA_STREAMER_STOP_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'session_id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        session_id: {type: 'string'}
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
    .registerMethod('Streamer.StopStream', {
        params: CAMERA_STREAMER_STOP_PARAMS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'execute'},
        description:
            'Streamer.StopStream — end a WebRTC session and free the device stream slot.'
    })
    .build();
