// PresenceZone.* — per-zone presence sensor (per official Shelly docs).
// Distinct namespace from Presence.* (the parent sensor component).

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {count, state} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};
const P_ID_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};

export interface PzSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const PRESENCE_ZONE_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface PzGetConfigParams {
    shellyID: string;
    id: number;
}
export const PRESENCE_ZONE_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface PzGetStatusParams {
    shellyID: string;
    id: number;
}
export const PRESENCE_ZONE_GET_STATUS_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('presencezone', {
    kind: 'device',
    description:
        'Relay per-zone presence sensor config and status RPCs to a Shelly device.'
});

b.registerMethod('SetConfig', {
    params: PRESENCE_ZONE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description:
        'PresenceZone.SetConfig — name / enable / color / area (zone polygon).'
});
b.registerMethod('GetConfig', {
    params: PRESENCE_ZONE_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'PresenceZone.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: PRESENCE_ZONE_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'PresenceZone.GetStatus — {id, state, num_objects}.'
});

const PRESENCEZONE_METRICS: MetricDescriptor[] = [
    count('num_objects'),
    state('value', {optional: true})
];

b.setMetrics(PRESENCEZONE_METRICS);

export const PRESENCE_ZONE_DESCRIBE: DescribeOutput = b.build();
