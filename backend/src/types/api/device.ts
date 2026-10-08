// `Device.*` Describe — FM-domain methods only.
// Lifecycle (Reboot/FactoryReset/Update/CheckForUpdate/SetProfile/ListProfiles)
// and identity passthroughs live in `shelly` ns. Network/connectivity
// passthroughs (Cloud/BLE/Wifi/Eth/Modbus) live in their own per-namespace
// components (cloud, ble, wifi, eth, modbus) per the 1:1 Shelly-mirror rule.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';
import {DEVICE_KIND_SET_PARAMS_SCHEMA} from './deviceKind';
import {DEVICE_SOURCE_VALUES} from './deviceSource';

const RESP_OPAQUE: JsonSchema = {
    type: 'object',
    description:
        'Device-defined response — shape not publicly documented by Shelly'
};

const RESP_LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total'],
    properties: {
        items: {type: 'array'},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'},
        next_cursor: {
            type: ['string', 'null'],
            description:
                'Pass as `cursor` for the next page. null on the last page.'
        }
    },
    description: 'Fleet Manager list envelope'
};

/** Largest page device.list serves; a bigger limit is served as this. */
export const DEVICE_LIST_MAX_LIMIT = 1000;
/** Most devices one device.list `shellyIDs` read may name. */
export const DEVICE_LIST_MAX_IDS = 100;

// info/status/settings/meta are the device's own payload, so they stay open —
// they differ by model and by whether the row is live, virtual or BLU.
const RESP_DEVICE_BLOB: JsonSchema = {
    type: 'object',
    additionalProperties: true
};

const RESP_DEVICE_CAPABILITIES: JsonSchema = {
    type: 'object',
    // Open on purpose: a new firmware capability must not invalidate the shape.
    additionalProperties: true,
    properties: {
        backup: {type: 'boolean'},
        restore: {type: 'boolean'},
        firmwareUpdate: {type: 'boolean'},
        firmwareCheck: {type: 'boolean'},
        otaCommit: {type: 'boolean'},
        matter: {type: 'boolean'},
        tlsUserCA: {type: 'boolean'},
        tlsClientCert: {type: 'boolean'},
        xmod: {type: 'boolean'},
        ir: {type: 'boolean'},
        service: {type: 'boolean'},
        serviceResetCounters: {type: 'boolean'},
        virtualComponents: {type: 'boolean'},
        addons: {type: 'array', items: {type: 'string'}},
        ui: {type: 'object', additionalProperties: true}
    }
};

// Full device JSON: toJSON() plus the memberships and the two stamped columns.
const RESP_DEVICE_FULL: JsonSchema = {
    type: 'object',
    required: [
        'shellyID',
        'id',
        'source',
        'info',
        'status',
        'settings',
        'presence',
        'entities',
        'capabilities',
        'meta',
        'groupIds',
        'locationId',
        'tagIds',
        'kind',
        'costCenter'
    ],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: {type: 'integer'},
        source: {
            anyOf: [
                {type: 'string', enum: [...DEVICE_SOURCE_VALUES]},
                {type: 'null'}
            ]
        },
        info: RESP_DEVICE_BLOB,
        status: RESP_DEVICE_BLOB,
        settings: RESP_DEVICE_BLOB,
        presence: {type: 'string', enum: ['online', 'offline', 'pending']},
        entities: {type: 'array', items: {type: 'string'}},
        capabilities: RESP_DEVICE_CAPABILITIES,
        methods: {type: 'array', items: {type: 'string'}},
        meta: RESP_DEVICE_BLOB,
        profile: {type: 'object', additionalProperties: true},
        lastSeenSleepingMs: {type: 'integer'},
        // The handler always stamps these, even when the device has none.
        groupIds: {type: 'array', items: {type: 'integer'}},
        locationId: {type: ['integer', 'null']},
        tagIds: {type: 'array', items: {type: 'integer'}},
        kind: {type: ['string', 'null']},
        costCenter: {type: ['string', 'null']}
    },
    description: 'Full device JSON (info + status + settings)'
};

// A device the caller cannot reach is reported refused, never dropped, so
// results always has one entry per requested device.
const RESP_CALL_MANY: JsonSchema = {
    type: 'object',
    required: ['method', 'requested', 'succeeded', 'failed', 'results'],
    additionalProperties: false,
    properties: {
        method: {type: 'string'},
        requested: {type: 'integer', minimum: 0},
        succeeded: {type: 'integer', minimum: 0},
        failed: {type: 'integer', minimum: 0},
        results: {
            type: 'array',
            items: {
                anyOf: [
                    {
                        type: 'object',
                        required: ['shellyID', 'ok', 'result'],
                        additionalProperties: false,
                        properties: {
                            shellyID: SHELLY_ID_SCHEMA,
                            ok: {const: true},
                            result: {
                                description:
                                    'Device-defined; may be absent for a void reply.'
                            }
                        }
                    },
                    {
                        type: 'object',
                        required: ['shellyID', 'ok', 'error'],
                        additionalProperties: false,
                        properties: {
                            shellyID: SHELLY_ID_SCHEMA,
                            ok: {const: false},
                            error: {type: 'string'}
                        }
                    }
                ]
            }
        }
    }
};

const RESP_EM_CHANNEL: JsonSchema = {
    type: 'object',
    required: ['channel', 'act_power', 'voltage', 'current'],
    additionalProperties: false,
    properties: {
        channel: {type: 'integer', minimum: 0},
        act_power: {type: ['number', 'null']},
        voltage: {type: ['number', 'null']},
        current: {type: ['number', 'null']}
    }
};

