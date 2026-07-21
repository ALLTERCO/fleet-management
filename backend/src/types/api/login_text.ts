import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const ORG_ID: JsonSchema = {type: 'string', minLength: 1, maxLength: 64};
const LANGUAGE: JsonSchema = {type: 'string', pattern: '^[a-zA-Z-]{2,10}$'};

const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};
const RESP_TEXT: JsonSchema = {type: 'object', additionalProperties: true};

// Body keeps additionalProperties so callers can set any of the ~30 screen blocks
// (selectAccountText, loginText, passwordText, …) without a JSON-Schema fork
// every time Zitadel adds a screen. Each screen is a free-form object; Zitadel
// validates field-level constraints server-side.
export interface LoginTextScopeParams {
    orgId: string;
    language: string;
}
export const LOGIN_TEXT_SCOPE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId', 'language'],
    additionalProperties: false,
    properties: {orgId: ORG_ID, language: LANGUAGE}
};

export interface LoginTextGetDefaultParams {
    language: string;
}
export const LOGIN_TEXT_GET_DEFAULT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['language'],
    additionalProperties: false,
    properties: {language: LANGUAGE}
};

export interface LoginTextSetParams {
    orgId: string;
    language: string;
    text: Record<string, unknown>;
}
export const LOGIN_TEXT_SET_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId', 'language', 'text'],
    additionalProperties: false,
    properties: {
        orgId: ORG_ID,
        language: LANGUAGE,
        text: {type: 'object', additionalProperties: true}
    }
};

const PERM = {note: 'admin-only — proxies Zitadel /text/login/<lang>'};
const b = new DescribeBuilder('login_text', {
    kind: 'fleet-manager',
    description:
        'Manage per-language login UI branding strings, proxied to Zitadel login text.'
});

b.registerMethod('GetText', {
    safety: {operation: 'read'},
    params: LOGIN_TEXT_SCOPE_SCHEMA,
    response: RESP_TEXT,
    permission: PERM,
    description: 'login_text.GetText — current login UI strings per language.'
});
b.registerMethod('GetDefault', {
    safety: {operation: 'read'},
    params: LOGIN_TEXT_GET_DEFAULT_SCHEMA,
    response: RESP_TEXT,
    permission: PERM,
    description: 'login_text.GetDefault — Zitadel factory-default UI strings.'
});
b.registerMethod('SetText', {
    safety: {operation: 'update'},
    params: LOGIN_TEXT_SET_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'login_text.SetText — override login UI strings (any of ~30 screen blocks).'
});
b.registerMethod('Reset', {
    safety: {operation: 'update'},
    params: LOGIN_TEXT_SCOPE_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'login_text.Reset — drop org login-text overrides for a language.'
});

export const LOGIN_TEXT_DESCRIBE: DescribeOutput = b.build();
