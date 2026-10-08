// IRDevice.* — per-device namespace of the pre-market IR Controller (app
// IRG4). Keyed component: irdevice:N (observed live: irdevice:200 with config
// {id, name}). Grounded in live-device observations only; undocumented
// params stay permissive.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const COMPONENT_ID: JsonSchema = {type: 'integer', minimum: 0};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_DELETE = {component: 'devices', operation: 'delete' as const};

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
// id plus a firmware-defined payload the notes do not pin down yet.
const P_ID_PASSTHROUGH: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: COMPONENT_ID,
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

export interface IrDeviceGetConfigParams {
    shellyID: string;
    id: number;
}
export const IRDEVICE_GET_CONFIG_PARAMS_SCHEMA = P_ID;

export interface IrDeviceGetStatusParams {
    shellyID: string;
    id: number;
}
export const IRDEVICE_GET_STATUS_PARAMS_SCHEMA = P_ID;

export interface IrDeviceSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}
export const IRDEVICE_SET_CONFIG_PARAMS_SCHEMA = P_ID_CONFIG;

export interface IrDeviceLearnCodeParams {
    shellyID: string;
    id: number;
    params?: Record<string, unknown>;
}
export const IRDEVICE_LEARN_CODE_PARAMS_SCHEMA = P_ID_PASSTHROUGH;

export interface IrDeviceDeleteCodeParams {
    shellyID: string;
    id: number;
    params?: Record<string, unknown>;
}
export const IRDEVICE_DELETE_CODE_PARAMS_SCHEMA = P_ID_PASSTHROUGH;

const b = new DescribeBuilder('irdevice', {
    kind: 'device',
    description:
        'Relay per-IR-device RPCs (config, status, code learning) to a Shelly IR Controller.'
});

b.registerMethod('GetConfig', {
    params: IRDEVICE_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'IRDevice.GetConfig — observed shape {id, name} on fw 2.1.99 (preview firmware API).'
});

b.registerMethod('GetStatus', {
    params: IRDEVICE_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'IRDevice.GetStatus (preview firmware API; response shape not yet observed).'
});

b.registerMethod('SetConfig', {
    params: IRDEVICE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'IRDevice.SetConfig — known config fields: name (preview firmware API; kept permissive).'
});

b.registerMethod('LearnCode', {
    params: IRDEVICE_LEARN_CODE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description:
        'IRDevice.LearnCode — capture an IR code (preview firmware API; params not yet documented).'
});

b.registerMethod('DeleteCode', {
    params: IRDEVICE_DELETE_CODE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_DELETE,
    description:
        'IRDevice.DeleteCode — remove a learned IR code (preview firmware API; params not yet documented).'
});

export const IRDEVICE_DESCRIBE: DescribeOutput = b.build();
