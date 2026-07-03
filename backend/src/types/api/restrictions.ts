// Zitadel instance restrictions: allowed UI languages + public-org-registration toggle.
import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};
const RESP_RESTRICTIONS: JsonSchema = {
    type: 'object',
    additionalProperties: true
};

export type RestrictionsGetParams = Record<string, never>;
export const RESTRICTIONS_GET_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export interface RestrictionsSetParams {
    disallowPublicOrgRegistration?: boolean;
    allowedLanguages?: string[];
}
export const RESTRICTIONS_SET_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        disallowPublicOrgRegistration: {type: 'boolean'},
        allowedLanguages: {
            type: 'array',
            items: {type: 'string', pattern: '^[a-zA-Z-]{2,10}$'},
            maxItems: 50
        }
    }
};

const PERM = {
    note: 'provider-support-only — instance-wide Zitadel /admin/v1/restrictions'
};
const b = new DescribeBuilder('restrictions', {
    kind: 'fleet-manager',
    description:
        'Read and write instance-wide Zitadel restrictions for languages and org registration.'
});

b.registerMethod('Get', {
    params: RESTRICTIONS_GET_SCHEMA,
    response: RESP_RESTRICTIONS,
    permission: PERM,
    description: 'Restrictions.Get — current instance restrictions.'
});
b.registerMethod('Set', {
    params: RESTRICTIONS_SET_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'Restrictions.Set — disallow public org registration / cap allowed UI languages.'
});

export const RESTRICTIONS_DESCRIBE: DescribeOutput = b.build();
