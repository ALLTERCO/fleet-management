import {DescribeBuilder, type DescribeOutput} from './_describe';
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
    properties: {restart_required: {type: 'boolean'}},
    description: 'Firmware returns {restart_required} on SetConfig paths.'
};
const RESP_OPAQUE: JsonSchema = {
    description: 'Device-defined (object).'
};
const RESP_NULL: JsonSchema = {
    type: 'null',
    description: 'Returns null on success.'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

export interface MatterGetConfigParams {
    shellyID: string;
}
export const MATTER_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface MatterGetStatusParams {
    shellyID: string;
}
export const MATTER_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface MatterFactoryResetParams {
    shellyID: string;
}
export const MATTER_FACTORY_RESET_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface MatterSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const MATTER_SET_CONFIG_PARAMS_SCHEMA = P_SHELLY_CONFIG;

export interface MatterGetSetupCodeParams {
    shellyID: string;
}
export const MATTER_GET_SETUP_CODE_PARAMS_SCHEMA = P_SHELLY_ONLY;

const b = new DescribeBuilder('matter', {
    kind: 'device',
    description:
        'Relay Matter config, status, setup code, and factory reset to a Shelly device.'
});

b.registerMethod('SetConfig', {
    params: P_SHELLY_CONFIG,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Matter.SetConfig.'
});

b.registerMethod('GetSetupCode', {
    params: P_SHELLY_ONLY,
    response: {
        type: 'object',
        required: ['qr_code', 'manual_code'],
        properties: {
            qr_code: {type: 'string'},
            manual_code: {type: 'string'}
        }
    },
    permission: PERM_READ,
    description: 'Matter.GetSetupCode.'
});
b.registerMethod('GetConfig', {
    params: MATTER_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Matter.GetConfig.'
});
b.registerMethod('GetStatus', {
    params: MATTER_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Matter.GetStatus.'
});
b.registerMethod('FactoryReset', {
    params: MATTER_FACTORY_RESET_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description: 'Matter.FactoryReset — clear Matter fabric/credentials.'
});

export const MATTER_DESCRIBE: DescribeOutput = b.build();
