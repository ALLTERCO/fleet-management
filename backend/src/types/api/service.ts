import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};

export interface ServiceShellyIdParams {
    shellyID: string;
    id: number;
}
export const SERVICE_SHELLY_ID_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};

export interface ServiceSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const SERVICE_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
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
const RESP_NULL: JsonSchema = {type: 'null'};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const b = new DescribeBuilder('service', {
    kind: 'device',
    description:
        'Inspect and configure service components on the target Shelly device.'
});

b.registerMethod('GetInfo', {
    params: SERVICE_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Service.GetInfo — type/version/build/etag and ui metadata.'
});

b.registerMethod('GetConfig', {
    params: SERVICE_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Service.GetConfig.'
});

b.registerMethod('GetStatus', {
    params: SERVICE_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Service.GetStatus — runtime state and stats.'
});

b.registerMethod('GetResources', {
    params: SERVICE_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Service.GetResources — virtual-component bindings (vc map).'
});

b.registerMethod('ListConfigOptions', {
    params: SERVICE_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Service.ListConfigOptions — config keys and option/range metadata.'
});

b.registerMethod('SetConfig', {
    params: SERVICE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Service.SetConfig — service component runtime config.'
});

b.registerMethod('ResetCounters', {
    params: SERVICE_SHELLY_ID_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description: 'Service.ResetCounters — clear runtime counters.'
});

export const SERVICE_DESCRIBE: DescribeOutput = b.build();
