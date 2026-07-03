import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const ORG_ID: JsonSchema = {type: 'string', minLength: 1, maxLength: 64};
const MESSAGE_TYPE: JsonSchema = {
    type: 'string',
    enum: [
        'init',
        'password_reset',
        'verify_email',
        'verify_phone',
        'verify_sms_otp',
        'verify_email_otp',
        'domain_claimed',
        'passwordless_registration',
        'password_change',
        'invite_user'
    ]
};
const LANGUAGE: JsonSchema = {
    type: 'string',
    pattern: '^[a-zA-Z-]{2,10}$'
};

const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};
const RESP_TEXT: JsonSchema = {type: 'object', additionalProperties: true};

export interface MessageTextScopeParams {
    orgId: string;
    type: string;
    language: string;
}
export const MESSAGE_TEXT_SCOPE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId', 'type', 'language'],
    additionalProperties: false,
    properties: {orgId: ORG_ID, type: MESSAGE_TYPE, language: LANGUAGE}
};

export interface MessageTextGetDefaultParams {
    type: string;
    language: string;
}
export const MESSAGE_TEXT_GET_DEFAULT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['type', 'language'],
    additionalProperties: false,
    properties: {type: MESSAGE_TYPE, language: LANGUAGE}
};

export interface MessageTextSetParams {
    orgId: string;
    type: string;
    language: string;
    title?: string;
    preHeader?: string;
    subject?: string;
    greeting?: string;
    text?: string;
    buttonText?: string;
    footerText?: string;
}
export const MESSAGE_TEXT_SET_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId', 'type', 'language'],
    additionalProperties: false,
    properties: {
        orgId: ORG_ID,
        type: MESSAGE_TYPE,
        language: LANGUAGE,
        title: {type: 'string', maxLength: 200},
        preHeader: {type: 'string', maxLength: 200},
        subject: {type: 'string', maxLength: 200},
        greeting: {type: 'string', maxLength: 200},
        text: {type: 'string', maxLength: 4000},
        buttonText: {type: 'string', maxLength: 100},
        footerText: {type: 'string', maxLength: 500}
    }
};

const PERM = {note: 'admin-only — proxies Zitadel /text/message/*'};
const b = new DescribeBuilder('message_text', {
    kind: 'fleet-manager',
    description:
        'Manage per-type, per-language notification message text, proxied to Zitadel.'
});

b.registerMethod('GetText', {
    params: MESSAGE_TEXT_SCOPE_SCHEMA,
    response: RESP_TEXT,
    permission: PERM,
    description: 'message_text.GetText — read message text for type+language.'
});
b.registerMethod('GetDefault', {
    params: MESSAGE_TEXT_GET_DEFAULT_SCHEMA,
    response: RESP_TEXT,
    permission: PERM,
    description: 'message_text.GetDefault — Zitadel factory-default text.'
});
b.registerMethod('SetText', {
    params: MESSAGE_TEXT_SET_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'message_text.SetText — override message text for type+language.'
});
b.registerMethod('Reset', {
    params: MESSAGE_TEXT_SCOPE_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'message_text.Reset — drop org override; instance default applies.'
});

export const MESSAGE_TEXT_DESCRIBE: DescribeOutput = b.build();
