// Zitadel domain policy: userLoginMustBeDomain, validateOrgDomains, smtpSenderAddressMatchesInstanceDomain.
import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const ORG_ID: JsonSchema = {type: 'string', minLength: 1, maxLength: 64};
const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};
const RESP_POLICY: JsonSchema = {type: 'object', additionalProperties: true};

export interface DomainPolicyScopeParams {
    orgId: string;
}
export const DOMAIN_POLICY_SCOPE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId'],
    additionalProperties: false,
    properties: {orgId: ORG_ID}
};

export type DomainPolicyGetInstanceParams = Record<string, never>;
export const DOMAIN_POLICY_GET_INSTANCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export interface DomainPolicySetParams {
    orgId: string;
    userLoginMustBeDomain?: boolean;
    validateOrgDomains?: boolean;
    smtpSenderAddressMatchesInstanceDomain?: boolean;
}
export const DOMAIN_POLICY_SET_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId'],
    additionalProperties: false,
    properties: {
        orgId: ORG_ID,
        userLoginMustBeDomain: {type: 'boolean'},
        validateOrgDomains: {type: 'boolean'},
        smtpSenderAddressMatchesInstanceDomain: {type: 'boolean'}
    }
};

export interface DomainPolicyInstanceSetParams {
    userLoginMustBeDomain?: boolean;
    validateOrgDomains?: boolean;
    smtpSenderAddressMatchesInstanceDomain?: boolean;
}
export const DOMAIN_POLICY_INSTANCE_SET_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        userLoginMustBeDomain: {type: 'boolean'},
        validateOrgDomains: {type: 'boolean'},
        smtpSenderAddressMatchesInstanceDomain: {type: 'boolean'}
    }
};

const PERM_ORG = {
    note: 'admin-only; tenant-scoped via requireOrganizationId'
};
const PERM_INSTANCE = {note: 'provider-support-only — instance-wide'};
const b = new DescribeBuilder('domain_policy', {
    kind: 'fleet-manager',
    description:
        'Read and write per-org and instance-wide Zitadel domain policy.'
});

b.registerMethod('GetPolicy', {
    safety: {operation: 'read'},
    params: DOMAIN_POLICY_SCOPE_SCHEMA,
    response: RESP_POLICY,
    permission: PERM_ORG,
    description: 'domain_policy.GetPolicy — per-org domain policy (effective).'
});
b.registerMethod('SetPolicy', {
    safety: {operation: 'update'},
    params: DOMAIN_POLICY_SET_SCHEMA,
    response: RESP_OK,
    permission: PERM_ORG,
    description:
        'domain_policy.SetPolicy — write per-org domain policy override.'
});
b.registerMethod('Reset', {
    safety: {operation: 'update'},
    params: DOMAIN_POLICY_SCOPE_SCHEMA,
    response: RESP_OK,
    permission: PERM_ORG,
    description:
        'domain_policy.Reset — drop org override; instance default applies.'
});
b.registerMethod('GetInstance', {
    safety: {operation: 'read'},
    params: DOMAIN_POLICY_GET_INSTANCE_SCHEMA,
    response: RESP_POLICY,
    permission: PERM_INSTANCE,
    description: 'domain_policy.GetInstance — instance-wide default policy.'
});
b.registerMethod('SetInstance', {
    safety: {operation: 'update'},
    params: DOMAIN_POLICY_INSTANCE_SET_SCHEMA,
    response: RESP_OK,
    permission: PERM_INSTANCE,
    description: 'domain_policy.SetInstance — instance-wide default policy.'
});

export const DOMAIN_POLICY_DESCRIBE: DescribeOutput = b.build();
