// PM1.* — single-phase power meter (per official Shelly docs).

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {electrical} from './_metricBuilders';
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
const P_RESET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        type: {type: 'array', items: {type: 'string'}}
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

export interface Pm1SetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const PM1_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface Pm1GetConfigParams {
    shellyID: string;
    id: number;
}
export const PM1_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface Pm1GetStatusParams {
    shellyID: string;
    id: number;
}
export const PM1_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface Pm1ResetCountersParams {
    shellyID: string;
    id: number;
    type?: string[];
}
export const PM1_RESET_COUNTERS_PARAMS_SCHEMA = P_RESET;

const b = new DescribeBuilder('pm1', {
    kind: 'device',
    description:
        'Relay single-phase power meter config, status, and counter resets to a Shelly device.'
});

b.registerMethod('SetConfig', {
    params: PM1_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'PM1.SetConfig — name / reverse / alarms.'
});
b.registerMethod('GetConfig', {
    params: PM1_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'PM1.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: PM1_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'PM1.GetStatus — {voltage, current, apower, freq, aenergy, ret_aenergy, errors, flags}.'
});
b.registerMethod('ResetCounters', {
    params: PM1_RESET_COUNTERS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'PM1.ResetCounters — clear energy counters; optional `type` array to scope.'
});

const PM1_METRICS: MetricDescriptor[] = [
    electrical('voltage', 'voltage'),
    electrical('current', 'current'),
    electrical('apower', 'active_power'),
    electrical('aprtpower', 'apparent_power', {optional: true}),
    electrical('pf', 'power_factor', {optional: true}),
    electrical('freq', 'frequency', {optional: true}),
    electrical('aenergy_total', 'active_energy', {direction: 'import'}),
    electrical('ret_aenergy_total', 'active_energy', {direction: 'export'})
];

b.setMetrics(PM1_METRICS);

export const PM1_DESCRIBE: DescribeOutput = b.build();
