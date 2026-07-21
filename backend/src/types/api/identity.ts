// Identity admin RPCs — signing-key rotation, IdPs, SCIM, JWT IdP intent.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const ID_STR: JsonSchema = {type: 'string', minLength: 1, maxLength: 64};
const URL_STR: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 2048,
    pattern: '^https?://'
};
const EMAIL_STR: JsonSchema = {
    type: 'string',
    minLength: 3,
    maxLength: 320,
    pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
};
const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};

// ── RotateActionSigningKeys ────────────────────────────────────────────────
export type IdentityRotateParams = Record<string, never>;
export const IDENTITY_ROTATE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};
const IDENTITY_ROTATE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['gdprTargetId', 'grantTargetId'],
    properties: {
        gdprTargetId: ID_STR,
        grantTargetId: ID_STR,
        rotatedAt: {type: 'string', format: 'date-time'}
    }
};

// ── ListIdentityProviders ──────────────────────────────────────────────────
export type IdentityListIdpsParams = Record<string, never>;
export const IDENTITY_LIST_IDPS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};
const IDP_RESP: JsonSchema = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            id: ID_STR,
            name: {type: 'string'},
            type: {type: 'string'},
            state: {type: 'string'}
        }
    }
};

// ── AddOidcProvider ────────────────────────────────────────────────────────
export interface IdentityAddOidcIdpParams {
    name: string;
    issuer: string;
    clientId: string;
    clientSecret: string;
    scopes?: string[];
    autoCreation?: boolean;
}
export const IDENTITY_ADD_OIDC_IDP_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name', 'issuer', 'clientId', 'clientSecret'],
    additionalProperties: false,
    properties: {
        name: {type: 'string', minLength: 1, maxLength: 128},
        issuer: URL_STR,
        clientId: {type: 'string', minLength: 1, maxLength: 256},
        clientSecret: {type: 'string', minLength: 1, maxLength: 1024},
        scopes: {
            type: 'array',
            items: {type: 'string', minLength: 1, maxLength: 64},
            maxItems: 32
        },
        autoCreation: {type: 'boolean'}
    }
};

// ── DeleteIdentityProvider ─────────────────────────────────────────────────
export interface IdentityDeleteIdpParams {
    id: string;
}
export const IDENTITY_DELETE_IDP_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: ID_STR}
};

// ── GetScimSettings / SetScimEnabled ───────────────────────────────────────
export type IdentityGetScimParams = Record<string, never>;
export const IDENTITY_GET_SCIM_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};
export interface IdentitySetScimParams {
    enabled: boolean;
}
export const IDENTITY_SET_SCIM_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['enabled'],
    additionalProperties: false,
    properties: {enabled: {type: 'boolean'}}
};
const SCIM_RESP: JsonSchema = {
    type: 'object',
    required: ['enabled', 'endpoint'],
    properties: {
        enabled: {type: 'boolean'},
        endpoint: {type: 'string'},
        managementApiHint: {type: 'string'}
    }
};

// ── GetJwtIntentSettings ──────────────────────────────────────────────────
export type IdentityGetJwtIntentParams = Record<string, never>;
export const IDENTITY_GET_JWT_INTENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};
const JWT_INTENT_RESP: JsonSchema = {
    type: 'object',
    required: ['enabled', 'tokenEndpoint'],
    properties: {
        enabled: {type: 'boolean'},
        tokenEndpoint: {type: 'string'},
        grantType: {type: 'string'},
        documentation: {type: 'string'}
    }
};

// ── Zitadel identity SMTP ─────────────────────────────────────────────────
export type IdentitySmtpAuthMode = 'none' | 'plain';

export interface IdentitySmtpSettings {
    enabled: boolean;
    configured: boolean;
    id?: string;
    state?: string;
    authMode: IdentitySmtpAuthMode;
    host: string;
    senderAddress: string;
    senderName: string;
    tls: boolean;
    user?: string;
    replyToAddress?: string;
    description?: string;
    passwordSet: boolean;
}

export type IdentityGetSmtpSettingsParams = Record<string, never>;
export const IDENTITY_GET_SMTP_SETTINGS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export interface IdentitySetSmtpSettingsParams {
    enabled: boolean;
    authMode: IdentitySmtpAuthMode;
    host?: string;
    senderAddress?: string;
    senderName?: string;
    tls?: boolean;
    user?: string;
    password?: string;
    replyToAddress?: string;
    description?: string;
}

export const IDENTITY_SET_SMTP_SETTINGS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['enabled', 'authMode'],
    additionalProperties: false,
    properties: {
        enabled: {type: 'boolean'},
        authMode: {type: 'string', enum: ['none', 'plain']},
        host: {type: 'string', minLength: 1, maxLength: 512},
        senderAddress: EMAIL_STR,
        senderName: {type: 'string', minLength: 1, maxLength: 256},
        tls: {type: 'boolean'},
        user: {type: 'string', minLength: 1, maxLength: 512},
        password: {type: 'string', minLength: 1, maxLength: 2048},
        replyToAddress: EMAIL_STR,
        description: {type: 'string', maxLength: 512}
    }
};

