import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {state} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const P_ID: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA, id: COMPONENT_ID}
};
const P_ID_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
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
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

export interface SmokeSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const SMOKE_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface SmokeGetConfigParams {
    shellyID: string;
    id: number;
}
export const SMOKE_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface SmokeGetStatusParams {
    shellyID: string;
    id: number;
}
export const SMOKE_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface SmokeMuteParams {
    shellyID: string;
    id: number;
}
export const SMOKE_MUTE_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('smoke', {
    kind: 'device',
    description:
        'Read, configure, and mute the smoke-alarm component on the device.'
});

b.registerMethod('SetConfig', {
    params: SMOKE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Smoke.SetConfig — alarm config (mute, thresholds, name).'
});
b.registerMethod('GetConfig', {
    params: SMOKE_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Smoke.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: SMOKE_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Smoke.GetStatus — alarm + mute state.'
});
b.registerMethod('Mute', {
    params: SMOKE_MUTE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Smoke.Mute — silence the alarm.'
});

const SMOKE_METRICS: MetricDescriptor[] = [state('alarm'), state('mute')];

b.setMetrics(SMOKE_METRICS);

export const SMOKE_DESCRIBE: DescribeOutput = b.build();