// An unknown or offline device reports empty arrays rather than an error.
const RESP_DEVICE_CHANNELS: JsonSchema = {
    type: 'object',
    required: ['emChannels', 'em1Channels'],
    additionalProperties: false,
    properties: {
        emChannels: {type: 'array', items: RESP_EM_CHANNEL},
        em1Channels: {type: 'array', items: RESP_EM_CHANNEL}
    }
};

// profile -> config name -> either the config blob (mode=json) or the
// serialized setconfig requests (mode=rpc). Keys are user-defined at all
// levels, and permission filtering decides which profiles a caller sees.
const RESP_SETUP_PROFILES: JsonSchema = {
    type: 'object',
    description: 'Config profiles keyed by profile name',
    additionalProperties: {
        type: 'object',
        additionalProperties: {
            anyOf: [
                {type: 'object', additionalProperties: true},
                {type: 'array', items: {type: 'string'}}
            ]
        }
    }
};

const RAW_RPC_METHOD: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 160,
    description: 'Shelly device RPC method, for example Shelly.GetDeviceInfo'
};

const RAW_RPC_PARAMS: JsonSchema = {
    type: 'object',
    maxBytes: 65536,
    additionalProperties: true,
    description: 'Shelly device RPC params object, limited to 64 KiB serialized'
};

export interface DeviceListParams {
    filters?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    cursor?: string;
    shellyIDs?: string[];
    include?: string[];
}
// Enumerated rather than open. An open filter object accepted any key and the
// list quietly matched nothing, so `filters: {locationId: 7}` returned an empty
// fleet instead of an error. Naming them here is what lets the API, the docs
// and the host SDK agree on the answer.
export const DEVICE_LIST_FILTERS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    description:
        'All supplied filters must match. locationId is the one location a device sits in; groupId and tagId ask whether it is a member.',
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: {type: 'integer'},
        source: {type: 'string', enum: [...DEVICE_SOURCE_VALUES]},
        presence: {type: 'string', enum: ['online', 'offline', 'pending']},
        locationId: {type: 'integer'},
        groupId: {type: 'integer'},
        tagId: {type: 'integer'},
        model: {
            type: 'string',
            description: 'Hardware model, e.g. SNSW-001X16EU'
        },
        kind: {
            type: 'string',
            description:
                'Assigned device kind. Only physical devices carry one.'
        },
        battery: {
            type: 'boolean',
            description:
                'Battery-powered devices, the ones that sleep between wakeups. Virtual and BLU records are skipped, not reported false.'
        },
        component: {
            type: 'string',
            description:
                'Devices having this component type, e.g. switch, em, light.'
        }
    }
};

export const DEVICE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
        filters: DEVICE_LIST_FILTERS_SCHEMA,
        limit: {
            type: 'integer',
            minimum: 0,
            description: `Default 500. A limit above ${DEVICE_LIST_MAX_LIMIT} is served as ${DEVICE_LIST_MAX_LIMIT}. 0 returns every row on an offset page and ${DEVICE_LIST_MAX_LIMIT} on a cursor page.`
        },
        offset: {
            type: 'integer',
            minimum: 0,
            description: 'Not with `cursor`.'
        },
        cursor: {
            type: 'string',
            minLength: 1,
            maxLength: 200,
            description:
                '`next_cursor` of the previous page. Rows are ordered by device row id, so a device added while paging comes last and no row repeats or is skipped. Not with `offset`.'
        },
        shellyIDs: {
            type: 'array',
            items: SHELLY_ID_SCHEMA,
            minItems: 1,
            maxItems: DEVICE_LIST_MAX_IDS,
            description:
                'Read only these devices, after `filters`. Each is checked for device read access like Device.Get; an unknown or unreadable id is left out.'
        },
        include: {
            type: 'array',
            items: {type: 'string'},
            description:
                'Extra detail for each row, which is short by default. ' +
                "'status' returns the full status and 'settings' the full settings. " +
                "'sys' returns the full sys section instead of three fields. " +
                "Any other value names a status section and returns it in full, for example 'eth' adds ip6."
        }
    }
};

export interface DeviceShellyOnlyParams {
    shellyID: string;
}
export const DEVICE_SHELLY_ONLY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID_SCHEMA}
};

// ListRetired takes no arguments; the empty schema rejects stray params.
export const DEVICE_NO_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export interface DeviceCheckReplacementParams {
    oldShellyID: string;
    newShellyID: string;
}
export const DEVICE_CHECK_REPLACEMENT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['oldShellyID', 'newShellyID'],
    additionalProperties: false,
    properties: {
        oldShellyID: SHELLY_ID_SCHEMA,
        newShellyID: SHELLY_ID_SCHEMA
    }
};

export interface DeviceReplaceHardwareParams
    extends DeviceCheckReplacementParams {
    confirmedMapping?: Record<string, unknown>;
}
export const DEVICE_REPLACE_HARDWARE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['oldShellyID', 'newShellyID'],
    additionalProperties: false,
    properties: {
        oldShellyID: SHELLY_ID_SCHEMA,
        newShellyID: SHELLY_ID_SCHEMA,
        confirmedMapping: {type: 'object', additionalProperties: true}
    }
};

export interface DeviceGetSetupParams {
    shellyID?: string;
    mode?: 'json' | 'rpc';
}
export const DEVICE_GET_SETUP_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        shellyID: {
            ...SHELLY_ID_SCHEMA,
            description: 'Ignored compatibility field for older clients'
        },
        mode: {type: 'string', enum: ['json', 'rpc'], default: 'json'}
    }
};

