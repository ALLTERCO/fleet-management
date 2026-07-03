// HTTP.* — outbound HTTP/HTTPS requests from the device (per official docs).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};

const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description:
        'Device-defined response: {code, message, headers, body, body_b64}.'
};

// Common SSL CA values per spec: '*' (skip validation), 'user_ca.pem', 'ca.pem',
// or null. Schema accepts string or null; values are device-validated.
const SSL_CA: JsonSchema = {type: ['string', 'null']};

export interface HttpGetParams {
    shellyID: string;
    url: string;
    timeout?: number;
    ssl_ca?: string | null;
}
export const HTTP_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'url'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        url: {type: 'string'},
        timeout: {type: 'number'},
        ssl_ca: SSL_CA
    }
};

export interface HttpPostParams {
    shellyID: string;
    url: string;
    body?: string;
    body_b64?: string;
    content_type?: string;
    timeout?: number;
    ssl_ca?: string | null;
}
export const HTTP_POST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'url'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        url: {type: 'string'},
        body: {type: 'string'},
        body_b64: {type: 'string'},
        content_type: {type: 'string'},
        timeout: {type: 'number'},
        ssl_ca: SSL_CA
    }
};

// HTTP.Request — supports GET, POST, PUT, HEAD, DELETE.
// body required for POST/PUT, disallowed for GET/HEAD (device-validated).
export interface HttpRequestParams {
    shellyID: string;
    method: string;
    url: string;
    body?: string;
    body_b64?: string;
    headers?: Record<string, string>;
    timeout?: number;
    ssl_ca?: string | null;
}
export const HTTP_REQUEST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'method', 'url'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        method: {type: 'string'},
        url: {type: 'string'},
        body: {type: 'string'},
        body_b64: {type: 'string'},
        headers: {type: 'object'},
        timeout: {type: 'number'},
        ssl_ca: SSL_CA
    }
};

const b = new DescribeBuilder('http', {
    kind: 'device',
    description: 'Issue outbound HTTP/HTTPS requests from the device.'
});

b.registerMethod('GET', {
    params: HTTP_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'HTTP.GET — fetch a URL via HTTP/HTTPS GET from the device.'
});
b.registerMethod('POST', {
    params: HTTP_POST_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description: 'HTTP.POST — POST data via HTTP/HTTPS from the device.'
});
b.registerMethod('Request', {
    params: HTTP_REQUEST_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description:
        'HTTP.Request — generic outbound HTTP (method ∈ GET/POST/PUT/HEAD/DELETE).'
});

export const HTTP_DESCRIBE: DescribeOutput = b.build();
