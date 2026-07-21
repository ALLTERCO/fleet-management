/**
 * Public API types for the `mail.*` namespace — SMTP send.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const ADDRESS: JsonSchema = {
    oneOf: [{type: 'string'}, {type: 'array', items: {type: 'string'}}]
};

export const MAIL_SEND_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['to'],
    properties: {
        from: {type: 'string'},
        to: ADDRESS,
        cc: ADDRESS,
        bcc: ADDRESS,
        subject: {type: 'string'},
        text: {type: 'string'},
        html: {type: 'string'}
    },
    additionalProperties: true
};

export const MAIL_SEND_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    description:
        'nodemailer SendInfo — messageId, envelope, accepted[], rejected[], response',
    additionalProperties: true
};

export const MAIL_DESCRIBE: DescribeOutput = new DescribeBuilder('mail', {
    kind: 'fleet-manager',
    description: 'Send email through the configured server SMTP transport.'
})
    .registerMethod('Send', {
        safety: {operation: 'execute'},
        params: MAIL_SEND_PARAMS_SCHEMA,
        response: MAIL_SEND_RESPONSE_SCHEMA,
        permission: {
            note: 'provider-support-only — uses instance-wide SMTP identity'
        },
        description: 'Send an email via the configured SMTP transport.'
    })
    .build();
