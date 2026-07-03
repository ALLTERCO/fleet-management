import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    RESTART_REQUIRED_RESPONSE_SCHEMA,
    SHELLY_CONFIG_PARAMS_SCHEMA,
    SHELLY_ID_SCHEMA
} from './_shared';

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};

// BluGw is a singleton: GetConfig / GetStatus take no params.
const P_SHELLY_ONLY: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA}
};

export interface BluGwGetConfigParams {
    shellyID: string;
}
export const BLUGW_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface BluGwGetStatusParams {
    shellyID: string;
}
export const BLUGW_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface BluGwSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const BLUGW_SET_CONFIG_PARAMS_SCHEMA = SHELLY_CONFIG_PARAMS_SCHEMA;

const b = new DescribeBuilder('blugw', {
    kind: 'device',
    description: 'Configure and monitor the Bluetooth gateway component.'
});

b.registerMethod('SetConfig', {
    params: SHELLY_CONFIG_PARAMS_SCHEMA,
    response: RESTART_REQUIRED_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description: 'BluGw.SetConfig — gateway config (e.g. sys_led_enable).'
});
b.registerMethod('GetConfig', {
    params: BLUGW_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BluGw.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: BLUGW_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'BluGw.GetStatus.'
});

export const BLUGW_DESCRIBE: DescribeOutput = b.build();
