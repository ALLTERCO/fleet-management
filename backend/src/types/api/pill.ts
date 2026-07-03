import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {sensor, state} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const P_SHELLY_ONLY: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};
const P_SHELLY_CONFIG: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, config: {type: 'object'}}
};
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

export interface PillSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const PILL_SET_CONFIG_PARAMS_SCHEMA = P_SHELLY_CONFIG;

export interface PillGetConfigParams {
    shellyID: string;
}
export const PILL_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface PillGetStatusParams {
    shellyID: string;
}
export const PILL_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ONLY;

const b = new DescribeBuilder('pill', {
    kind: 'device',
    description: 'Relay Pill sensor config and status RPCs to a Shelly device.'
});

b.registerMethod('SetConfig', {
    params: PILL_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Pill.SetConfig (not publicly documented).'
});

b.registerMethod('GetConfig', {
    params: PILL_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Pill.GetConfig — mode + per-pin mode settings.'
});

b.registerMethod('GetStatus', {
    params: PILL_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Pill.GetStatus — empty per spec; reserved for fw extensions.'
});

// The Pill is a USB-C peripheral hub: onewire (temperature/humidity), analog
// (voltmeter) and digital_io (input) sensors plugged in surface these readings.
const PILL_METRICS: MetricDescriptor[] = [
    sensor('tc', '°C', {optional: true}),
    sensor('tf', '°F', {optional: true}),
    sensor('rh', '%', {optional: true}),
    sensor('voltage', 'V', {optional: true}),
    sensor('percent', '%', {optional: true}),
    state('input', {optional: true})
];

b.setMetrics(PILL_METRICS);

export const PILL_DESCRIBE: DescribeOutput = b.build();
