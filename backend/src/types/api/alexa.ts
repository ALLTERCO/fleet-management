/**
 * Public API types for the `Alexa.*` namespace.
 *
 * First concrete consumer of the Phase 0b shared types package — proves
 * the end-to-end pattern before Phase 1 domains follow it.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

// --- Types ---------------------------------------------------------------

export interface AlexaEnableParams {
    access_token: string;
    refresh_token: string;
    entities: string[];
}

export interface AlexaEnableResponse {
    cmd: 'enable';
    params: AlexaEnableParams;
}

export interface AlexaDisableResponse {
    cmd: 'disable';
}

// --- Schemas -------------------------------------------------------------

export const ALEXA_ENABLE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['access_token', 'refresh_token', 'entities'],
    properties: {
        access_token: {
            type: 'string',
            minLength: 1,
            description: 'OAuth access token from the Alexa skill'
        },
        refresh_token: {
            type: 'string',
            minLength: 1,
            description: 'OAuth refresh token from the Alexa skill'
        },
        entities: {
            type: 'array',
            items: {type: 'string'},
            description: 'Entity IDs exposed through the skill'
        }
    }
};

export const ALEXA_ENABLE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['cmd', 'params'],
    properties: {
        cmd: {type: 'string', const: 'enable'},
        params: ALEXA_ENABLE_PARAMS_SCHEMA
    }
};

export const ALEXA_DISABLE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {}
};

export const ALEXA_DISABLE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['cmd'],
    properties: {
        cmd: {type: 'string', const: 'disable'}
    }
};

// --- Describe() output ---------------------------------------------------

/**
 * Immutable Describe() output for the Alexa namespace. Built at module
 * load time (pure — no class instance, no config dependency) so tests can
 * assert against it without instantiating AlexaComponent.
 */
export const ALEXA_DESCRIBE: DescribeOutput = new DescribeBuilder('alexa', {
    kind: 'fleet-manager',
    description:
        'Enable or disable the Alexa skill integration and manage its OAuth tokens.'
})
    .registerMethod('Enable', {
        safety: {operation: 'update'},
        params: ALEXA_ENABLE_PARAMS_SCHEMA,
        response: ALEXA_ENABLE_RESPONSE_SCHEMA,
        permission: {
            note: 'provider-support-only — instance-wide Alexa skill integration'
        },
        description:
            'Enable Alexa skill integration with provided OAuth tokens.'
    })
    .registerMethod('Disable', {
        safety: {operation: 'update'},
        params: ALEXA_DISABLE_PARAMS_SCHEMA,
        response: ALEXA_DISABLE_RESPONSE_SCHEMA,
        permission: {
            note: 'provider-support-only — instance-wide Alexa skill integration'
        },
        description: 'Disable Alexa skill integration and clear tokens.'
    })
    .build();
