/**
 * Public API types for the `audit.*` namespace — audit log query + export.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export const AUDIT_EVENT_TYPES = [
    'login',
    'logout',
    'rpc',
    'device_online',
    'device_offline',
    'device_add',
    'device_delete',
    'device_reconnect_replace',
    'baseline_exclusion_change',
    'config_change',
    'permission_change',
    'mcp_tool_call'
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

// Human-readable labels for the audit-page filter dropdown.
export const AUDIT_EVENT_LABELS: Record<AuditEventType, string> = {
    login: 'User login',
    logout: 'User logout',
    rpc: 'RPC operation',
    device_online: 'Device online',
    device_offline: 'Device offline',
    device_add: 'Device added',
    device_delete: 'Device deleted',
    device_reconnect_replace: 'Device reconnect replaced existing socket',
    baseline_exclusion_change: 'Baseline exclusion changed',
    config_change: 'Config change',
    permission_change: 'Permission change',
    mcp_tool_call: 'MCP agent tool call'
};

// Column widths of logging.audit_log (migration 7339); a wider value matches nothing.
export const AGENT_KEY_ID_MAX_LENGTH = 255;
export const CORRELATION_ID_MAX_LENGTH = 64;

export interface AuditQueryParams {
    from?: string;
    to?: string;
    eventTypes?: AuditEventType[];
    username?: string;
    shellyId?: string;
    agentKeyId?: string;
    correlationId?: string;
    limit?: number;
    offset?: number;
}

export const AUDIT_QUERY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        from: {type: 'string', description: 'ISO-8601 inclusive start'},
        to: {type: 'string', description: 'ISO-8601 exclusive end'},
        eventTypes: {
            type: 'array',
            items: {type: 'string', enum: [...AUDIT_EVENT_TYPES]}
        },
        username: {type: 'string'},
        shellyId: {type: 'string'},
        agentKeyId: {
            type: 'string',
            maxLength: AGENT_KEY_ID_MAX_LENGTH,
            description:
                'Scoped credential id. Returns everything one agent key did.'
        },
        correlationId: {
            type: 'string',
            maxLength: CORRELATION_ID_MAX_LENGTH,
            description:
                'Every row produced by one MCP tool call. No time range is needed.'
        },
        limit: {type: 'integer', minimum: 1, maximum: 10000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

export interface AuditQueryRow {
    id: number;
    ts: string;
    event_type: string;
    username: string | null;
    shelly_id: string | null;
    shelly_ids: string[] | null;
    device_id: number | null;
    method: string | null;
    params: Record<string, unknown> | null;
    success: boolean;
    error_message: string | null;
    ip_address: string | null;
    agent_key_id: string | null;
    correlation_id: string | null;
}

export interface AuditQueryResponse {
    items: AuditQueryRow[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

const AUDIT_ROW_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'ts', 'event_type'],
    properties: {
        id: {type: 'integer'},
        ts: {type: 'string'},
        event_type: {type: 'string'},
        username: {type: ['string', 'null']},
        shelly_id: {type: ['string', 'null']},
        shelly_ids: {
            type: ['array', 'null'],
            items: {type: 'string'},
            description:
                'Every device the row touches — 1 for single-device ops, N for bulk ops, null for fleet-wide rows.'
        },
        method: {type: ['string', 'null']},
        params: {type: ['object', 'null'], additionalProperties: true},
        success: {type: 'boolean'},
        error_message: {type: ['string', 'null']},
        ip_address: {type: ['string', 'null']},
        agent_key_id: {
            type: ['string', 'null'],
            description:
                'Scoped credential the call arrived on. Null for a person.'
        },
        correlation_id: {
            type: ['string', 'null'],
            description: 'Shared by every row from one MCP tool call.'
        }
    },
    additionalProperties: true
};

export const AUDIT_QUERY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: AUDIT_ROW_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export interface AuditExportParams {
    from: string;
    to: string;
    eventTypes?: AuditEventType[];
}

export const AUDIT_EXPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['from', 'to'],
    properties: {
        from: {type: 'string'},
        to: {type: 'string'},
        eventTypes: {type: 'array', items: {type: 'string'}}
    }
};

export interface AuditExportResponse {
    filename: string;
    downloadUrl: string;
    downloadTicketUrl: string;
    rows: number;
    generated: string;
}

export const AUDIT_EXPORT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    description:
        'Export metadata. The file lives at AUDIT_EXPORTS_PATH; mint a single-use download URL via the ticket endpoint before download.',
    required: [
        'filename',
        'downloadUrl',
        'downloadTicketUrl',
        'rows',
        'generated'
    ],
    properties: {
        filename: {
            type: 'string',
            description:
                'Server-side filename, shape `audit-log-<tenant|fleet>-<epochMs>.csv`. Owner is the exporter; provider support gets `fleet` as the tenant segment.'
        },
        downloadUrl: {
            type: 'string',
            description:
                'GET path that streams the CSV. Requires either a valid mint-ticket on the query string or that the caller is the original exporter with audit-view role.'
        },
        downloadTicketUrl: {
            type: 'string',
            description:
                'POST this path (owner-bound) to mint a one-time download ticket. Response is `{downloadUrl}` with a fresh ticket embedded.'
        },
        rows: {type: 'integer', description: 'Number of rows in the CSV.'},
        generated: {
            type: 'string',
            description: 'ISO-8601 timestamp the export completed.'
        }
    }
};

export const AUDIT_DESCRIBE: DescribeOutput = new DescribeBuilder('audit', {
    kind: 'fleet-manager',
    description: 'Query and export the audit log of user and device activity.'
})
    .registerMethod('Query', {
        safety: {operation: 'read'},
        params: AUDIT_QUERY_PARAMS_SCHEMA,
        response: AUDIT_QUERY_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Search the audit log with optional time range, event-type, username, shellyID, agent key and MCP tool-call filters.'
    })
    .registerMethod('Export', {
        safety: {operation: 'create'},
        params: AUDIT_EXPORT_PARAMS_SCHEMA,
        response: AUDIT_EXPORT_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Export matching audit rows to a CSV file; returns a one-time download URL.'
    })
    .build();
