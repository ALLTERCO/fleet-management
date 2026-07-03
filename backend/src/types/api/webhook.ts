// Device-side Webhook.* — outbound HTTP webhooks managed per device.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

// ── Local atoms ──────────────────────────────────────────────────────────

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description: 'Device-defined response — shape not publicly fixed by Shelly'
};

// ── Per-method exports ──────────────────────────────────────────────

export interface WebhookListParams {
    shellyID: string;
}
export const WEBHOOK_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

export interface WebhookListSupportedParams {
    shellyID: string;
}
export const WEBHOOK_LIST_SUPPORTED_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// fw 2.0+ paginated replacement for ListSupported.
export interface WebhookListAllSupportedParams {
    shellyID: string;
    offset?: number;
}
export const WEBHOOK_LIST_ALL_SUPPORTED_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        offset: {type: 'integer'}
    }
};

// Field names mirror Webhook.Create on the device. Value sets (event names
// from ListSupported, url shape, condition expr) are device-owned.
// urls cap (max 5, 300 chars each) and 20-hook total are device-enforced.
export interface WebhookCreateParams {
    shellyID: string;
    cid: number;
    event: string;
    urls: string[];
    enable?: boolean;
    name?: string;
    ssl_ca?: string | null;
    active_between?: string[];
    condition?: string;
    repeat_period?: number;
}
export const WEBHOOK_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'cid', 'event', 'urls'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        cid: {type: 'integer'},
        event: {type: 'string'},
        urls: {type: 'array', items: {type: 'string'}},
        enable: {type: 'boolean'},
        name: {type: 'string'},
        ssl_ca: {type: ['string', 'null']},
        active_between: {type: 'array', items: {type: 'string'}},
        condition: {type: 'string'},
        repeat_period: {type: 'integer'}
    }
};

export interface WebhookUpdateParams {
    shellyID: string;
    id: number;
    cid?: number;
    event?: string;
    urls?: string[];
    enable?: boolean;
    name?: string;
    ssl_ca?: string | null;
    active_between?: string[];
    condition?: string;
    repeat_period?: number;
}
export const WEBHOOK_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: {type: 'integer'},
        cid: {type: 'integer'},
        event: {type: 'string'},
        urls: {type: 'array', items: {type: 'string'}},
        enable: {type: 'boolean'},
        name: {type: 'string'},
        ssl_ca: {type: ['string', 'null']},
        active_between: {type: 'array', items: {type: 'string'}},
        condition: {type: 'string'},
        repeat_period: {type: 'integer'}
    }
};

export interface WebhookDeleteParams {
    shellyID: string;
    id: number;
}
export const WEBHOOK_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'id'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        id: {type: 'integer'}
    }
};

// Spec: no params besides shellyID. The earlier draft had a speculative
// `cid?` filter; dropped to align with official Webhook.DeleteAll spec.
export interface WebhookDeleteAllParams {
    shellyID: string;
}
export const WEBHOOK_DELETE_ALL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// ── Describe ────────────────────────────────────────────────────────

const b = new DescribeBuilder('webhook', {
    kind: 'device',
    description:
        'Relay the device webhook namespace for outbound HTTP webhooks per device.'
});

b.registerMethod('List', {
    params: WEBHOOK_LIST_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Webhook.List — all webhooks on the device.'
});
b.registerMethod('ListSupported', {
    params: WEBHOOK_LIST_SUPPORTED_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description:
        'Webhook.ListSupported — event types this fw supports (deprecated as of fw 2.0; use ListAllSupported).'
});
b.registerMethod('ListAllSupported', {
    params: WEBHOOK_LIST_ALL_SUPPORTED_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Webhook.ListAllSupported — paginated event types (fw 2.0+).'
});
b.registerMethod('Create', {
    params: WEBHOOK_CREATE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description:
        'Webhook.Create — register an outbound HTTP hook. Limits: 20/device (10 battery), 5 urls/hook, 300 chars/url.'
});
b.registerMethod('Update', {
    params: WEBHOOK_UPDATE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Webhook.Update — patch an existing hook by id.'
});
b.registerMethod('Delete', {
    params: WEBHOOK_DELETE_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Webhook.Delete — remove one hook by id.'
});
b.registerMethod('DeleteAll', {
    params: WEBHOOK_DELETE_ALL_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Webhook.DeleteAll — wipe all hooks.'
});

export const WEBHOOK_DESCRIBE: DescribeOutput = b.build();
