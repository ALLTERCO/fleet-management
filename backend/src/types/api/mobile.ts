// Composite read endpoints for one-round-trip mobile launch + resume.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import type {UiCapabilities} from './permissions';

const EMPTY_PARAMS: JsonSchema = {type: 'object', properties: {}};

export interface MobileGetBootstrapParams {
    deviceLimit?: number;
}

export const MOBILE_GET_BOOTSTRAP_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        deviceLimit: {type: 'integer', minimum: 1, maximum: 500}
    },
    additionalProperties: false
};

export interface MobileSyncDeltaParams {
    since: string;
}

export const MOBILE_SYNC_DELTA_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['since'],
    properties: {
        since: {type: 'string', format: 'date-time'}
    },
    additionalProperties: false
};

export interface MobileBootstrapResponse {
    serverTime: string;
    user: {
        username: string;
        organizationId: string | null;
        isAdmin: boolean;
    };
    // Full User.GetMe payload (typed loose to avoid coupling).
    permissions: Record<string, unknown>;
    uiCapabilities: UiCapabilities;
    devices: {
        visible: boolean;
        items: unknown[];
        total: number;
    };
    waitingRoom: {
        visible: boolean;
        pendingCount: number;
        pending: Record<string, unknown>;
    };
    alerts: {
        visible: boolean;
        openCount: number;
        criticalCount: number;
    };
}

export interface MobileSyncDeltaResponse {
    serverTime: string;
    devices: {
        visible: boolean;
        changed: unknown[];
    };
    waitingRoom: {
        visible: boolean;
        pendingCount: number;
        pending: Record<string, unknown>;
    };
    alerts: {
        visible: boolean;
        openCount: number;
        criticalCount: number;
    };
}

const ANY_RESPONSE: JsonSchema = {type: 'object', additionalProperties: true};
const AUTH_PERM = {note: 'authenticated'};

export const MOBILE_DESCRIBE: DescribeOutput = new DescribeBuilder('mobile', {
    kind: 'fleet-manager',
    description:
        'Provide composite bootstrap and delta sync endpoints for mobile app launch and resume.'
})
    .registerMethod('Describe', {
        params: EMPTY_PARAMS,
        response: ANY_RESPONSE,
        permission: {note: 'public'},
        description: 'Component metadata.'
    })
    .registerMethod('GetBootstrap', {
        safety: {operation: 'read'},
        params: MOBILE_GET_BOOTSTRAP_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: AUTH_PERM,
        description:
            'Composite endpoint for mobile app launch — returns slim ' +
            'device list, waiting-room count, alert counts, and identity ' +
            'in one round trip. Sections the caller cannot read are ' +
            'returned with visible=false.'
    })
    .registerMethod('SyncDelta', {
        safety: {operation: 'read'},
        params: MOBILE_SYNC_DELTA_PARAMS_SCHEMA,
        response: ANY_RESPONSE,
        permission: AUTH_PERM,
        description:
            'Returns devices changed since the given timestamp + current ' +
            'waiting-room count. For mobile resume / incremental refresh.'
    })
    .build();
