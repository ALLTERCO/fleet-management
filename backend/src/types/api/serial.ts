import {DescribeBuilder, type DescribeOutput} from './_describe';
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
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};

export interface SerialSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const SERIAL_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface SerialGetConfigParams {
    shellyID: string;
    id: number;
}
export const SERIAL_GET_CONFIG_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('serial', {
    kind: 'device',
    description:
        'Read and update serial-port and Modbus RTU config on the device.'
});

b.registerMethod('SetConfig', {
    params: SERIAL_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description:
        'Serial.SetConfig — port mode + serial params + Modbus RTU server config.'
});
b.registerMethod('GetConfig', {
    params: SERIAL_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Serial.GetConfig — {mode, serial, mb_server}.'
});

export const SERIAL_DESCRIBE: DescribeOutput = b.build();
