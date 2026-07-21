import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export interface AuthMintScopedTokenParams {
    purpose: 'devices.create';
    ttlSec?: number;
    organizationId?: string;
}

export const AUTH_MINT_SCOPED_TOKEN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['purpose'],
    properties: {
        purpose: {type: 'string', enum: ['devices.create']},
        ttlSec: {type: 'integer', minimum: 1, maximum: 1800},
        organizationId: {type: 'string', minLength: 1, maxLength: 120}
    }
};

export interface AuthMintScopedTokenResult {
    token: string;
    expiresAt: string;
    organizationId: string;
    purpose: string;
}

export const AUTH_MINT_SCOPED_TOKEN_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['token', 'expiresAt', 'organizationId', 'purpose'],
    properties: {
        token: {type: 'string'},
        expiresAt: {type: 'string'},
        organizationId: {type: 'string'},
        purpose: {type: 'string'}
    }
};

export const AUTH_DESCRIBE: DescribeOutput = new DescribeBuilder('auth', {
    kind: 'fleet-manager',
    description:
        'Issue short-lived, single-purpose scoped bearer tokens bound to the caller org.'
})
    .registerMethod('MintScopedToken', {
        safety: {operation: 'create'},
        params: AUTH_MINT_SCOPED_TOKEN_PARAMS_SCHEMA,
        response: AUTH_MINT_SCOPED_TOKEN_RESPONSE,
        permission: {note: 'authenticated; bounded PATs rejected'},
        description:
            'Issue a short-lived, single-purpose bearer token bound to the callers org. Plaintext is returned once; only its SHA-256 hash is persisted.'
    })
    .build();