export interface IdentityTestSmtpSettingsParams {
    receiverAddress: string;
    authMode: IdentitySmtpAuthMode;
    id?: string;
    host?: string;
    senderAddress?: string;
    senderName?: string;
    tls?: boolean;
    user?: string;
    password?: string;
}

export const IDENTITY_TEST_SMTP_SETTINGS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['receiverAddress', 'authMode'],
    additionalProperties: false,
    properties: {
        receiverAddress: EMAIL_STR,
        authMode: {type: 'string', enum: ['none', 'plain']},
        id: ID_STR,
        host: {type: 'string', minLength: 1, maxLength: 512},
        senderAddress: EMAIL_STR,
        senderName: {type: 'string', minLength: 1, maxLength: 256},
        tls: {type: 'boolean'},
        user: {type: 'string', minLength: 1, maxLength: 512},
        password: {type: 'string', minLength: 1, maxLength: 2048}
    }
};

const SMTP_SETTINGS_RESP: JsonSchema = {
    type: 'object',
    required: [
        'enabled',
        'configured',
        'authMode',
        'host',
        'senderAddress',
        'senderName',
        'tls',
        'passwordSet'
    ],
    properties: {
        enabled: {type: 'boolean'},
        configured: {type: 'boolean'},
        id: ID_STR,
        state: {type: 'string'},
        authMode: {type: 'string', enum: ['none', 'plain']},
        host: {type: 'string'},
        senderAddress: {type: 'string'},
        senderName: {type: 'string'},
        tls: {type: 'boolean'},
        user: {type: 'string'},
        replyToAddress: {type: 'string'},
        description: {type: 'string'},
        passwordSet: {type: 'boolean'}
    }
};

const PERM = {
    note: 'provider-support-only — instance-wide Zitadel admin API'
};

const b = new DescribeBuilder('identity', {
    kind: 'fleet-manager',
    description: 'Administer signing keys, identity providers, SCIM, and SMTP.'
});
b.registerMethod('RotateActionSigningKeys', {
    safety: {operation: 'update'},
    params: IDENTITY_ROTATE_SCHEMA,
    response: IDENTITY_ROTATE_RESPONSE,
    permission: PERM,
    description:
        'Identity.RotateActionSigningKeys — recreate Action V2 GDPR + grant-change targets. Old keys move to _PREVIOUS slots; FM keeps both verifying through the replay window.'
});
b.registerMethod('ListIdentityProviders', {
    safety: {operation: 'read'},
    params: IDENTITY_LIST_IDPS_SCHEMA,
    response: IDP_RESP,
    permission: PERM,
    description:
        'Identity.ListIdentityProviders — list configured external IdPs (OIDC, SAML, social).'
});
b.registerMethod('AddOidcProvider', {
    safety: {operation: 'create'},
    params: IDENTITY_ADD_OIDC_IDP_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'identity.AddOidcProvider — register a generic OIDC IdP at instance scope.'
});
b.registerMethod('DeleteIdentityProvider', {
    safety: {operation: 'delete'},
    params: IDENTITY_DELETE_IDP_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'Identity.DeleteIdentityProvider — remove an IdP by id.'
});
b.registerMethod('GetScimSettings', {
    safety: {operation: 'read'},
    params: IDENTITY_GET_SCIM_SCHEMA,
    response: SCIM_RESP,
    permission: PERM,
    description:
        'Identity.GetScimSettings — current SCIM v2 inbound provisioning state + endpoint URL.'
});
b.registerMethod('SetScimEnabled', {
    safety: {operation: 'update'},
    params: IDENTITY_SET_SCIM_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'Identity.SetScimEnabled — flip Zitadel SCIM endpoint on/off via FM_ZITADEL_SCIM_ENABLED.'
});
b.registerMethod('GetJwtIntentSettings', {
    safety: {operation: 'read'},
    params: IDENTITY_GET_JWT_INTENT_SCHEMA,
    response: JWT_INTENT_RESP,
    permission: PERM,
    description:
        'Identity.GetJwtIntentSettings — JWT IdP intent (urn:ietf:params:oauth:grant-type:jwt-bearer) endpoint + docs link.'
});
b.registerMethod('GetSmtpSettings', {
    safety: {operation: 'read'},
    params: IDENTITY_GET_SMTP_SETTINGS_SCHEMA,
    response: SMTP_SETTINGS_RESP,
    permission: PERM,
    description:
        'Identity.GetSmtpSettings — instance-wide Zitadel identity-email SMTP provider, with secrets redacted. Platform/provider-support only; tenant admins manage notification channels instead.'
});
b.registerMethod('SetSmtpSettings', {
    safety: {operation: 'update'},
    params: IDENTITY_SET_SMTP_SETTINGS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'Identity.SetSmtpSettings — create/update/deactivate the instance-wide Zitadel identity-email SMTP provider for login/reset/verification/invite mail. Platform/provider-support only; not tenant/org-scoped.'
});
b.registerMethod('TestSmtpSettings', {
    safety: {operation: 'execute'},
    params: IDENTITY_TEST_SMTP_SETTINGS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'Identity.TestSmtpSettings — ask Zitadel to send a test email through draft identity SMTP settings. Platform/provider-support only; the SMTP password must be supplied for plain-auth tests because Zitadel does not expose saved secrets.'
});

export const IDENTITY_DESCRIBE: DescribeOutput = b.build();
