// Virtual Button.* — logical button aggregator. Triggered by BLU sensors
// (BTHomeControl mapping), scripts, or programmatically via Button.Trigger.
// Read state via cached device.config['button:N'] / device.status['button:N'];
// FM wraps SetConfig + Trigger only.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const RESP_NULL: JsonSchema = {type: 'null'};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};
const RESP_RESTART_REQUIRED: JsonSchema = {
    type: 'object',
    required: ['restart_required'],
    properties: {restart_required: {type: 'boolean'}}
};

// Per-method exports

// Event names (single_push / double_push / triple_push / long_push / ...)
// are device-owned — schema accepts any string; device gates.
export interface ButtonTriggerParams {
    shellyID: string;
    id: number;
    event: string;
}
export const BUTTON_TRIGGER_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'event'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        event: {type: 'string'}
    }
};

export interface ButtonSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const BUTTON_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
        config: {type: 'object'}
    }
};

export interface ButtonGetConfigParams {
    shellyID: string;
    id: number;
}
export const BUTTON_GET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};

export interface ButtonGetStatusParams {
    shellyID: string;
    id: number;
}
export const BUTTON_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, id: COMPONENT_ID}
};

const b = new DescribeBuilder('button', {
    kind: 'device',
    description:
        'Configure and trigger the virtual button component and its push events.'
});

b.registerMethod('Trigger', {
    params: BUTTON_TRIGGER_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_EXECUTE,
    description:
        'Button.Trigger — programmatically fire a button event (single_push / double_push / long_push / ...).'
});
b.registerMethod('SetConfig', {
    params: BUTTON_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Button.SetConfig — name / debounce / hold-times.'
});
b.registerMethod('GetConfig', {
    params: BUTTON_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Button.GetConfig — fetch persisted button config by id.'
});
b.registerMethod('GetStatus', {
    params: BUTTON_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Button.GetStatus — last event + counters for the button.'
});

export const BUTTON_DESCRIBE: DescribeOutput = b.build();
