// Fan — Pass-through schemas.

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {electrical, sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {type: 'object', additionalProperties: true};

export interface FanGetParams {
    shellyID: string;
    id: number;
}

export interface FanSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}

export interface FanSetParams {
    shellyID: string;
    id: number;
    on?: boolean;
    speed?: number;
}

const ID_PROP: JsonSchema = {type: 'integer', minimum: 0};

export const FAN_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'id'],
    properties: {shellyID: SHELLY_ID_SCHEMA, id: ID_PROP}
};

export const FAN_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'id', 'config'],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: ID_PROP,
        config: {type: 'object', additionalProperties: true}
    }
};

export const FAN_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'id'],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: ID_PROP,
        on: {type: 'boolean'},
        speed: {type: 'number', minimum: 0, maximum: 100}
    }
};

const b = new DescribeBuilder('fan', {
    kind: 'device',
    description: 'Read, configure, and control a fan component on a device.'
});
b.registerMethod('GetStatus', {
    params: FAN_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Fan status — on, speed, RPM, errors.'
});
b.registerMethod('GetConfig', {
    params: FAN_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Fan config.'
});
b.registerMethod('SetConfig', {
    params: FAN_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Fan SetConfig — opaque pass-through.'
});
b.registerMethod('Set', {
    params: FAN_SET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Fan Set — on/off and speed (0-100).'
});

const FAN_METRICS: MetricDescriptor[] = [
    sensor('speed', '%'),
    electrical('aenergy_total', 'active_energy', {
        optional: true,
        direction: 'import'
    })
];

b.setMetrics(FAN_METRICS);

export const FAN_DESCRIBE: DescribeOutput = b.build();
