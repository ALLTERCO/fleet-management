// IRCode.* — IR code namespace of the pre-market IR Controller (app IRG4).
// Live-device observations list the methods but no param or response shapes,
// and no ircode:N component was observed —
// every method is a permissive passthrough until firmware docs land.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

// Firmware-defined payload — even the code addressing scheme (keyed
// component? code id? name?) is not documented yet, so nothing is required.
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

export interface IrCodeGetConfigParams {
    shellyID: string;
    params?: Record<string, unknown>;
}
export const IRCODE_GET_CONFIG_PARAMS_SCHEMA = P_SHELLY_PASSTHROUGH;

export interface IrCodeGetStatusParams {
    shellyID: string;
    params?: Record<string, unknown>;
}
export const IRCODE_GET_STATUS_PARAMS_SCHEMA = P_SHELLY_PASSTHROUGH;

export interface IrCodeSetConfigParams {
    shellyID: string;
    params?: Record<string, unknown>;
}
export const IRCODE_SET_CONFIG_PARAMS_SCHEMA = P_SHELLY_PASSTHROUGH;

export interface IrCodeEmitParams {
    shellyID: string;
    params?: Record<string, unknown>;
}
export const IRCODE_EMIT_PARAMS_SCHEMA = P_SHELLY_PASSTHROUGH;

const b = new DescribeBuilder('ircode', {
    kind: 'device',
    description:
        'Relay IR code RPCs (emit, config, status) to a Shelly IR Controller.'
});

b.registerMethod('GetConfig', {
    params: IRCODE_GET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'IRCode.GetConfig (preview firmware API; params and response not yet documented).'
});

b.registerMethod('GetStatus', {
    params: IRCODE_GET_STATUS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'IRCode.GetStatus (preview firmware API; params and response not yet documented).'
});

b.registerMethod('SetConfig', {
    params: IRCODE_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'IRCode.SetConfig (preview firmware API; params and response not yet documented).'
});

b.registerMethod('Emit', {
    params: IRCODE_EMIT_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description:
        'IRCode.Emit — transmit a stored IR code (preview firmware API; params not yet documented).'
});

export const IRCODE_DESCRIBE: DescribeOutput = b.build();