export interface DeviceCallParams {
    shellyID: string;
    method: string;
    params?: Record<string, unknown>;
}
export const DEVICE_CALL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'method'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        method: RAW_RPC_METHOD,
        params: RAW_RPC_PARAMS
    }
};

/**
 * The same call, on many devices, as ONE action.
 *
 * Without this an agent asked to "turn the kitchen lights off" issued one
 * device.Call per lamp, and a human approving that saw one prompt per lamp.
 * People click through twelve prompts, which trains them not to read the
 * thirteenth — the exact failure approval exists to prevent.
 *
 * Permission is still checked per device, so this widens nothing: it is one
 * decision over a set the human can see, not one decision that skips checks.
 */
export interface DeviceCallManyParams {
    shellyIDs: string[];
    method: string;
    params?: Record<string, unknown>;
}

export const DEVICE_CALL_MANY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyIDs', 'method'],
    additionalProperties: false,
    properties: {
        shellyIDs: {
            type: 'array',
            items: SHELLY_ID_SCHEMA,
            minItems: 1,
            description:
                'Every device to run the method on. Each is permission-checked separately.'
        },
        method: RAW_RPC_METHOD,
        params: RAW_RPC_PARAMS
    }
};

export interface DeviceTimeRangeParams {
    shellyID: string;
    field: string;
    from: string;
    to: string;
}
export const DEVICE_GET_STATUS_TIMELINE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'field', 'from', 'to'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        field: {
            type: 'string',
            description: 'Status field path (e.g. "switch:0.output")'
        },
        from: {type: 'string', description: 'ISO 8601 start timestamp'},
        to: {type: 'string', description: 'ISO 8601 end timestamp'}
    }
};
export const DEVICE_GET_STATUS_HISTORY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'field', 'from', 'to'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        field: {
            type: 'string',
            description: 'Status field path (e.g. "switch:0.apower")'
        },
        from: {type: 'string', description: 'ISO 8601 start timestamp'},
        to: {type: 'string', description: 'ISO 8601 end timestamp'}
    }
};

export const DEVICE_RELATIONSHIP_INCLUDES = [
    'membership',
    'visuals',
    'costCenter',
    'serves',
    'components',
    'virtualBindings',
    'virtualDependents',
    'bluetooth',
    'provenance',
    'extraction',
    'alerts',
    'automations',
    'notificationRouting',
    'dashboards',
    'energyClassification',
    'operations',
    'securityState',
    'accessGrants',
    'deviceSchedules',
    'deviceScripts',
    'deviceWebhooks',
    'deviceSubresources',
    'externalConnections',
    'health',
    'recentHistory'
] as const;

export type DeviceRelationshipInclude =
    (typeof DEVICE_RELATIONSHIP_INCLUDES)[number];

export const DEVICE_RELATIONSHIP_DEFAULT_INCLUDES = [
    'membership',
    'visuals',
    'costCenter',
    'serves',
    'components',
    'virtualBindings',
    'virtualDependents',
    'bluetooth',
    'extraction',
    'alerts',
    'automations',
    'dashboards',
    'health'
] as const satisfies readonly DeviceRelationshipInclude[];

export const DEVICE_RELATIONSHIP_NODE_TYPES = [
    'device.physical',
    'device.bluetooth',
    'device.virtual',
    'device.extracted',
    'device.connector',
    'component',
    'entity',
    'virtual.role',
    'blu.transport',
    'profile',
    'asset.visual',
    'cost.center',
    'group',
    'location',
    'tag',
    'dashboard',
    'dashboard.item',
    'action.template',
    'automation.flow',
    'automation.node',
    'alert.rule',
    'maintenance.window',
    'notification.routing_policy',
    'notification.destination_group',
    'notification.channel',
    'notification.on_call_schedule',
    'energy.classification',
    'history.event',
    'operation.job',
    'operation.unit',
    'credential.state',
    'certificate',
    'assignment.grant',
    'user',
    'user.group',
    'device.schedule',
    'device.script',
    'device.webhook',
    'device.subresource',
    'external.connection',
    'connector.point'
] as const;

export type RelationshipNodeType =
    (typeof DEVICE_RELATIONSHIP_NODE_TYPES)[number];

export const DEVICE_RELATIONSHIP_EDGE_TYPES = [
    'has_component',
    'has_entity',
    'binds_role_to_source',
    'source_feeds_virtual_role',
    'depends_on_source',
    'used_by_virtual_device',
    'extracts_from',
    'promoted_from_gateway_component',
    'transported_by_gateway',
    'heard_by_gateway',
    'uses_profile',
    'has_visual_asset',
    'charged_to_cost_center',
    'serves',
    'belongs_to_group',
    'located_in',
    'tagged_with',
    'child_of_group',
    'child_of_location',
    'shown_on_dashboard',
    'dashboard_contains_item',
    'dashboard_item_refs_device',
    'dashboard_item_refs_entity',
    'dashboard_item_refs_component',
    'dashboard_item_refs_group',
    'dashboard_item_refs_location',
    'dashboard_item_refs_tag',
    'dashboard_item_refs_action',
    'automation_refs_device',
    'device_event_feeds_automation',
    'automation_calls_rpc',
    'targets_device',
    'has_credential_state',
    'has_certificate',
    'grants_access_to_device',
    'grant_assigned_to_subject',
    'controls',
    'controlled_by',
    'watched_by_alert_rule',
    'suppressed_by_maintenance_window',
    'routes_alert_to_destination_group',
    'routes_alert_to_channel',
    'routes_alert_to_on_call_schedule',
    'destination_group_contains_channel',
    'classified_as_energy_role',
    'recorded_history_event',
    'used_by_device_schedule',
    'runs_device_script',
    'triggers_device_webhook',
    'hosts_device_subresource',
    'subresource_refs_component',
    'virtual_group_contains_component',
    'ledstrip_effect_uses_script',
    'has_connector_point',
    'configured_external_connection',
    'external_connection_refs_component',
    'connector_point_maps_to_component',
    'replaced_source',
    'retired_source'
] as const;

