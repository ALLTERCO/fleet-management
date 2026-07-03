// Mqtt.* — device-side MQTT client.

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {state} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};

export interface MqttSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const MQTT_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, config: {type: 'object'}}
};

export interface MqttGetConfigParams {
    shellyID: string;
}
export const MQTT_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface MqttGetStatusParams {
    shellyID: string;
}
export const MQTT_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

const b = new DescribeBuilder('mqtt', {
    kind: 'device',
    description:
        'Relay device-side MQTT client config and broker status to a Shelly device.'
});

b.registerMethod('SetConfig', {
    params: MQTT_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Mqtt.SetConfig — device-side MQTT client config.'
});
b.registerMethod('GetConfig', {
    params: MQTT_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Mqtt.GetConfig — current MQTT client config (password redacted).'
});
b.registerMethod('GetStatus', {
    params: MQTT_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Mqtt.GetStatus — broker connectivity state.'
});

// MQTT.GetStatus reports a single broker-connectivity boolean.
const MQTT_METRICS: MetricDescriptor[] = [state('connected')];

b.setMetrics(MQTT_METRICS);

export const MQTT_DESCRIBE: DescribeOutput = b.build();
