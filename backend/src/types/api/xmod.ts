// XMOD.* — extension module configuration via signed JWS (per official docs).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response.'
};
const RESP_NULL: JsonSchema = {type: 'null'};

export interface XmodApplyProductJwsParams {
    shellyID: string;
    jws: string;
}
export const XMOD_APPLY_PRODUCT_JWS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'jws'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        jws: {type: 'string'}
    }
};

export interface XmodGetProductJwsParams {
    shellyID: string;
}
export const XMOD_GET_PRODUCT_JWS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface XmodGetInfoParams {
    shellyID: string;
}
export const XMOD_GET_INFO_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

const b = new DescribeBuilder('xmod', {
    kind: 'device',
    description:
        'Relay the device extension-module namespace (signed JWS product config).'
});

b.registerMethod('ApplyProductJWS', {
    params: XMOD_APPLY_PRODUCT_JWS_PARAMS_SCHEMA,
    response: RESP_NULL,
    permission: PERM_UPDATE,
    description:
        'XMOD.ApplyProductJWS — apply a signed product config token (-107 if final flag prevents reapply).'
});
b.registerMethod('GetProductJWS', {
    params: XMOD_GET_PRODUCT_JWS_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'XMOD.GetProductJWS — return the applied JWS token (-114 if none applied).'
});
b.registerMethod('GetInfo', {
    params: XMOD_GET_INFO_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'XMOD.GetInfo — parsed JWT with product config (aud, iat, jti, v, p, n, m, url, f, xmod).'
});

export const XMOD_DESCRIBE: DescribeOutput = b.build();