export type RelationshipEdgeType =
    (typeof DEVICE_RELATIONSHIP_EDGE_TYPES)[number];

export const DEVICE_RELATIONSHIP_STATUSES = [
    'healthy',
    'warning',
    'critical',
    'unknown',
    'disabled',
    'stale',
    'offline',
    'unavailable'
] as const;

export type RelationshipStatus = (typeof DEVICE_RELATIONSHIP_STATUSES)[number];

export const DEVICE_RELATIONSHIP_SUMMARY_SEVERITIES = [
    'info',
    'warning',
    'critical'
] as const;

export type RelationshipSummarySeverity =
    (typeof DEVICE_RELATIONSHIP_SUMMARY_SEVERITIES)[number];

export type RelationshipNodeId = string;

export interface DeviceRelationshipsGetParams {
    shellyID: string;
    depth?: 1 | 2;
    include?: DeviceRelationshipInclude[];
    direction?: 'both' | 'outgoing' | 'incoming';
}

export interface DeviceRelationshipsQueryParams {
    shellyIDs?: string[];
    depth?: 1 | 2;
    include?: DeviceRelationshipInclude[];
    direction?: 'both' | 'outgoing' | 'incoming';
    limit?: number;
    cursor?: string;
}

export interface RelationshipNodeDto {
    id: RelationshipNodeId;
    type: RelationshipNodeType;
    label: string;
    status?: RelationshipStatus;
    externalId?: string;
    kind?: string;
    icon?: string;
    imageAssetId?: string | null;
    meta?: Record<string, unknown>;
}

export interface RelationshipEdgeDto {
    id: string;
    type: RelationshipEdgeType;
    source: RelationshipNodeId;
    target: RelationshipNodeId;
    label?: string;
    status?: RelationshipStatus;
    direction: 'outgoing' | 'incoming';
    meta?: Record<string, unknown>;
}

export interface RelationshipSummaryDto {
    severity: RelationshipSummarySeverity;
    text: string;
    nodeIds?: RelationshipNodeId[];
    edgeIds?: string[];
    reasonCode?: string;
}

export interface DeviceRelationshipsResponse {
    center: RelationshipNodeId;
    nodes: RelationshipNodeDto[];
    edges: RelationshipEdgeDto[];
    summaries: RelationshipSummaryDto[];
    generatedAt: string;
    depth: 1 | 2;
    truncated: boolean;
}

export interface DeviceRelationshipsQueryResponse {
    items: DeviceRelationshipsResponse[];
    nextCursor?: string;
    generatedAt: string;
    truncated: boolean;
}

export const DEVICE_RELATIONSHIPS_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        depth: {type: 'integer', enum: [1, 2], default: 1},
        include: {
            type: 'array',
            items: {type: 'string', enum: DEVICE_RELATIONSHIP_INCLUDES},
            maxItems: DEVICE_RELATIONSHIP_INCLUDES.length
        },
        direction: {
            type: 'string',
            enum: ['both', 'outgoing', 'incoming'],
            default: 'both'
        }
    }
};

export const DEVICE_RELATIONSHIPS_QUERY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        shellyIDs: {
            type: 'array',
            items: SHELLY_ID_SCHEMA,
            uniqueItems: true
        },
        depth: {type: 'integer', enum: [1, 2], default: 1},
        include: {
            type: 'array',
            items: {type: 'string', enum: DEVICE_RELATIONSHIP_INCLUDES},
            maxItems: DEVICE_RELATIONSHIP_INCLUDES.length
        },
        direction: {
            type: 'string',
            enum: ['both', 'outgoing', 'incoming'],
            default: 'both'
        },
        limit: {type: 'integer', minimum: 1},
        cursor: {type: 'string', pattern: '^[0-9]+$'}
    }
};

const PERM_NONE = {note: 'no permissions (admin only via audit)'};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_EXECUTE = {component: 'devices', operation: 'execute' as const};
const PERM_DELETE = {component: 'devices', operation: 'delete' as const};

const RELATIONSHIP_NODE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'label'],
    properties: {
        id: {type: 'string'},
        type: {type: 'string', enum: DEVICE_RELATIONSHIP_NODE_TYPES},
        label: {type: 'string'},
        status: {type: 'string', enum: DEVICE_RELATIONSHIP_STATUSES},
        externalId: {type: 'string'},
        kind: {type: 'string'},
        icon: {type: 'string'},
        imageAssetId: {anyOf: [{type: 'string'}, {type: 'null'}]},
        meta: {type: 'object', additionalProperties: true}
    }
};

const RELATIONSHIP_EDGE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'source', 'target', 'direction'],
    properties: {
        id: {type: 'string'},
        type: {type: 'string', enum: DEVICE_RELATIONSHIP_EDGE_TYPES},
        source: {type: 'string'},
        target: {type: 'string'},
        label: {type: 'string'},
        status: {type: 'string', enum: DEVICE_RELATIONSHIP_STATUSES},
        direction: {type: 'string', enum: ['outgoing', 'incoming']},
        meta: {type: 'object', additionalProperties: true}
    }
};

