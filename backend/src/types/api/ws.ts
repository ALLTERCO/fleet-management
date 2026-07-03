// WS.* — device-side outbound WebSocket (firmware namespace `WS`).
// Distinct from the fleet-manager's own WS ingress endpoints.

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

export interface WsSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const WS_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, config: {type: 'object'}}
};

export interface WsGetConfigParams {
    shellyID: string;
}
export const WS_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface WsGetStatusParams {
    shellyID: string;
}
export const WS_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

const b = new DescribeBuilder('ws', {
    kind: 'device',
    description:
        'Relay the device outbound WebSocket namespace (firmware WS config).'
});

b.registerMethod('SetConfig', {
    params: WS_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'WS.SetConfig — device outbound WebSocket client config.'
});
b.registerMethod('GetConfig', {
    params: WS_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'WS.GetConfig — current outbound-WS configuration.'
});
b.registerMethod('GetStatus', {
    params: WS_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'WS.GetStatus — outbound-WS connectivity state.'
});

// Ws.GetStatus reports a single outbound-WS connectivity boolean.
const WS_METRICS: MetricDescriptor[] = [state('connected')];

b.setMetrics(WS_METRICS);

export const WS_DESCRIBE: DescribeOutput = b.build();
