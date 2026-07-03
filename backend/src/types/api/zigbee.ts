// Zigbee — Gen4 native bridge. Pass-through schemas.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {type: 'object', additionalProperties: true};

export interface ZigbeeShellyOnlyParams {
    shellyID: string;
}

export interface ZigbeeSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}

export const ZIGBEE_SHELLY_ONLY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID'],
    properties: {shellyID: SHELLY_ID_SCHEMA}
};

export const ZIGBEE_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'config'],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        config: {type: 'object', additionalProperties: true}
    }
};

const b = new DescribeBuilder('zigbee', {
    kind: 'device',
    description:
        'Relay the device Zigbee bridge namespace (Gen4 native pass-through).'
});
b.registerMethod('GetStatus', {
    params: ZIGBEE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Zigbee bridge status.'
});
b.registerMethod('GetConfig', {
    params: ZIGBEE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Zigbee bridge config.'
});
b.registerMethod('SetConfig', {
    params: ZIGBEE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Zigbee bridge SetConfig — opaque pass-through.'
});

export const ZIGBEE_DESCRIBE: DescribeOutput = b.build();