const RELATIONSHIP_SUMMARY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'text'],
    properties: {
        severity: {
            type: 'string',
            enum: DEVICE_RELATIONSHIP_SUMMARY_SEVERITIES
        },
        text: {type: 'string'},
        nodeIds: {type: 'array', items: {type: 'string'}},
        edgeIds: {type: 'array', items: {type: 'string'}},
        reasonCode: {type: 'string'}
    }
};

const DEVICE_RELATIONSHIPS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'center',
        'nodes',
        'edges',
        'summaries',
        'generatedAt',
        'depth',
        'truncated'
    ],
    properties: {
        center: {type: 'string'},
        nodes: {type: 'array', items: RELATIONSHIP_NODE_SCHEMA},
        edges: {type: 'array', items: RELATIONSHIP_EDGE_SCHEMA},
        summaries: {type: 'array', items: RELATIONSHIP_SUMMARY_SCHEMA},
        generatedAt: {type: 'string', format: 'date-time'},
        depth: {type: 'integer', enum: [1, 2]},
        truncated: {type: 'boolean'}
    }
};

const DEVICE_RELATIONSHIPS_QUERY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'generatedAt', 'truncated'],
    properties: {
        items: {
            type: 'array',
            items: DEVICE_RELATIONSHIPS_RESPONSE_SCHEMA
        },
        nextCursor: {type: 'string'},
        generatedAt: {type: 'string', format: 'date-time'},
        truncated: {type: 'boolean'}
    }
};

const b = new DescribeBuilder('device', {
    kind: 'fleet-manager',
    description:
        'List, inspect, and manage fleet devices, their assets, images, and status history.'
});

// ── Inventory / identity / generic ───────────────────────────────────

b.registerMethod('List', {
    params: DEVICE_LIST_PARAMS_SCHEMA,
    response: RESP_LIST_ENVELOPE,
    permission: PERM_NONE,
    description:
        'Paginated slim device list (capability-filtered per user), ordered by device row id. Page with `cursor`; `shellyIDs` reads up to 100 named devices in one call.',
    safety: {operation: 'read'}
});

b.registerMethod('GetInfo', {
    params: DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: {
        type: 'object',
        properties: {shellyID: SHELLY_ID_SCHEMA},
        additionalProperties: true,
        description:
            'Device info object, or {} when no live device is found. ' +
            'NOTE: GetInfo intentionally omits `groupIds`, `locationId`, and ' +
            '`tagIds` for lightness — use `Device.Get` or `Device.List` if ' +
            'membership is needed.'
    },
    permission: {
        component: 'devices',
        operation: 'read',
        note: 'device identity is always `shellyID`'
    },
    description: 'Device metadata only — no status/settings/memberships.'
});

b.registerMethod('GetSetup', {
    params: DEVICE_GET_SETUP_PARAMS_SCHEMA,
    response: RESP_SETUP_PROFILES,
    permission: {
        component: 'configurations',
        operation: 'read',
        note: 'filtered by configuration_keys; independent of device admission'
    },
    description: 'Device configuration profiles.'
});

b.registerMethod('Call', {
    safety: {effectDependsOnInput: true},
    params: DEVICE_CALL_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description:
        'Raw device RPC escape hatch for advanced/admin integrations. Prefer semantic Fleet Manager APIs for product flows.'
});

b.registerMethod('CallMany', {
    safety: {effectDependsOnInput: true},
    params: DEVICE_CALL_MANY_PARAMS_SCHEMA,
    response: RESP_CALL_MANY,
    permission: PERM_EXECUTE,
    description:
        'Run one device RPC across several devices as a SINGLE action, so an operator approves one prompt naming every device rather than one prompt each. Permission is still checked per device; this batches the decision, never the checks.'
});

b.registerMethod('Get', {
    params: DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_DEVICE_FULL,
    permission: {
        component: 'devices',
        operation: 'read',
        note: 'device identity is always `shellyID`'
    },
    description: 'Full device object by shellyID.'
});

b.registerMethod('Delete', {
    params: DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['deleted'],
        properties: {deleted: {type: 'string'}}
    },
    permission: PERM_DELETE,
    description:
        'Permanently purge a device and all its history. Irreversible — the everyday delete should use Retire.'
});

b.registerMethod('Retire', {
    params: DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['retired'],
        properties: {retired: {type: 'string'}}
    },
    permission: PERM_DELETE,
    description:
        'Retire (soft-delete) a device: hide it from fleet lists but keep its id and history. Reversible via Restore.'
});

b.registerMethod('Restore', {
    params: DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['restored'],
        properties: {restored: {type: 'string'}}
    },
    permission: PERM_DELETE,
    // Reversible: destroys nothing, idempotent.
    safety: {destructive: false, idempotent: true},
    description: 'Restore a retired device with its full history.'
});

b.registerMethod('ListRetired', {
    params: DEVICE_NO_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['devices'],
        properties: {
            devices: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: {type: 'integer'},
                        external_id: {type: 'string'},
                        organization_id: {type: 'string'},
                        kind: {type: ['string', 'null']},
                        deleted_at: {type: 'string'}
                    }
                }
            }
        }
    },
    permission: PERM_READ,
    description:
        'List retired devices (the trash) available to restore or purge.',
    safety: {operation: 'read'}
});

const DEVICE_KIND_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'kind'],
    additionalProperties: false,
    properties: {
        shellyID: {type: 'string'},
        kind: {type: ['string', 'null']},
        costCenter: {type: ['string', 'null']}
    },
    description: 'Device catalog kind (catalog id) or null when unclassified.'
};

