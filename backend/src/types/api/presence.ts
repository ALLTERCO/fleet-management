/**
 * Public API types for the `Presence.*` namespace — mmWave radar sensor
 * config, zones, calibration, and live tracking. Backend wraps the
 * device-side Presence.* / PresenceZone.* RPCs with auth + audit.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export interface PresenceShellyTarget {
    shellyID: string;
}

export interface PresenceLiveTrackParams extends PresenceShellyTarget {}

export interface PresenceSetConfigParams extends PresenceShellyTarget {
    config: Record<string, unknown>;
}

export interface PresenceSetSensorParams extends PresenceShellyTarget {
    enable: boolean;
}

export interface PresenceAddZoneParams extends PresenceShellyTarget {
    config: Record<string, unknown>;
}

export interface PresenceDeleteZoneParams extends PresenceShellyTarget {
    id: number;
}

export interface PresenceZoneSetConfigParams extends PresenceShellyTarget {
    id: number;
    config: Record<string, unknown>;
}

export interface PresenceTiltCalibrateParams extends PresenceShellyTarget {}

const SHELLY_ID: JsonSchema = {type: 'string', minLength: 1, maxLength: 120};
const ZONE_ID: JsonSchema = {type: 'integer', minimum: 0};
const CONFIG_OBJECT: JsonSchema = {type: 'object'};

const SHELLY_ONLY: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export const PRESENCE_LIVE_TRACK_SCHEMA = SHELLY_ONLY;
export const PRESENCE_TILT_CALIBRATE_SCHEMA = SHELLY_ONLY;
export const PRESENCE_GET_CONFIG_SCHEMA = SHELLY_ONLY;
export const PRESENCE_GET_STATUS_SCHEMA = SHELLY_ONLY;

export interface PresenceGetConfigParams extends PresenceShellyTarget {}
export interface PresenceGetStatusParams extends PresenceShellyTarget {}

export const PRESENCE_SET_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, config: CONFIG_OBJECT}
};

export const PRESENCE_SET_SENSOR_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'enable'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, enable: {type: 'boolean'}}
};

export const PRESENCE_ADD_ZONE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, config: CONFIG_OBJECT}
};

export const PRESENCE_DELETE_ZONE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: ZONE_ID}
};

export const PRESENCE_ZONE_SET_CONFIG_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: ZONE_ID, config: CONFIG_OBJECT}
};

// --- Describe ------------------------------------------------------------

const ACK: JsonSchema = {type: 'object'};

export const PRESENCE_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'presence',
    {
        kind: 'device',
        description:
            'Relay mmWave presence sensor config, zones, calibration, and live tracking to a Shelly device.'
    }
)
    .registerMethod('LiveTrack', {
        params: PRESENCE_LIVE_TRACK_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description:
            'Subscribe to the live tracking stream for a presence sensor.'
    })
    .registerMethod('SetConfig', {
        params: PRESENCE_SET_CONFIG_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Apply a partial presence config update.'
    })
    .registerMethod('SetSensor', {
        params: PRESENCE_SET_SENSOR_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Enable or disable the presence sensor.'
    })
    .registerMethod('AddZone', {
        params: PRESENCE_ADD_ZONE_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Add a presence detection zone.'
    })
    .registerMethod('DeleteZone', {
        params: PRESENCE_DELETE_ZONE_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Remove a detection zone by id.'
    })
    .registerMethod('Zone.SetConfig', {
        params: PRESENCE_ZONE_SET_CONFIG_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'update'},
        description: 'Apply a partial zone config update.'
    })
    .registerMethod('TiltCalibrate', {
        params: PRESENCE_TILT_CALIBRATE_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'execute'},
        description: 'Start tilt calibration for the mmWave sensor.'
    })
    .registerMethod('GetConfig', {
        params: PRESENCE_GET_CONFIG_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description: 'Presence.GetConfig — current sensor configuration.'
    })
    .registerMethod('GetStatus', {
        params: PRESENCE_GET_STATUS_SCHEMA,
        response: ACK,
        permission: {component: 'devices', operation: 'read'},
        description:
            'Presence.GetStatus — runtime state including live tracking flag.'
    })
    .build();
