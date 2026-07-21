// Zitadel notification policy proxy (distinct from FM's internal alert
// notification system). Single field today: passwordChange (notify user
// when their password is changed).
import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const ORG_ID: JsonSchema = {type: 'string', minLength: 1, maxLength: 64};
const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};
const RESP_POLICY: JsonSchema = {type: 'object', additionalProperties: true};

export interface NotificationPolicyScopeParams {
    orgId: string;
}
export const NOTIFICATION_POLICY_SCOPE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId'],
    additionalProperties: false,
    properties: {orgId: ORG_ID}
};

export interface NotificationPolicySetParams {
    orgId: string;
    passwordChange?: boolean;
}
export const NOTIFICATION_POLICY_SET_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId'],
    additionalProperties: false,
    properties: {orgId: ORG_ID, passwordChange: {type: 'boolean'}}
};

const PERM = {note: 'admin-only — proxies Zitadel notification policy'};
const b = new DescribeBuilder('notification_policy', {
    kind: 'fleet-manager',
    description:
        'Manage the org Zitadel notification policy, such as notify-on-password-change.'
});

b.registerMethod('GetPolicy', {
    safety: {operation: 'read'},
    params: NOTIFICATION_POLICY_SCOPE_SCHEMA,
    response: RESP_POLICY,
    permission: PERM,
    description: 'notification_policy.GetPolicy — current notification policy.'
});
b.registerMethod('SetPolicy', {
    safety: {operation: 'update'},
    params: NOTIFICATION_POLICY_SET_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'notification_policy.SetPolicy — toggle "notify user on password change".'
});
b.registerMethod('Reset', {
    safety: {operation: 'update'},
    params: NOTIFICATION_POLICY_SCOPE_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'notification_policy.Reset — drop org override.'
});

export const NOTIFICATION_POLICY_DESCRIBE: DescribeOutput = b.build();