const DEVICE_REPLACEMENT_POINT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    required: ['channel', 'phase', 'tag'],
    properties: {
        channel: {type: 'integer'},
        phase: {type: 'string', enum: ['a', 'b', 'c', 'z']},
        tag: {type: 'string'},
        electricalDomain: {
            anyOf: [{type: 'string'}, {type: 'null'}]
        },
        logicalMeterId: {type: 'integer'},
        logicalMeterName: {type: 'string'},
        utilityType: {type: 'string'},
        role: {type: 'string'},
        source: {type: 'string', enum: ['history', 'live']},
        componentKey: {
            anyOf: [{type: 'string'}, {type: 'null'}]
        }
    }
};

const DEVICE_REPLACEMENT_BINDING_REQUIREMENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'bindingId',
        'virtualDeviceListId',
        'roleKey',
        'componentKey',
        'componentType',
        'valueType',
        'unit',
        'series',
        'valuePath',
        'field',
        'sensorSource',
        'commodity',
        'electricalSource',
        'transform',
        'objectId'
    ],
    properties: {
        bindingId: {type: 'string'},
        virtualDeviceListId: {type: 'integer'},
        roleKey: {type: 'string'},
        componentKey: {type: 'string'},
        componentType: {type: 'string'},
        valueType: {type: ['string', 'null']},
        unit: {type: ['string', 'null']},
        series: {
            type: 'string',
            enum: ['status', 'sensor_numeric', 'sensor_event', 'energy']
        },
        valuePath: {type: 'string'},
        field: {type: 'string'},
        sensorSource: {type: ['string', 'null']},
        commodity: {type: ['string', 'null']},
        electricalSource: {type: ['string', 'null']},
        transform: {type: 'object', additionalProperties: true},
        objectId: {type: ['integer', 'null']}
    }
};

const DEVICE_CHECK_REPLACEMENT_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'oldShellyID',
        'newShellyID',
        'oldDeviceId',
        'newDeviceId',
        'compatibility',
        'requirements',
        'available',
        'missing',
        'remapCandidates',
        'bindingRequirements',
        'missingBindings',
        'bindingRemapCandidates',
        'warnings'
    ],
    properties: {
        oldShellyID: SHELLY_ID_SCHEMA,
        newShellyID: SHELLY_ID_SCHEMA,
        oldDeviceId: {type: 'integer'},
        newDeviceId: {type: 'integer'},
        compatibility: {
            type: 'string',
            enum: ['exact_match', 'compatible_mapping', 'incompatible']
        },
        requirements: {
            type: 'array',
            items: DEVICE_REPLACEMENT_POINT_SCHEMA
        },
        available: {
            type: 'array',
            items: DEVICE_REPLACEMENT_POINT_SCHEMA
        },
        missing: {
            type: 'array',
            items: DEVICE_REPLACEMENT_POINT_SCHEMA
        },
        remapCandidates: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['required', 'candidates'],
                properties: {
                    required: DEVICE_REPLACEMENT_POINT_SCHEMA,
                    candidates: {
                        type: 'array',
                        items: DEVICE_REPLACEMENT_POINT_SCHEMA
                    }
                }
            }
        },
        bindingRequirements: {
            type: 'array',
            items: DEVICE_REPLACEMENT_BINDING_REQUIREMENT_SCHEMA
        },
        missingBindings: {
            type: 'array',
            items: DEVICE_REPLACEMENT_BINDING_REQUIREMENT_SCHEMA
        },
        bindingRemapCandidates: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['required', 'candidates'],
                properties: {
                    required: DEVICE_REPLACEMENT_BINDING_REQUIREMENT_SCHEMA,
                    candidates: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: [
                                'componentKey',
                                'componentType',
                                'valueType',
                                'unit',
                                'objectId',
                                'sourceSnapshot'
                            ],
                            properties: {
                                componentKey: {type: 'string'},
                                componentType: {type: 'string'},
                                valueType: {type: ['string', 'null']},
                                unit: {type: ['string', 'null']},
                                objectId: {type: ['integer', 'null']},
                                sourceSnapshot: {
                                    type: 'object',
                                    additionalProperties: true
                                }
                            }
                        }
                    }
                }
            }
        },
        warnings: {type: 'array', items: {type: 'string'}}
    }
};

const DEVICE_REPLACE_HARDWARE_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deviceId', 'oldShellyID', 'newShellyID', 'auditId'],
    properties: {
        deviceId: {type: 'integer'},
        oldShellyID: SHELLY_ID_SCHEMA,
        newShellyID: SHELLY_ID_SCHEMA,
        auditId: {type: 'integer'}
    }
};

b.registerMethod('CheckReplacement', {
    params: DEVICE_CHECK_REPLACEMENT_PARAMS_SCHEMA,
    response: DEVICE_CHECK_REPLACEMENT_RESPONSE,
    permission: PERM_READ,
    description:
        'Check whether a newly admitted Shelly can replace an existing Fleet device without breaking logical-meter point usage.'
});

b.registerMethod('ReplaceHardware', {
    params: DEVICE_REPLACE_HARDWARE_PARAMS_SCHEMA,
    response: DEVICE_REPLACE_HARDWARE_RESPONSE,
    permission: {
        component: 'devices',
        operation: 'update',
        note: 'server re-runs CheckReplacement; exact matches apply directly, compatible matches require a validated confirmedMapping'
    },
    description:
        'Atomically keep the old Fleet device id but swap it to the new physical Shelly external id, with an audit row.'
});

