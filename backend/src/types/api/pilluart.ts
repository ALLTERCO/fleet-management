// PillUart.* — preview firmware namespace exposed by the Pill in uart mode
// (keyed component, e.g. `pilluart:200`). The firmware docs do not cover it
// yet, so params stay permissive: no named config fields are declared.

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

export interface PillUartSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const PILLUART_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface PillUartGetConfigParams {
    shellyID: string;
    id: number;
}
export const PILLUART_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface PillUartGetStatusParams {
    shellyID: string;
    id: number;
}
export const PILLUART_GET_STATUS_PARAMS_SCHEMA = P_ID;

const b = new DescribeBuilder('pilluart', {
    kind: 'device',
    description: 'Relay Pill UART config and status RPCs to a Shelly device.'
});

b.registerMethod('SetConfig', {
    params: PILLUART_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'PillUart.SetConfig (preview firmware API; config fields are firmware-defined, not yet documented).'
});

b.registerMethod('GetConfig', {
    params: PILLUART_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'PillUart.GetConfig (preview firmware API; fields are firmware-defined, not yet documented).'
});

b.registerMethod('GetStatus', {
    params: PILLUART_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'PillUart.GetStatus (preview firmware API; fields are firmware-defined, not yet documented).'
});

export const PILLUART_DESCRIBE: DescribeOutput = b.build();
