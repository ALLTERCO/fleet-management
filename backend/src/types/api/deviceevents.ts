/**
 * Public API types for the `deviceevents.*` namespace — the device change
 * journal (every device-reported state change, kept verbatim). Query is the
 * history view; the live view rides the existing System.Subscribe transport.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export const DEVICE_EVENT_KINDS = ['state_change', 'event', 'config'] as const;
export type DeviceEventKind = (typeof DEVICE_EVENT_KINDS)[number];

export const DEVICE_EVENT_KIND_LABELS: Record<DeviceEventKind, string> = {
    state_change: 'State change',
    event: 'Device event',
    config: 'Config change'
};

export const DEVICE_EVENT_QUERY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        from: {type: 'string', description: 'ISO-8601 inclusive start'},
        to: {type: 'string', description: 'ISO-8601 exclusive end'},
        shellyIds: {
            type: 'array',
            items: {type: 'string'},
            description:
                'Limit to these device IDs (one, many, or omit for all)'
        },
        component: {
            type: 'string',
            description: 'Limit to a component key, e.g. "switch:0"'
        },
        kind: {type: 'string', enum: [...DEVICE_EVENT_KINDS]},
        limit: {type: 'integer', minimum: 1, maximum: 10000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

const DEVICE_EVENT_ROW_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['ts', 'shelly_id', 'component', 'field', 'kind'],
    properties: {
        ts: {
            type: 'string',
            description: 'Device-reported time, preserved verbatim'
        },
        received_ts: {
            type: 'string',
            description: 'Time Fleet Manager received the change'
        },
        shelly_id: {type: 'string'},
        organization_id: {type: ['string', 'null']},
        component: {type: 'string', description: 'e.g. "switch:0"'},
        field: {type: 'string', description: 'e.g. "output"'},
        prev: {description: 'Value before the change (any JSON type, or null)'},
        next: {description: 'Value after the change (any JSON type, or null)'},
        kind: {type: 'string', enum: [...DEVICE_EVENT_KINDS]},
        source: {
            type: ['string', 'null'],
            enum: ['device', 'command', 'unknown', null]
        }
    },
    additionalProperties: true
};

export const DEVICE_EVENT_QUERY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: DEVICE_EVENT_ROW_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const DEVICE_EVENT_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'deviceevents',
    {
        kind: 'fleet-manager',
        description:
            'Query the device change journal — every device-reported state change, kept with the device timestamp verbatim.'
    }
)
    .registerMethod('Query', {
        safety: {operation: 'read'},
        params: DEVICE_EVENT_QUERY_PARAMS_SCHEMA,
        response: DEVICE_EVENT_QUERY_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Search the device change journal by time range, device IDs, component, and kind.'
    })
    .build();
