// IR.* — pre-market IR Controller (app IRG4, model S4CC-0D1XX1WW1) namespace.
// Grounded in live-device observations only; no public firmware docs exist
// yet. Params left undefined stay permissive so firmware changes cannot break
// the wrapper.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_DELETE = {component: 'devices', operation: 'delete' as const};

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
// Firmware-defined payload the notes do not pin down yet — passed through.
const P_SHELLY_PASSTHROUGH: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        params: {
            type: 'object',
            description:
                'Device-defined params (preview firmware; not yet documented). Passed through unchanged.'
        }
    }
};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};

export interface IrGetConfigParams {
    shellyID: string;
}
export const IR_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface IrGetStatusParams {
    shellyID: string;
}
export const IR_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_ONLY;

export interface IrSetConfigParams {
    shellyID: string;
    config: Record<string, unknown>;
}
export const IR_SET_CONFIG_PARAMS_SCHEMA = P_SHELLY_CONFIG;

export interface IrAddDeviceParams {
    shellyID: string;
    params?: Record<string, unknown>;
}
export const IR_ADD_DEVICE_PARAMS_SCHEMA = P_SHELLY_PASSTHROUGH;

export interface IrDeleteDeviceParams {
    shellyID: string;
    params?: Record<string, unknown>;
}
export const IR_DELETE_DEVICE_PARAMS_SCHEMA = P_SHELLY_PASSTHROUGH;

const b = new DescribeBuilder('ir', {
    kind: 'device',
    description:
        'Relay IR controller RPCs (add/remove IR devices, config, status) to a Shelly IR Controller.'
});

b.registerMethod('GetConfig', {
    params: IR_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'IR.GetConfig (preview firmware API; observed empty on fw 2.1.99).'
});

b.registerMethod('GetStatus', {
    params: IR_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'IR.GetStatus (preview firmware API; observed empty on fw 2.1.99).'
});

b.registerMethod('SetConfig', {
    params: IR_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'IR.SetConfig (preview firmware API; config fields are firmware-defined, not yet documented).'
});

b.registerMethod('AddDevice', {
    params: IR_ADD_DEVICE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description:
        'IR.AddDevice — create an irdevice:N component (preview firmware API; params not yet documented).'
});

b.registerMethod('DeleteDevice', {
    params: IR_DELETE_DEVICE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_DELETE,
    description:
        'IR.DeleteDevice — remove an irdevice:N component (preview firmware API; params not yet documented).'
});

export const IR_DESCRIBE: DescribeOutput = b.build();
