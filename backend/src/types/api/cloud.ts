// Cloud.* — device-side Shelly Cloud connection.

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {state} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {RESTART_REQUIRED_RESPONSE_SCHEMA, SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};

// Cloud.SetConfig — toggle Shelly cloud connection. server URL is locked.
export interface CloudSetConfigParams {
    shellyID: string;
    config: {enable?: boolean; server?: string};
}
export const CLOUD_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        config: {
            type: 'object',
            additionalProperties: false,
            properties: {
                enable: {type: 'boolean'},
                server: {type: 'string'}
            }
        }
    }
};

export interface CloudGetConfigParams {
    shellyID: string;
}
export const CLOUD_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface CloudGetStatusParams {
    shellyID: string;
}
export const CLOUD_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

const b = new DescribeBuilder('cloud', {
    kind: 'device',
    description:
        'Read status and toggle the device-side Shelly Cloud connection.'
});

b.registerMethod('SetConfig', {
    params: CLOUD_SET_CONFIG_PARAMS_SCHEMA,
    response: RESTART_REQUIRED_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description: 'Cloud.SetConfig — toggle Shelly cloud connection.'
});
b.registerMethod('GetConfig', {
    params: CLOUD_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Cloud.GetConfig — current Shelly cloud config.'
});
b.registerMethod('GetStatus', {
    params: CLOUD_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Cloud.GetStatus — Shelly cloud connectivity state.'
});

// Cloud.GetStatus reports a single connectivity boolean.
const CLOUD_METRICS: MetricDescriptor[] = [state('connected')];

b.setMetrics(CLOUD_METRICS);

export const CLOUD_DESCRIBE: DescribeOutput = b.build();
