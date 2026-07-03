// Modbus.* — device-side Modbus TCP/RTU connector.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {RESTART_REQUIRED_RESPONSE_SCHEMA, SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};

export interface ModbusSetConfigParams {
    shellyID: string;
    config: {enable?: boolean};
}
export const MODBUS_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        config: {
            type: 'object',
            additionalProperties: false,
            properties: {enable: {type: 'boolean'}}
        }
    }
};

export interface ModbusGetConfigParams {
    shellyID: string;
}
export const MODBUS_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface ModbusGetStatusParams {
    shellyID: string;
}
export const MODBUS_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

const b = new DescribeBuilder('modbus', {
    kind: 'device',
    description:
        'Relay Modbus TCP/RTU connector config and status to a Shelly device.'
});

b.registerMethod('SetConfig', {
    params: MODBUS_SET_CONFIG_PARAMS_SCHEMA,
    response: RESTART_REQUIRED_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description: 'Modbus.SetConfig — Modbus TCP/RTU enable toggle.'
});
b.registerMethod('GetConfig', {
    params: MODBUS_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Modbus.GetConfig — current Modbus configuration.'
});
b.registerMethod('GetStatus', {
    params: MODBUS_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Modbus.GetStatus — Modbus connectivity / activity status.'
});

export const MODBUS_DESCRIBE: DescribeOutput = b.build();