b.registerMethod('GetKind', {
    params: DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: DEVICE_KIND_RESPONSE,
    permission: PERM_READ,
    description:
        'Get the catalog kind classification for a device (null = unclassified).'
});

export interface DeviceSetJournalDebugParams {
    shellyID: string;
    minutes: number;
}

export const DEVICE_SET_JOURNAL_DEBUG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'minutes'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        minutes: {
            type: 'integer',
            minimum: 0,
            maximum: 240,
            description:
                'How long every frame of the device is journaled. 0 turns it off.'
        }
    }
};

const DEVICE_SET_JOURNAL_DEBUG_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'until'],
    additionalProperties: false,
    properties: {
        shellyID: {type: 'string'},
        until: {
            type: ['string', 'null'],
            format: 'date-time',
            description: 'When debug ends by itself; null when it is off.'
        }
    }
};

b.registerMethod('SetJournalDebug', {
    params: DEVICE_SET_JOURNAL_DEBUG_PARAMS_SCHEMA,
    response: DEVICE_SET_JOURNAL_DEBUG_RESPONSE,
    permission: {component: 'devices', operation: 'update' as const},
    description:
        'Journal every frame of one device for a set time (the event journal keeps only real events by default). At most 20 devices per tenant.'
});

export interface DeviceSetEmLiveDebugParams {
    shellyID: string;
    enabled: boolean;
}

export const DEVICE_SET_EM_LIVE_DEBUG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'enabled'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        enabled: {
            type: 'boolean',
            description:
                'true starts (or extends) the capture; false stops it and deletes what it captured.'
        }
    }
};

export interface DeviceSetEmLiveDebugResult {
    shellyID: string;
    until: string | null;
}

const DEVICE_SET_EM_LIVE_DEBUG_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'until'],
    additionalProperties: false,
    properties: {
        shellyID: {type: 'string'},
        until: {
            type: ['string', 'null'],
            format: 'date-time',
            description:
                'When the capture stops and its values are deleted; null when it is off.'
        }
    }
};

b.registerMethod('SetEmLiveDebug', {
    params: DEVICE_SET_EM_LIVE_DEBUG_PARAMS_SCHEMA,
    response: DEVICE_SET_EM_LIVE_DEBUG_RESPONSE,
    permission: {component: 'devices', operation: 'update' as const},
    description:
        'Capture the live em/em1 status values of one meter for FM_EM_LIVE_DEBUG_HOURS (default 4, at most 24), for debugging. The values go to a separate table that billing, reports and the energy rollup never read, and are deleted when the capture ends. Off by default. At most 20 devices per tenant.'
});

export const EM_LIVE_DEBUG_PAGE_MAX = 5000;

export interface DeviceGetEmLiveDebugParams {
    shellyID: string;
    after?: number;
    limit?: number;
}

export const DEVICE_GET_EM_LIVE_DEBUG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        after: {
            type: 'integer',
            minimum: 0,
            description:
                'Return frames after this id (the last id of the previous page).'
        },
        limit: {
            type: 'integer',
            minimum: 1,
            maximum: EM_LIVE_DEBUG_PAGE_MAX,
            description: 'Frames per page. Default 1000.'
        }
    }
};

export interface DeviceEmLiveDebugFrame {
    id: number;
    ts: string;
    component: string;
    field: string;
    value: number;
}

export interface DeviceGetEmLiveDebugResult {
    shellyID: string;
    until: string | null;
    frames: DeviceEmLiveDebugFrame[];
    hasMore: boolean;
}

const DEVICE_GET_EM_LIVE_DEBUG_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'until', 'frames', 'hasMore'],
    additionalProperties: false,
    properties: {
        shellyID: {type: 'string'},
        until: {type: ['string', 'null'], format: 'date-time'},
        frames: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'ts', 'component', 'field', 'value'],
                additionalProperties: false,
                properties: {
                    id: {type: 'integer'},
                    ts: {type: 'string', format: 'date-time'},
                    component: {type: 'string'},
                    field: {type: 'string'},
                    value: {type: 'number'}
                }
            }
        },
        hasMore: {type: 'boolean'}
    }
};

b.registerMethod('GetEmLiveDebug', {
    params: DEVICE_GET_EM_LIVE_DEBUG_PARAMS_SCHEMA,
    response: DEVICE_GET_EM_LIVE_DEBUG_RESPONSE,
    permission: PERM_READ,
    description:
        'Read the live em/em1 values captured by Device.SetEmLiveDebug, oldest first, one page at a time. Empty once the capture ended.'
});

b.registerMethod('SetKind', {
    params: DEVICE_KIND_SET_PARAMS_SCHEMA,
    response: DEVICE_KIND_RESPONSE,
    permission: {component: 'devices', operation: 'update' as const},
    description: 'Set the device catalog kind. Pass kind=null to clear it.'
});

// ── Image override (per-physical-device asset reference) ─────────────

// Decoration field (icon/accent), for devices with no stock photo.
const DECORATION_FIELD_SCHEMA: JsonSchema = {
    anyOf: [{type: 'string', minLength: 1, maxLength: 80}, {type: 'null'}]
};

export interface DeviceSetImageParams {
    shellyID: string;
    imageAssetId: string | null;
    icon?: string | null;
    accent?: string | null;
}

export const DEVICE_SET_IMAGE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'imageAssetId'],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        imageAssetId: {
            anyOf: [{type: 'string', format: 'uuid'}, {type: 'null'}]
        },
        icon: DECORATION_FIELD_SCHEMA,
        accent: DECORATION_FIELD_SCHEMA
    }
};

export interface DeviceSetImageResult {
    shellyID: string;
    imageAssetId: string | null;
    icon: string | null;
    accent: string | null;
}

