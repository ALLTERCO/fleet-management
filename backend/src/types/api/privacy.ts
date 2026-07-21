import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const ORG_ID: JsonSchema = {type: 'string', minLength: 1, maxLength: 64};
const URL_FIELD: JsonSchema = {
    type: 'string',
    maxLength: 500,
    pattern: '^(https?://|mailto:)?'
};

const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};
const RESP_POLICY: JsonSchema = {
    type: 'object',
    description: 'Active privacy / legal-link policy.'
};

export interface PrivacyScopeParams {
    orgId: string;
}
export const PRIVACY_SCOPE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId'],
    additionalProperties: false,
    properties: {orgId: ORG_ID}
};

export interface PrivacySetPolicyParams {
    orgId: string;
    tosLink?: string;
    privacyLink?: string;
    helpLink?: string;
    supportEmail?: string;
    docsLink?: string;
    customLink?: string;
    customLinkText?: string;
}
export const PRIVACY_SET_POLICY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId'],
    additionalProperties: false,
    properties: {
        orgId: ORG_ID,
        tosLink: URL_FIELD,
        privacyLink: URL_FIELD,
        helpLink: URL_FIELD,
        supportEmail: {type: 'string', maxLength: 320},
        docsLink: URL_FIELD,
        customLink: URL_FIELD,
        customLinkText: {type: 'string', maxLength: 100}
    }
};

const PERM = {note: 'admin-only — proxies Zitadel privacy policy'};
const b = new DescribeBuilder('privacy', {
    kind: 'fleet-manager',
    description:
        'Read and write per-org legal-link privacy policy proxied to Zitadel.'
});

b.registerMethod('GetPolicy', {
    safety: {operation: 'read'},
    params: PRIVACY_SCOPE_PARAMS_SCHEMA,
    response: RESP_POLICY,
    permission: PERM,
    description: 'Privacy.GetPolicy — current legal-link policy.'
});
b.registerMethod('SetPolicy', {
    safety: {operation: 'update'},
    params: PRIVACY_SET_POLICY_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'Privacy.SetPolicy — ToS / privacy / support / help links.'
});
b.registerMethod('Reset', {
    safety: {operation: 'update'},
    params: PRIVACY_SCOPE_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'Privacy.Reset — drop org override.'
});

export const PRIVACY_DESCRIBE: DescribeOutput = b.build();
