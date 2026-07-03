import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    DEVICE_CONFIG_PATCH_SCHEMA,
    RESTART_REQUIRED_RESPONSE_SCHEMA,
    SHELLY_CONFIG_PARAMS_SCHEMA,
    SHELLY_ID_SCHEMA
} from './_shared';
import {PLUG_UI_COMPONENTS} from './deviceAddons';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const CONFIG_PATCH = DEVICE_CONFIG_PATCH_SCHEMA;
const RESP_RESTART_REQUIRED = RESTART_REQUIRED_RESPONSE_SCHEMA;
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response'
};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

export interface UiShellyOnlyParams {
    shellyID: string;
}
export const UI_SHELLY_ONLY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export type PlugUiComponentName = (typeof PLUG_UI_COMPONENTS)[number];

export interface UiPlugSetConfigParams {
    shellyID: string;
    component: PlugUiComponentName;
    config: Record<string, unknown>;
}
export const UI_PLUG_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'component', 'config'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        component: {type: 'string', enum: [...PLUG_UI_COMPONENTS]},
        config: CONFIG_PATCH
    }
};

export interface UiSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const UI_SET_CONFIG_PARAMS_SCHEMA = SHELLY_CONFIG_PARAMS_SCHEMA;

export interface UiScreenSetParams {
    shellyID: string;
    on: string;
}
export const UI_SCREEN_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'on'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, on: {type: 'string'}}
};

export interface UiSwipeParams {
    shellyID: string;
    direction: string;
}
export const UI_SWIPE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'direction'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, direction: {type: 'string'}}
};

export interface UiTapParams {
    shellyID: string;
}
export const UI_TAP_PARAMS_SCHEMA = UI_SHELLY_ONLY_PARAMS_SCHEMA;

const b = new DescribeBuilder('ui', {
    kind: 'device',
    description:
        'Relay the device UI configuration namespace (screen, plug UI, brightness).'
});

b.registerMethod('GetConfig', {
    params: UI_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Ui.GetConfig on Wall Display firmware.'
});
b.registerMethod('GetStatus', {
    params: UI_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Ui.GetStatus on Wall Display firmware.'
});
b.registerMethod('ListAvailable', {
    params: UI_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Ui.ListAvailable — supported lock_types/media_control_types/priority_elements.'
});

b.registerMethod('Plug.SetConfig', {
    params: UI_PLUG_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_RESTART_REQUIRED,
    permission: PERM_UPDATE,
    description: 'Plug LED UI config via the device plug UI namespace.'
});
b.registerMethod('SetConfig', {
    params: UI_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Ui.SetConfig on Wall Display firmware.'
});
b.registerMethod('Screen.Set', {
    params: UI_SCREEN_SET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Ui.Screen.Set on Wall Display firmware.'
});
b.registerMethod('Swipe', {
    params: UI_SWIPE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Ui.Swipe on Wall Display firmware.'
});
b.registerMethod('Tap', {
    params: UI_TAP_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'Ui.Tap on Wall Display firmware.'
});

export const UI_DESCRIBE: DescribeOutput = b.build();