const DEVICE_SET_IMAGE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'imageAssetId', 'icon', 'accent'],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        imageAssetId: {
            anyOf: [
                {
                    type: 'string',
                    pattern:
                        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                },
                {type: 'null'}
            ]
        },
        icon: DECORATION_FIELD_SCHEMA,
        accent: DECORATION_FIELD_SCHEMA
    }
};

b.registerMethod('SetImage', {
    params: DEVICE_SET_IMAGE_PARAMS_SCHEMA,
    response: DEVICE_SET_IMAGE_RESPONSE,
    permission: {component: 'devices', operation: 'update' as const},
    description:
        'Override the stock product image with a library asset (UUID). ' +
        'Pass imageAssetId=null to clear the override.'
});

b.registerMethod('GetImage', {
    params: DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: DEVICE_SET_IMAGE_RESPONSE,
    permission: PERM_READ,
    description:
        'Read the per-physical-device image override. Returns imageAssetId=null when no override is set.'
});

// ── History / energy reads ───────────────────────────────────────────

b.registerMethod('GetDeviceChannels', {
    params: DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: RESP_DEVICE_CHANNELS,
    permission: PERM_READ,
    description: 'Device EM channel inventory.'
});

b.registerMethod('GetStatusTimeline', {
    params: DEVICE_GET_STATUS_TIMELINE_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['shellyID', 'field', 'data', 'from', 'to'],
        properties: {
            shellyID: SHELLY_ID_SCHEMA,
            field: {type: 'string'},
            from: {type: 'string'},
            to: {type: 'string'},
            data: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        ts: {},
                        value: {type: ['number', 'null']},
                        prevValue: {type: ['number', 'null']}
                    }
                }
            }
        },
        description: 'Per-sample timeline points'
    },
    permission: PERM_READ,
    description: 'Device online/offline timeline over a time range.'
});

b.registerMethod('GetStatusHistory', {
    params: DEVICE_GET_STATUS_HISTORY_PARAMS_SCHEMA,
    response: {
        type: 'object',
        required: ['shellyID', 'field', 'data', 'from', 'to'],
        properties: {
            shellyID: SHELLY_ID_SCHEMA,
            field: {type: 'string'},
            from: {type: 'string'},
            to: {type: 'string'},
            data: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        bucket: {type: 'string'},
                        avgVal: {type: ['number', 'null']},
                        minVal: {type: ['number', 'null']},
                        maxVal: {type: ['number', 'null']}
                    }
                }
            }
        },
        description: 'Hourly-bucketed history rows'
    },
    permission: PERM_READ,
    description: 'Device status chart time-series.'
});

// Device topology graph: BT-mesh parent→child + cross-device
// thermostat→switch actuator bindings. Cytoscape-shaped {nodes, edges}
// for the visualization layer. Scope params are mutually-AND'd; an
// unscoped call returns the entire accessible fleet.

export interface DeviceTopologyParams {
    groupId?: number;
    locationId?: number;
    shellyID?: string;
}

const DEVICE_TOPOLOGY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        groupId: {type: 'integer', minimum: 1},
        locationId: {type: 'integer', minimum: 1},
        shellyID: SHELLY_ID_SCHEMA
    }
};

const TOPOLOGY_NODE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'type'],
    properties: {
        id: {type: 'string'},
        label: {type: 'string'},
        type: {type: 'string', enum: ['hub', 'device', 'group']},
        status: {type: 'string', enum: ['on', 'off', 'warn']}
    }
};

const TOPOLOGY_EDGE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'target'],
    properties: {
        source: {type: 'string'},
        target: {type: 'string'},
        weight: {type: 'number'}
    }
};

const DEVICE_TOPOLOGY_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['nodes', 'edges'],
    properties: {
        nodes: {type: 'array', items: TOPOLOGY_NODE_SCHEMA},
        edges: {type: 'array', items: TOPOLOGY_EDGE_SCHEMA}
    }
};

b.registerMethod('Topology', {
    params: DEVICE_TOPOLOGY_PARAMS_SCHEMA,
    response: DEVICE_TOPOLOGY_RESPONSE,
    permission: PERM_READ,
    description:
        'Cytoscape-shaped {nodes, edges} for visualization. Edges come from BT-mesh bthomedevice parent→children and cross-device thermostat→switch actuator bindings (intra-device shelly://self/... is omitted). Nodes carry type ("hub"=paired host, "device"=plain host or BLE peer) + status ("on"|"off"|"warn"; BLE peers default to "warn" since liveness is not known). Scope via groupId / locationId / shellyID; unscoped returns the full accessible fleet. Group containment is computed client-side from group memberships, not emitted here.'
});

b.registerMethod('Relationships.Get', {
    params: DEVICE_RELATIONSHIPS_GET_PARAMS_SCHEMA,
    response: DEVICE_RELATIONSHIPS_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'Read a backend-owned relationship graph for one center device. Current implementation supports bounded depth=1 or depth=2 traversal and direction filtering.'
});

b.registerMethod('Relationships.Query', {
    params: DEVICE_RELATIONSHIPS_QUERY_PARAMS_SCHEMA,
    response: DEVICE_RELATIONSHIPS_QUERY_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'Read a paged, backend-owned relationship graph set for accessible devices. Results are derived from device.Relationships.Get; no materialized relationship table is used.'
});

export {DEVICE_TOPOLOGY_PARAMS_SCHEMA};

b.setTags(['inventory']);

export const DEVICE_DESCRIBE: DescribeOutput = b.build();
