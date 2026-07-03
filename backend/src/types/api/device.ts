// `Device.*` Describe — FM-domain methods only.
// Lifecycle (Reboot/FactoryReset/Update/CheckForUpdate/SetProfile/ListProfiles)
// and identity passthroughs live in `shelly` ns. Network/connectivity
// passthroughs (Cloud/BLE/Wifi/Eth/Modbus) live in their own per-namespace
// components (cloud, ble, wifi, eth, modbus) per the 1:1 Shelly-mirror rule.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';
import {DEVICE_KIND_SET_PARAMS_SCHEMA} from './deviceKind';

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
        has_more: {type: 'boolean'}
    },
    description: 'Fleet Manager list envelope'
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
    include?: string[];
}
export const DEVICE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
        filters: {type: 'object', additionalProperties: true},
        limit: {
            type: 'integer',
            minimum: 0,
            description: '0 = unlimited, default 500'
        },
        offset: {type: 'integer', minimum: 0},
        include: {type: 'array', items: {type: 'string'}}
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
    shellyID: string;
    mode?: 'json' | 'rpc';
}
export const DEVICE_GET_SETUP_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
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
    description: 'Paginated slim device list (capability-filtered per user).'
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
    response: {
        type: 'object',
        description: 'Config profiles keyed by profile name'
    },
    permission: {
        component: 'devices',
        operation: 'read',
        note: 'also requires configurations.read'
    },
    description: 'Device configuration profiles.'
});

b.registerMethod('Call', {
    params: DEVICE_CALL_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_EXECUTE,
    description:
        'Raw device RPC escape hatch for advanced/admin integrations. Prefer semantic Fleet Manager APIs for product flows.'
});

b.registerMethod('Get', {
    params: DEVICE_SHELLY_ONLY_PARAMS_SCHEMA,
    response: {
        type: 'object',
        description: 'Full device JSON (info + status + settings)'
    },
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
    description: 'Remove device from fleet.'
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
    response: {
        type: 'object',
        description: 'Per-device EM channel layout'
    },
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
