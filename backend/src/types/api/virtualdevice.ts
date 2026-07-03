import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {METADATA_SCHEMA, NAME_SCHEMA, ORG_ID_SCHEMA} from './_shared';
import {
    VISUAL_DECORATION_SCHEMA,
    type VisualDecoration
} from './_visualMetadata';

export const DEVICE_KINDS = [
    'physical',
    'bluetooth',
    'extracted',
    'composed',
    'connector'
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const VIRTUAL_DEVICE_KINDS = [
    'extracted',
    'composed',
    'connector'
] as const;
export type VirtualDeviceKind = (typeof VIRTUAL_DEVICE_KINDS)[number];

export const BLU_TRANSPORT_MODES = [
    'bthome_gateway',
    'blu_assistant_ws',
    'blu_assistant_serial',
    'host_bluetooth'
] as const;
export type BluTransportMode = (typeof BLU_TRANSPORT_MODES)[number];

export const BLU_CAPABILITIES = [
    'telemetry_only',
    'event_only',
    'controllable',
    'unknown'
] as const;
export type BluCapability = (typeof BLU_CAPABILITIES)[number];

export const SHELLY_DYNAMIC_COMPONENT_TREE = {
    Virtual: ['Boolean', 'Button', 'Enum', 'Group', 'Number', 'Text'],
    BTHome: ['BTHomeControl', 'BTHomeDevice', 'BTHomeSensor'],
    LNM: []
} as const;

export const VIRTUAL_DEVICE_METHODS = [
    'Create',
    'Get',
    'List',
    'Update',
    'Delete',
    'Extraction.Preview',
    'Extraction.Create',
    'Extraction.ReplacementPreview',
    'Profile.List',
    'Profile.Create',
    'Profile.Update',
    'Profile.Validate',
    'Profile.MatchSources',
    'Profile.SuggestFromDevice',
    'Binding.List',
    'Binding.ListSources',
    'Binding.ValidateDraft',
    'Draft.Preview',
    'Binding.Create',
    'Binding.Replace',
    'Binding.Retire',
    'Command.Invoke',
    'History.ReadRole',
    'History.ReadProvenance',
    'History.Backfill',
    'Binding.ReplacementReport',
    'Manifest.Validate',
    'Manifest.Export',
    'Manifest.Plan',
    'Manifest.Apply',
    'Bluetooth.Candidate.List',
    'Bluetooth.PromoteFromGateway',
    'Bluetooth.List',
    'Bluetooth.Get',
    'Bluetooth.Delete',
    'Bluetooth.Transport.List',
    'Bluetooth.Transport.SetPrimary',
    'Bluetooth.Key.SetRef',
    'Bluetooth.Key.Clear',
    'Image.CreateUploadTicket',
    'Bluetooth.Update',
    'Bluetooth.Image.CreateUploadTicket'
] as const;
export type VirtualDeviceMethod = (typeof VIRTUAL_DEVICE_METHODS)[number];

const PERM_CREATE = {component: 'devices', operation: 'create' as const};
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const PERM_DELETE = {component: 'devices', operation: 'delete' as const};

const _EMPTY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

const _EMPTY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

const EXTERNAL_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 50,
    pattern: '^(?:vdev|blu)_[A-Za-z0-9_-]+$'
};

const DEVICE_LIST_ID_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 1
};

const INT_ID_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 1
};

const INT_ID_ARRAY_SCHEMA: JsonSchema = {
    type: 'array',
    items: INT_ID_SCHEMA,
    uniqueItems: true,
    maxItems: 500
};

const ROLE_KEY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    pattern: '^[a-z][a-z0-9_]*$'
};

const TYPE_KEY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    pattern: '^[a-z][a-z0-9_]*$'
};

const CATEGORY_KEY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    pattern: '^[a-z][a-z0-9_]*$'
};

// Typed profile metadata. Strict — typos are rejected at the boundary.
// Keep in sync with VirtualDeviceProfileMetadata below; this schema is the SoT.
// defaultVisual is the icon/accent template applied to new virtual devices
// created from this profile when the caller doesn't pass its own `visual`.
export const PROFILE_METADATA_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    maxProperties: 16,
    properties: {
        categoryKey: CATEGORY_KEY_SCHEMA,
        defaultVisual: VISUAL_DECORATION_SCHEMA
    }
};

const PROFILE_KEY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    pattern: '^[a-z][a-z0-9_]*$'
};

const UUID_SCHEMA: JsonSchema = {
    type: 'string',
    pattern:
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
};

const REVISION_SCHEMA: JsonSchema = {
    type: 'integer',
    minimum: 1
};

const COMPONENT_KEY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 3,
    maxLength: 80,
    pattern: '^[a-z][a-z0-9_]*:\\d+$'
};

const DYNAMIC_CATEGORY_SCHEMA: JsonSchema = {
    type: 'string',
    enum: Object.keys(SHELLY_DYNAMIC_COMPONENT_TREE)
};

const _DEVICE_KIND_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...DEVICE_KINDS]
};

const VIRTUAL_DEVICE_KIND_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...VIRTUAL_DEVICE_KINDS]
};

const BLU_TRANSPORT_MODE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...BLU_TRANSPORT_MODES]
};

const BLU_CAPABILITY_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...BLU_CAPABILITIES]
};

const ROLE_VALUE_TYPE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: ['boolean', 'number', 'string', 'event', 'json']
};

const HISTORY_MODE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: ['linked', 'materialized', 'derived', 'live_only']
};

const VIRTUAL_DEVICE_VISUAL_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        // Inherited from VISUAL_DECORATION_SCHEMA (shared with groups).
        ...(VISUAL_DECORATION_SCHEMA.properties as Record<string, JsonSchema>),
        cardProfile: {
            type: 'string',
            enum: ['meter', 'climate', 'safety', 'actuator', 'custom']
        },
        summaryRoles: {
            type: 'array',
            items: ROLE_KEY_SCHEMA,
            uniqueItems: true,
            maxItems: 24
        },
        detailSections: {
            type: 'array',
            items: {type: 'string', minLength: 1, maxLength: 80},
            uniqueItems: true,
            maxItems: 24
        }
    }
};

const VIRTUAL_ROLE_VISUAL_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        displayName: NAME_SCHEMA,
        icon: {type: 'string', minLength: 1, maxLength: 80},
        slot: {
            type: 'string',
            enum: ['primary', 'secondary', 'control', 'diagnostic', 'hidden']
        },
        chart: {
            type: 'string',
            enum: ['line', 'area', 'bar', 'step', 'state', 'none']
        },
        format: METADATA_SCHEMA,
        alertDefaults: METADATA_SCHEMA
    }
};

const PROFILE_ROLE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['roleKey', 'label', 'valueType', 'historyMode'],
    properties: {
        roleKey: ROLE_KEY_SCHEMA,
        label: NAME_SCHEMA,
        valueType: ROLE_VALUE_TYPE_SCHEMA,
        unit: {type: 'string', minLength: 1, maxLength: 32},
        writable: {type: 'boolean'},
        required: {type: 'boolean'},
        historyMode: HISTORY_MODE_SCHEMA,
        visual: VIRTUAL_ROLE_VISUAL_SCHEMA,
        metadata: METADATA_SCHEMA
    }
};

const PROFILE_ROLES_SCHEMA: JsonSchema = {
    type: 'array',
    minItems: 1,
    items: PROFILE_ROLE_SCHEMA
};

export const VIRTUAL_DEVICE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        query: {type: 'string', minLength: 1, maxLength: 120},
        kind: VIRTUAL_DEVICE_KIND_SCHEMA,
        typeKey: TYPE_KEY_SCHEMA,
        categoryKey: CATEGORY_KEY_SCHEMA,
        limit: {type: 'integer', minimum: 0, maximum: 1000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0},
        sortBy: {
            type: 'string',
            enum: ['name', 'kind', 'typeKey', 'categoryKey', 'createdAt']
        },
        sortDir: {type: 'string', enum: ['asc', 'desc']}
    }
};

const SOURCE_COMPONENT_REF_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deviceExternalId', 'componentKey'],
    properties: {
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 120},
        componentKey: COMPONENT_KEY_SCHEMA,
        dynamicCategory: DYNAMIC_CATEGORY_SCHEMA
    }
};

const SOURCE_COMPONENT_CANDIDATE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'deviceExternalId',
        'deviceName',
        'componentKey',
        'componentType',
        'dynamicCategory',
        'writable'
    ],
    properties: {
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 120},
        deviceName: NAME_SCHEMA,
        componentKey: COMPONENT_KEY_SCHEMA,
        componentType: {type: 'string', minLength: 1, maxLength: 80},
        dynamicCategory: {anyOf: [DYNAMIC_CATEGORY_SCHEMA, {type: 'null'}]},
        label: {type: ['string', 'null'], maxLength: 120},
        valueType: ROLE_VALUE_TYPE_SCHEMA,
        writable: {type: 'boolean'},
        connector: {
            type: 'object',
            additionalProperties: false,
            required: ['protocol', 'pointId'],
            properties: {
                protocol: {type: 'string', minLength: 1, maxLength: 80},
                pointId: {type: ['string', 'null'], maxLength: 160}
            }
        }
    }
};

const BINDING_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'roleKey', 'source', 'mode', 'active', 'createdAt'],
    properties: {
        id: UUID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        source: SOURCE_COMPONENT_REF_SCHEMA,
        mode: HISTORY_MODE_SCHEMA,
        active: {type: 'boolean'},
        effectiveFrom: {type: ['string', 'null']},
        effectiveTo: {type: ['string', 'null']},
        visual: VIRTUAL_ROLE_VISUAL_SCHEMA,
        createdAt: {type: 'string'}
    }
};

const EXTRACTION_SOURCE_TYPE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: ['virtual_group', 'service']
};

const EXTRACTION_ROLE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['roleKey', 'label', 'componentKey', 'componentType'],
    properties: {
        roleKey: ROLE_KEY_SCHEMA,
        label: NAME_SCHEMA,
        componentKey: COMPONENT_KEY_SCHEMA,
        componentType: {type: 'string', minLength: 1, maxLength: 80},
        writable: {type: 'boolean'},
        valueType: ROLE_VALUE_TYPE_SCHEMA,
        dynamicCategory: DYNAMIC_CATEGORY_SCHEMA
    }
};

const EXTRACTION_MEMBER_SNAPSHOT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'roleKey',
        'componentKey',
        'componentType',
        'valueType',
        'writable',
        'required',
        'unit',
        'label'
    ],
    properties: {
        roleKey: {type: 'string', minLength: 1, maxLength: 80},
        componentKey: COMPONENT_KEY_SCHEMA,
        componentType: {type: 'string', minLength: 1, maxLength: 80},
        valueType: ROLE_VALUE_TYPE_SCHEMA,
        writable: {type: 'boolean'},
        required: {type: 'boolean'},
        unit: {type: ['string', 'null'], maxLength: 40},
        label: {type: ['string', 'null'], maxLength: 200}
    }
};

const EXTRACTION_SNAPSHOT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'hostExternalId',
        'hostDeviceListId',
        'sourceKey',
        'sourceType',
        'members',
        'capturedAt'
    ],
    properties: {
        hostExternalId: {type: 'string', minLength: 1, maxLength: 120},
        hostDeviceListId: DEVICE_LIST_ID_SCHEMA,
        sourceKey: COMPONENT_KEY_SCHEMA,
        sourceType: EXTRACTION_SOURCE_TYPE_SCHEMA,
        members: {type: 'array', items: EXTRACTION_MEMBER_SNAPSHOT_SCHEMA},
        capturedAt: {type: 'string', minLength: 1, maxLength: 64}
    }
};

const EXTRACTION_PREVIEW_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'hostDeviceListId',
        'hostExternalId',
        'sourceKey',
        'sourceType',
        'name',
        'typeKey',
        'roles',
        'bindings',
        'hiddenSourceComponentKeys',
        'alreadyExtracted',
        'extractedExternalId',
        'sourceSnapshot'
    ],
    properties: {
        hostDeviceListId: DEVICE_LIST_ID_SCHEMA,
        hostExternalId: {type: 'string', minLength: 1, maxLength: 120},
        sourceKey: COMPONENT_KEY_SCHEMA,
        sourceType: EXTRACTION_SOURCE_TYPE_SCHEMA,
        name: NAME_SCHEMA,
        typeKey: TYPE_KEY_SCHEMA,
        categoryKey: {anyOf: [CATEGORY_KEY_SCHEMA, {type: 'null'}]},
        roles: {type: 'array', items: EXTRACTION_ROLE_SCHEMA},
        bindings: {type: 'array', items: SOURCE_COMPONENT_REF_SCHEMA},
        hiddenSourceComponentKeys: {
            type: 'array',
            items: COMPONENT_KEY_SCHEMA,
            uniqueItems: true
        },
        alreadyExtracted: {type: 'boolean'},
        extractedExternalId: {type: ['string', 'null'], maxLength: 120},
        sourceSnapshot: EXTRACTION_SNAPSHOT_SCHEMA
    }
};

export const VIRTUAL_DEVICE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'deviceListId',
        'externalId',
        'organizationId',
        'kind',
        'name',
        'typeKey',
        'locationId',
        'groupIds',
        'tagIds',
        'enabled',
        'revision'
    ],
    properties: {
        deviceListId: DEVICE_LIST_ID_SCHEMA,
        externalId: EXTERNAL_ID_SCHEMA,
        organizationId: ORG_ID_SCHEMA,
        kind: VIRTUAL_DEVICE_KIND_SCHEMA,
        name: NAME_SCHEMA,
        typeKey: TYPE_KEY_SCHEMA,
        categoryKey: {anyOf: [CATEGORY_KEY_SCHEMA, {type: 'null'}]},
        profileId: {anyOf: [UUID_SCHEMA, {type: 'null'}]},
        imageAssetId: {anyOf: [UUID_SCHEMA, {type: 'null'}]},
        locationId: {type: ['integer', 'null'], minimum: 1},
        groupIds: INT_ID_ARRAY_SCHEMA,
        tagIds: INT_ID_ARRAY_SCHEMA,
        enabled: {type: 'boolean'},
        revision: REVISION_SCHEMA,
        visual: VIRTUAL_DEVICE_VISUAL_SCHEMA,
        metadata: METADATA_SCHEMA
    }
};

const BLU_SOURCE_COMPONENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['componentKey', 'kind', 'role', 'canWrite'],
    properties: {
        componentKey: COMPONENT_KEY_SCHEMA,
        kind: {
            type: 'string',
            enum: ['device', 'sensor', 'control', 'trv']
        },
        role: {
            type: 'string',
            enum: ['identity', 'telemetry', 'event_control', 'writable_control']
        },
        objectId: {type: ['integer', 'null'], minimum: 0},
        index: {type: ['integer', 'null'], minimum: 0},
        name: {type: ['string', 'null'], maxLength: 120},
        canWrite: {type: 'boolean'}
    }
};

const BLU_PRIMARY_TRANSPORT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'mode', 'canWrite', 'enabled'],
    properties: {
        id: UUID_SCHEMA,
        mode: BLU_TRANSPORT_MODE_SCHEMA,
        canWrite: {type: 'boolean'},
        enabled: {type: 'boolean'},
        shellyDeviceExternalId: {type: ['string', 'null'], maxLength: 120},
        assistantDeviceExternalId: {
            type: ['string', 'null'],
            maxLength: 120
        },
        hostAdapterId: {type: ['string', 'null'], maxLength: 120},
        serialPortRef: {type: ['string', 'null'], maxLength: 255},
        lastSeenAt: {type: ['string', 'null']},
        lastRssi: {type: ['integer', 'null']}
    }
};

const BLU_DEVICE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'deviceListId',
        'externalId',
        'stableId',
        'capability',
        'keyRefSet',
        'components',
        'visual'
    ],
    properties: {
        deviceListId: DEVICE_LIST_ID_SCHEMA,
        externalId: EXTERNAL_ID_SCHEMA,
        stableId: {type: 'string', minLength: 1, maxLength: 120},
        bleAddress: {type: ['string', 'null'], maxLength: 32},
        productName: {type: ['string', 'null'], maxLength: 120},
        modelId: {type: ['string', 'null'], maxLength: 120},
        imageAssetId: {anyOf: [UUID_SCHEMA, {type: 'null'}]},
        capability: BLU_CAPABILITY_SCHEMA,
        keyRefSet: {type: 'boolean'},
        components: {type: 'array', items: BLU_SOURCE_COMPONENT_SCHEMA},
        visual: VISUAL_DECORATION_SCHEMA,
        primaryTransport: {
            anyOf: [BLU_PRIMARY_TRANSPORT_SCHEMA, {type: 'null'}]
        }
    }
};

const BLU_TRANSPORT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'mode', 'primary', 'canWrite', 'enabled'],
    properties: {
        id: UUID_SCHEMA,
        mode: BLU_TRANSPORT_MODE_SCHEMA,
        primary: {type: 'boolean'},
        canWrite: {type: 'boolean'},
        enabled: {type: 'boolean'},
        shellyDeviceExternalId: {type: ['string', 'null'], maxLength: 120},
        hostAdapterId: {type: ['string', 'null'], maxLength: 120},
        assistantDeviceExternalId: {type: ['string', 'null'], maxLength: 120},
        serialPortRef: {type: ['string', 'null'], maxLength: 255},
        keyDistributedAt: {type: ['string', 'null']},
        lastSeenAt: {type: ['string', 'null']},
        lastRssi: {type: ['integer', 'null']}
    }
};

const BLU_DEVICE_CANDIDATE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'gatewayDeviceListId',
        'gatewayExternalId',
        'componentKey',
        'stableId',
        'bleAddress',
        'name',
        'productName',
        'modelId',
        'capability',
        'components',
        'alreadyPromoted',
        'bluetoothExternalId'
    ],
    properties: {
        gatewayDeviceListId: DEVICE_LIST_ID_SCHEMA,
        gatewayExternalId: {type: 'string', minLength: 1, maxLength: 120},
        componentKey: COMPONENT_KEY_SCHEMA,
        stableId: {type: 'string', minLength: 1, maxLength: 120},
        bleAddress: {type: 'string', minLength: 1, maxLength: 32},
        name: {type: ['string', 'null'], maxLength: 120},
        productName: {type: ['string', 'null'], maxLength: 120},
        modelId: {type: ['string', 'null'], maxLength: 120},
        capability: BLU_CAPABILITY_SCHEMA,
        components: {type: 'array', items: BLU_SOURCE_COMPONENT_SCHEMA},
        alreadyPromoted: {type: 'boolean'},
        bluetoothExternalId: {type: ['string', 'null'], maxLength: 120}
    }
};

export const BLUETOOTH_DEVICE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        query: {type: 'string', minLength: 1, maxLength: 120},
        capability: BLU_CAPABILITY_SCHEMA,
        limit: {type: 'integer', minimum: 0, maximum: 1000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

export const BLUETOOTH_DEVICE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: BLU_DEVICE_SCHEMA},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 0},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};

export const BLUETOOTH_DEVICE_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId'],
    properties: {externalId: EXTERNAL_ID_SCHEMA}
};

export const BLUETOOTH_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        retention: {type: 'string', enum: ['tombstone', 'purge']},
        unpairFromGateway: {type: 'boolean'},
        ignoreGatewayErrors: {type: 'boolean'}
    }
};

export const VISUAL_ASSET_UPLOAD_TICKET_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['uploadTicket', 'expiresAt'],
    additionalProperties: false,
    properties: {
        uploadTicket: {type: 'string', minLength: 1},
        expiresAt: {type: 'string', format: 'date-time'}
    }
};

export const BLUETOOTH_CANDIDATE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        gatewayExternalId: {type: 'string', minLength: 1, maxLength: 120},
        query: {type: 'string', minLength: 1, maxLength: 120},
        limit: {type: 'integer', minimum: 0, maximum: 1000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

export const BLUETOOTH_CANDIDATE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: BLU_DEVICE_CANDIDATE_SCHEMA},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 0},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};

export const BLUETOOTH_PROMOTE_FROM_GATEWAY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['gatewayExternalId', 'componentKey'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        gatewayExternalId: {type: 'string', minLength: 1, maxLength: 120},
        componentKey: COMPONENT_KEY_SCHEMA,
        makePrimary: {type: 'boolean'}
    }
};

export const BLUETOOTH_TRANSPORT_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId'],
    properties: {externalId: EXTERNAL_ID_SCHEMA}
};

export const BLUETOOTH_TRANSPORT_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {items: {type: 'array', items: BLU_TRANSPORT_SCHEMA}}
};

export const BLUETOOTH_TRANSPORT_SET_PRIMARY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'transportId'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        transportId: UUID_SCHEMA
    }
};

export const BLUETOOTH_KEY_SET_REF_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'keyRef'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        keyRef: {type: 'string', minLength: 1, maxLength: 255},
        reason: {type: 'string', minLength: 1, maxLength: 500}
    }
};

export const BLUETOOTH_KEY_CLEAR_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        reason: {type: 'string', minLength: 1, maxLength: 500}
    }
};

export const BLUETOOTH_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        imageAssetId: {anyOf: [UUID_SCHEMA, {type: 'null'}]},
        visual: VISUAL_DECORATION_SCHEMA
    }
};

export const VIRTUAL_DEVICE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: VIRTUAL_DEVICE_SCHEMA},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 0},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};

const BINDING_DRAFT_ITEM_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['roleKey', 'source'],
    properties: {
        roleKey: ROLE_KEY_SCHEMA,
        source: SOURCE_COMPONENT_REF_SCHEMA,
        visual: VIRTUAL_ROLE_VISUAL_SCHEMA
    }
};

const BINDING_DRAFT_ARRAY_SCHEMA: JsonSchema = {
    type: 'array',
    minItems: 1,
    maxItems: 100,
    items: BINDING_DRAFT_ITEM_SCHEMA
};

export const VIRTUAL_DEVICE_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'name', 'typeKey'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        kind: VIRTUAL_DEVICE_KIND_SCHEMA,
        name: NAME_SCHEMA,
        typeKey: TYPE_KEY_SCHEMA,
        categoryKey: CATEGORY_KEY_SCHEMA,
        profileId: UUID_SCHEMA,
        imageAssetId: {anyOf: [UUID_SCHEMA, {type: 'null'}]},
        locationId: INT_ID_SCHEMA,
        groupIds: INT_ID_ARRAY_SCHEMA,
        tagIds: INT_ID_ARRAY_SCHEMA,
        visual: VIRTUAL_DEVICE_VISUAL_SCHEMA,
        metadata: METADATA_SCHEMA,
        bindings: BINDING_DRAFT_ARRAY_SCHEMA
    }
};

export const VIRTUAL_DEVICE_EXTRACTION_PREVIEW_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['hostExternalId', 'sourceKey'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        hostExternalId: {type: 'string', minLength: 1, maxLength: 120},
        sourceKey: COMPONENT_KEY_SCHEMA
    }
};

export const VIRTUAL_DEVICE_EXTRACTION_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['hostExternalId', 'sourceKey'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        hostExternalId: {type: 'string', minLength: 1, maxLength: 120},
        sourceKey: COMPONENT_KEY_SCHEMA,
        name: NAME_SCHEMA,
        typeKey: TYPE_KEY_SCHEMA,
        categoryKey: CATEGORY_KEY_SCHEMA,
        profileId: UUID_SCHEMA,
        imageAssetId: {anyOf: [UUID_SCHEMA, {type: 'null'}]},
        locationId: INT_ID_SCHEMA,
        groupIds: INT_ID_ARRAY_SCHEMA,
        tagIds: INT_ID_ARRAY_SCHEMA,
        visual: VIRTUAL_DEVICE_VISUAL_SCHEMA,
        metadata: METADATA_SCHEMA
    }
};

export const VIRTUAL_DEVICE_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId'],
    properties: {externalId: EXTERNAL_ID_SCHEMA}
};

export const VIRTUAL_DEVICE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'expectedRevision'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        expectedRevision: REVISION_SCHEMA,
        name: NAME_SCHEMA,
        typeKey: TYPE_KEY_SCHEMA,
        categoryKey: CATEGORY_KEY_SCHEMA,
        imageAssetId: {anyOf: [UUID_SCHEMA, {type: 'null'}]},
        locationId: {type: ['integer', 'null'], minimum: 1},
        groupIds: INT_ID_ARRAY_SCHEMA,
        tagIds: INT_ID_ARRAY_SCHEMA,
        enabled: {type: 'boolean'},
        visual: VIRTUAL_DEVICE_VISUAL_SCHEMA,
        metadata: METADATA_SCHEMA
    }
};

export const VIRTUAL_DEVICE_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'expectedRevision'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        expectedRevision: REVISION_SCHEMA,
        retention: {type: 'string', enum: ['tombstone', 'purge']}
    }
};

export const VIRTUAL_DEVICE_DELETED_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'deleted'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        deleted: {type: 'boolean'}
    }
};

export const VIRTUAL_DEVICE_PROFILE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'key',
        'name',
        'version',
        'roles',
        'metadata'
    ],
    properties: {
        id: UUID_SCHEMA,
        // null = system profile, shared across orgs.
        organizationId: {anyOf: [ORG_ID_SCHEMA, {type: 'null'}]},
        key: PROFILE_KEY_SCHEMA,
        name: NAME_SCHEMA,
        version: {type: 'integer', minimum: 1},
        roles: PROFILE_ROLES_SCHEMA,
        metadata: PROFILE_METADATA_SCHEMA
    }
};

export const VIRTUAL_DEVICE_PROFILE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: VIRTUAL_DEVICE_PROFILE_SCHEMA},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 0},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};

export const VIRTUAL_DEVICE_PROFILE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        query: {type: 'string', minLength: 1, maxLength: 120},
        limit: {type: 'integer', minimum: 0, maximum: 1000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

export const VIRTUAL_DEVICE_PROFILE_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'name', 'roles'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        key: PROFILE_KEY_SCHEMA,
        name: NAME_SCHEMA,
        version: {type: 'integer', minimum: 1},
        roles: PROFILE_ROLES_SCHEMA,
        metadata: PROFILE_METADATA_SCHEMA
    }
};

// Only per-org profiles can be updated. System profiles (organization_id IS NULL)
// are immutable from the API surface; the seeder owns them.
// `metadata` is treated as a PATCH — unchanged keys on existing rows are
// preserved by a JSONB merge in the repository.
export const VIRTUAL_DEVICE_PROFILE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['profileId'],
    properties: {
        // Optional for super-admin cross-org calls; same convention as Create.
        organizationId: ORG_ID_SCHEMA,
        profileId: UUID_SCHEMA,
        name: NAME_SCHEMA,
        metadata: PROFILE_METADATA_SCHEMA
    }
};

export const VIRTUAL_DEVICE_PROFILE_VALIDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['roles'],
    properties: {
        roles: PROFILE_ROLES_SCHEMA
    }
};

export const VIRTUAL_DEVICE_EXTRACTION_REPLACEMENT_PREVIEW_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        additionalProperties: false,
        required: ['externalId', 'newHostExternalId', 'newSourceKey'],
        properties: {
            externalId: {type: 'string', minLength: 1, maxLength: 120},
            newHostExternalId: {type: 'string', minLength: 1, maxLength: 120},
            newSourceKey: COMPONENT_KEY_SCHEMA
        }
    };

export const VIRTUAL_DEVICE_EXTRACTION_REPLACEMENT_PREVIEW_RESPONSE_SCHEMA: JsonSchema =
    {
        type: 'object',
        additionalProperties: false,
        required: [
            'compatible',
            'score',
            'roleMatches',
            'roleMissing',
            'roleExtra',
            'warnings'
        ],
        properties: {
            compatible: {type: 'boolean'},
            score: {type: 'number', minimum: 0, maximum: 1},
            roleMatches: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                        'roleKey',
                        'fromComponentKey',
                        'toComponentKey',
                        'componentType',
                        'valueType'
                    ],
                    properties: {
                        roleKey: {type: 'string', minLength: 1, maxLength: 80},
                        fromComponentKey: COMPONENT_KEY_SCHEMA,
                        toComponentKey: COMPONENT_KEY_SCHEMA,
                        componentType: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 80
                        },
                        valueType: ROLE_VALUE_TYPE_SCHEMA
                    }
                }
            },
            roleMissing: {
                type: 'array',
                items: {type: 'string', minLength: 1, maxLength: 80}
            },
            roleExtra: {
                type: 'array',
                items: {type: 'string', minLength: 1, maxLength: 80}
            },
            warnings: {
                type: 'array',
                items: {type: 'string', maxLength: 200}
            }
        }
    };

export const VIRTUAL_DEVICE_PROFILE_MATCH_SOURCES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        profileId: {type: 'string', minLength: 1, maxLength: 120},
        profileKey: PROFILE_KEY_SCHEMA,
        profileVersion: {type: 'integer', minimum: 1},
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 120},
        sourceDeviceExternalIds: {
            type: 'array',
            items: {type: 'string', minLength: 1, maxLength: 120},
            maxItems: 200
        },
        query: {type: 'string', minLength: 1, maxLength: 120},
        limit: {type: 'integer', minimum: 0, maximum: 1000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

const PROFILE_MATCH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'deviceExternalId',
        'deviceName',
        'componentKey',
        'componentType',
        'score',
        'reasons'
    ],
    properties: {
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 120},
        deviceName: {type: 'string', maxLength: 200},
        componentKey: COMPONENT_KEY_SCHEMA,
        componentType: {type: 'string', minLength: 1, maxLength: 80},
        label: {type: ['string', 'null'], maxLength: 200},
        score: {type: 'number', minimum: 0, maximum: 1},
        reasons: {type: 'array', items: {type: 'string', maxLength: 80}}
    }
};

const PROFILE_MATCH_SLOT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['roleKey', 'label', 'valueType', 'required', 'matches'],
    properties: {
        roleKey: {type: 'string', minLength: 1, maxLength: 80},
        label: {type: 'string', maxLength: 200},
        valueType: ROLE_VALUE_TYPE_SCHEMA,
        unit: {type: ['string', 'null'], maxLength: 40},
        writable: {type: 'boolean'},
        required: {type: 'boolean'},
        matches: {type: 'array', items: PROFILE_MATCH_SCHEMA}
    }
};

const PROFILE_FILL_ASSIGNMENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['roleKey', 'componentKey'],
    properties: {
        roleKey: {type: 'string', minLength: 1, maxLength: 80},
        componentKey: COMPONENT_KEY_SCHEMA
    }
};

const PROFILE_FILL_DEVICE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'deviceExternalId',
        'matchedRequired',
        'totalRequired',
        'assignments'
    ],
    properties: {
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 120},
        matchedRequired: {type: 'integer', minimum: 0},
        totalRequired: {type: 'integer', minimum: 0},
        assignments: {
            type: 'array',
            items: PROFILE_FILL_ASSIGNMENT_SCHEMA
        }
    }
};

export const VIRTUAL_DEVICE_PROFILE_SUGGEST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deviceExternalId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 120},
        limit: {type: 'integer', minimum: 1, maximum: 100, default: 10}
    }
};

const PROFILE_SUGGEST_ROLE_FIT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'roleKey',
        'required',
        'matched',
        'bestComponentKey',
        'bestScore'
    ],
    properties: {
        roleKey: {type: 'string', minLength: 1, maxLength: 80},
        required: {type: 'boolean'},
        matched: {type: 'boolean'},
        bestComponentKey: {anyOf: [COMPONENT_KEY_SCHEMA, {type: 'null'}]},
        bestScore: {type: 'number', minimum: 0, maximum: 1}
    }
};

const PROFILE_SUGGEST_CANDIDATE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'profile',
        'confidence',
        'coverage',
        'matchedRequired',
        'totalRequired',
        'reasons',
        'roleFitness'
    ],
    properties: {
        profile: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'key', 'name', 'version'],
            properties: {
                id: {type: 'string', minLength: 1, maxLength: 120},
                key: PROFILE_KEY_SCHEMA,
                name: {type: 'string', maxLength: 200},
                version: {type: 'integer', minimum: 1}
            }
        },
        confidence: {type: 'number', minimum: 0, maximum: 1},
        coverage: {type: 'number', minimum: 0, maximum: 1},
        matchedRequired: {type: 'integer', minimum: 0},
        totalRequired: {type: 'integer', minimum: 0},
        reasons: {type: 'array', items: {type: 'string', maxLength: 200}},
        roleFitness: {type: 'array', items: PROFILE_SUGGEST_ROLE_FIT_SCHEMA}
    }
};

export const VIRTUAL_DEVICE_PROFILE_SUGGEST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['device', 'candidates'],
    properties: {
        device: {
            type: 'object',
            additionalProperties: false,
            required: ['externalId', 'kind', 'modelHint'],
            properties: {
                externalId: {type: 'string', minLength: 1, maxLength: 120},
                kind: {type: 'string', enum: ['physical', 'bluetooth']},
                modelHint: {type: ['string', 'null'], maxLength: 200}
            }
        },
        candidates: {
            type: 'array',
            items: PROFILE_SUGGEST_CANDIDATE_SCHEMA
        }
    }
};

export const VIRTUAL_DEVICE_PROFILE_MATCH_SOURCES_RESPONSE_SCHEMA: JsonSchema =
    {
        type: 'object',
        additionalProperties: false,
        required: ['profile', 'slots', 'fillFromDevice'],
        properties: {
            profile: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'key', 'name', 'version'],
                properties: {
                    id: {type: 'string', minLength: 1, maxLength: 120},
                    key: PROFILE_KEY_SCHEMA,
                    name: NAME_SCHEMA,
                    version: {type: 'integer', minimum: 1}
                }
            },
            slots: {type: 'array', items: PROFILE_MATCH_SLOT_SCHEMA},
            fillFromDevice: {
                type: 'array',
                items: PROFILE_FILL_DEVICE_SCHEMA
            }
        }
    };

const VALIDATION_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['valid', 'errors'],
    properties: {
        valid: {type: 'boolean'},
        errors: {type: 'array', items: {type: 'object'}}
    }
};

export const VIRTUAL_DEVICE_BINDING_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId'],
    properties: {externalId: EXTERNAL_ID_SCHEMA}
};

export const VIRTUAL_DEVICE_BINDING_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {items: {type: 'array', items: BINDING_SCHEMA}}
};

export const VIRTUAL_DEVICE_BINDING_REPLACE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'externalId',
        'roleKey',
        'source',
        'expectedRevision',
        'idempotencyKey'
    ],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        source: SOURCE_COMPONENT_REF_SCHEMA,
        expectedRevision: REVISION_SCHEMA,
        idempotencyKey: {type: 'string', minLength: 8, maxLength: 160},
        effectiveFrom: {type: 'string'},
        visual: VIRTUAL_ROLE_VISUAL_SCHEMA,
        reason: {type: 'string', maxLength: 500}
    }
};

export const VIRTUAL_DEVICE_BINDING_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'roleKey', 'source', 'expectedRevision'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        source: SOURCE_COMPONENT_REF_SCHEMA,
        expectedRevision: REVISION_SCHEMA,
        effectiveFrom: {type: 'string'},
        visual: VIRTUAL_ROLE_VISUAL_SCHEMA,
        reason: {type: 'string', maxLength: 500}
    }
};

export const VIRTUAL_DEVICE_BINDING_RETIRE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'bindingId', 'expectedRevision'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        bindingId: UUID_SCHEMA,
        expectedRevision: REVISION_SCHEMA,
        effectiveTo: {type: 'string'},
        reason: {type: 'string', maxLength: 500}
    }
};

export const VIRTUAL_DEVICE_BINDING_LIST_SOURCES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        externalId: EXTERNAL_ID_SCHEMA,
        query: {type: 'string', minLength: 1, maxLength: 120},
        componentType: {type: 'string', minLength: 1, maxLength: 80},
        roleKey: ROLE_KEY_SCHEMA,
        limit: {type: 'integer', minimum: 0, maximum: 1000, default: 200},
        offset: {type: 'integer', minimum: 0, default: 0}
    }
};

export const VIRTUAL_DEVICE_BINDING_SOURCE_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: SOURCE_COMPONENT_CANDIDATE_SCHEMA},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 0},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};

export const VIRTUAL_DEVICE_BINDING_VALIDATE_DRAFT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'bindings'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        bindings: BINDING_DRAFT_ARRAY_SCHEMA
    }
};

export const VIRTUAL_DEVICE_BINDING_VALIDATE_DRAFT_RESPONSE_SCHEMA: JsonSchema =
    VALIDATION_RESPONSE_SCHEMA;

export const VIRTUAL_DEVICE_DRAFT_PREVIEW_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['device', 'bindings'],
    properties: {
        device: VIRTUAL_DEVICE_CREATE_PARAMS_SCHEMA,
        bindings: BINDING_DRAFT_ARRAY_SCHEMA
    }
};

export const VIRTUAL_DEVICE_DRAFT_PREVIEW_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['device', 'bindings', 'validation'],
    properties: {
        device: VIRTUAL_DEVICE_SCHEMA,
        bindings: {type: 'array', items: BINDING_SCHEMA},
        validation: VIRTUAL_DEVICE_BINDING_VALIDATE_DRAFT_RESPONSE_SCHEMA
    }
};

export const VIRTUAL_DEVICE_HISTORY_READ_ROLE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'roleKey', 'field', 'from', 'to'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        field: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
            pattern: '^[a-zA-Z][\\w:.\\-]*$'
        },
        from: {type: 'string'},
        to: {type: 'string'},
        limit: {type: 'integer', minimum: 1, maximum: 2000000}
    }
};

export const VIRTUAL_DEVICE_HISTORY_READ_PROVENANCE_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        additionalProperties: false,
        required: ['externalId', 'roleKey', 'from', 'to'],
        properties: {
            externalId: EXTERNAL_ID_SCHEMA,
            roleKey: ROLE_KEY_SCHEMA,
            from: {type: 'string'},
            to: {type: 'string'},
            limit: {type: 'integer', minimum: 1, maximum: 2000000}
        }
    };

export const VIRTUAL_DEVICE_COMMAND_INVOKE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'roleKey', 'action'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        action: {type: 'string', minLength: 1, maxLength: 80},
        params: {
            type: 'object',
            additionalProperties: true,
            default: {}
        }
    }
};

const VIRTUAL_DEVICE_COMMAND_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'externalId',
        'roleKey',
        'bindingId',
        'source',
        'action',
        'method',
        'result'
    ],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        bindingId: UUID_SCHEMA,
        source: SOURCE_COMPONENT_REF_SCHEMA,
        action: {type: 'string'},
        method: {type: 'string'},
        result: {
            type: ['object', 'array', 'string', 'number', 'boolean', 'null']
        }
    }
};

const HISTORY_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deviceExternalId', 'componentKey'],
    properties: {
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 120},
        componentKey: COMPONENT_KEY_SCHEMA,
        dynamicCategory: DYNAMIC_CATEGORY_SCHEMA
    }
};

const HISTORY_SEGMENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'bindingId',
        'roleKey',
        'mode',
        'source',
        'effectiveFrom',
        'effectiveTo',
        'segmentFrom',
        'segmentTo'
    ],
    properties: {
        bindingId: UUID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        mode: HISTORY_MODE_SCHEMA,
        source: HISTORY_SOURCE_SCHEMA,
        effectiveFrom: {type: 'string'},
        effectiveTo: {type: ['string', 'null']},
        segmentFrom: {type: 'string'},
        segmentTo: {type: 'string'}
    }
};

const HISTORY_POINT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'ts',
        'value',
        'prevValue',
        'bindingId',
        'roleKey',
        'mode',
        'source'
    ],
    properties: {
        ts: {type: 'string'},
        value: {type: ['number', 'string', 'null']},
        prevValue: {type: ['number', 'string', 'null']},
        bindingId: UUID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        mode: HISTORY_MODE_SCHEMA,
        source: HISTORY_SOURCE_SCHEMA
    }
};

const HISTORY_SAMPLE_PROVENANCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['ts', 'bindingId', 'roleKey', 'source', 'sourceTs'],
    properties: {
        ts: {type: 'string'},
        bindingId: UUID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        source: HISTORY_SOURCE_SCHEMA,
        sourceTs: {type: 'string'}
    }
};

const HISTORY_ROLE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'provenance'],
    properties: {
        items: {type: 'array', items: HISTORY_POINT_SCHEMA},
        provenance: {type: 'array', items: HISTORY_SEGMENT_SCHEMA}
    }
};

const HISTORY_PROVENANCE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['segments', 'samples'],
    properties: {
        segments: {type: 'array', items: HISTORY_SEGMENT_SCHEMA},
        samples: {type: 'array', items: HISTORY_SAMPLE_PROVENANCE_SCHEMA}
    }
};

const MANIFEST_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['apiVersion', 'kind', 'spec'],
    properties: {
        apiVersion: {type: 'string', minLength: 1, maxLength: 80},
        kind: {type: 'string', const: 'VirtualDeviceBundle'},
        spec: {
            type: 'object',
            additionalProperties: false,
            properties: {
                profiles: {
                    type: 'array',
                    maxItems: 500,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['key', 'name', 'roles'],
                        properties: {
                            key: TYPE_KEY_SCHEMA,
                            name: NAME_SCHEMA,
                            version: {type: 'integer', minimum: 1},
                            roles: {
                                type: 'array',
                                maxItems: 200,
                                items: PROFILE_ROLE_SCHEMA
                            },
                            metadata: PROFILE_METADATA_SCHEMA
                        }
                    }
                },
                devices: {
                    type: 'array',
                    maxItems: 1000,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['externalId', 'kind', 'name', 'typeKey'],
                        properties: {
                            externalId: EXTERNAL_ID_SCHEMA,
                            kind: VIRTUAL_DEVICE_KIND_SCHEMA,
                            name: NAME_SCHEMA,
                            typeKey: TYPE_KEY_SCHEMA,
                            categoryKey: TYPE_KEY_SCHEMA,
                            profileKey: TYPE_KEY_SCHEMA,
                            profileVersion: {type: 'integer', minimum: 1},
                            imageAssetId: UUID_SCHEMA,
                            locationId: {
                                anyOf: [INT_ID_SCHEMA, {type: 'null'}]
                            },
                            groupIds: INT_ID_ARRAY_SCHEMA,
                            tagIds: INT_ID_ARRAY_SCHEMA,
                            enabled: {type: 'boolean'},
                            visual: VIRTUAL_DEVICE_VISUAL_SCHEMA,
                            metadata: METADATA_SCHEMA
                        }
                    }
                },
                bindings: {
                    type: 'array',
                    maxItems: 5000,
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['externalId', 'roleKey', 'source'],
                        properties: {
                            externalId: EXTERNAL_ID_SCHEMA,
                            roleKey: ROLE_KEY_SCHEMA,
                            source: SOURCE_COMPONENT_REF_SCHEMA,
                            mode: HISTORY_MODE_SCHEMA,
                            effectiveFrom: {type: 'string'},
                            reason: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 500
                            }
                        }
                    }
                },
                alertReferences: {
                    type: 'array',
                    maxItems: 5000,
                    items: {
                        type: 'object',
                        additionalProperties: true,
                        required: ['id', 'name', 'kind'],
                        properties: {
                            id: {type: 'integer', minimum: 1},
                            name: NAME_SCHEMA,
                            kind: {type: 'string', minLength: 1, maxLength: 64}
                        }
                    }
                },
                remap: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        devices: {
                            type: 'object',
                            additionalProperties: EXTERNAL_ID_SCHEMA
                        },
                        sources: {
                            type: 'object',
                            additionalProperties: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 120
                            }
                        },
                        profiles: {
                            type: 'object',
                            additionalProperties: TYPE_KEY_SCHEMA
                        }
                    }
                }
            }
        }
    }
};

export const VIRTUAL_DEVICE_MANIFEST_VALIDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['manifest'],
    properties: {manifest: MANIFEST_SCHEMA}
};

export const VIRTUAL_DEVICE_MANIFEST_PLAN_PARAMS_SCHEMA =
    VIRTUAL_DEVICE_MANIFEST_VALIDATE_PARAMS_SCHEMA;

export const VIRTUAL_DEVICE_MANIFEST_APPLY_PARAMS_SCHEMA =
    VIRTUAL_DEVICE_MANIFEST_VALIDATE_PARAMS_SCHEMA;

export const VIRTUAL_DEVICE_MANIFEST_EXPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        externalIds: {type: 'array', items: EXTERNAL_ID_SCHEMA}
    }
};

const MANIFEST_PLAN_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['valid', 'changes', 'errors', 'remaps'],
    properties: {
        valid: {type: 'boolean'},
        changes: {type: 'array', items: {type: 'object'}},
        errors: {type: 'array', items: {type: 'object'}},
        remaps: {type: 'array', items: {type: 'object'}}
    }
};

const MANIFEST_OUTCOME_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['resourceType', 'ref', 'outcome'],
    properties: {
        resourceType: {enum: ['profile', 'device', 'binding']},
        ref: {type: 'string', minLength: 1, maxLength: 200},
        outcome: {enum: ['create', 'update', 'skip', 'fail']},
        reason: {type: 'string', maxLength: 500}
    }
};

const MANIFEST_APPLY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['applied', 'plan', 'outcomes'],
    properties: {
        applied: {type: 'boolean'},
        plan: MANIFEST_PLAN_RESPONSE_SCHEMA,
        outcomes: {type: 'array', items: MANIFEST_OUTCOME_SCHEMA}
    }
};

export const VIRTUAL_DEVICE_HISTORY_BACKFILL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'roleKey', 'field', 'from', 'to'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        field: {type: 'string', minLength: 1, maxLength: 100},
        from: {type: 'string'},
        to: {type: 'string'},
        limit: {type: 'integer', minimum: 1, maximum: 1000000}
    }
};

const HISTORY_BACKFILL_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId', 'roleKey', 'field', 'insertedRows', 'scannedRows'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        field: {type: 'string'},
        insertedRows: {type: 'integer', minimum: 0},
        scannedRows: {type: 'integer', minimum: 0}
    }
};

export const VIRTUAL_DEVICE_REPLACEMENT_REPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['externalId'],
    properties: {
        externalId: EXTERNAL_ID_SCHEMA,
        roleKey: ROLE_KEY_SCHEMA,
        from: {type: 'string'},
        to: {type: 'string'},
        limit: {type: 'integer', minimum: 1, maximum: 10000},
        offset: {type: 'integer', minimum: 0}
    }
};

const REPLACEMENT_REPORT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: {type: 'object'}},
        total: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 0},
        offset: {type: 'integer', minimum: 0},
        has_more: {type: 'boolean'}
    }
};

export interface VirtualDeviceCreateParams {
    organizationId?: string;
    kind: VirtualDeviceKind;
    name: string;
    typeKey: string;
    categoryKey?: string;
    profileId?: string;
    imageAssetId?: string;
    locationId?: number;
    groupIds?: number[];
    tagIds?: number[];
    visual?: VirtualDeviceVisual;
    metadata?: Record<string, unknown>;
    bindings?: VirtualDeviceBindingDraftItem[];
}

export interface VirtualDeviceDto {
    deviceListId: number;
    externalId: string;
    organizationId: string;
    kind: VirtualDeviceKind;
    name: string;
    typeKey: string;
    categoryKey: string | null;
    profileId: string | null;
    imageAssetId: string | null;
    locationId: number | null;
    groupIds: number[];
    tagIds: number[];
    enabled: boolean;
    revision: number;
    visual: VirtualDeviceVisual;
    metadata: Record<string, unknown>;
}

export interface VirtualDeviceListParams {
    organizationId?: string;
    query?: string;
    kind?: VirtualDeviceKind;
    typeKey?: string;
    categoryKey?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'name' | 'kind' | 'typeKey' | 'categoryKey' | 'createdAt';
    sortDir?: 'asc' | 'desc';
}

export interface VirtualDeviceGetParams {
    externalId: string;
}

export interface VirtualDeviceUpdateParams {
    externalId: string;
    expectedRevision: number;
    name?: string;
    typeKey?: string;
    categoryKey?: string;
    imageAssetId?: string;
    locationId?: number | null;
    groupIds?: number[];
    tagIds?: number[];
    enabled?: boolean;
    visual?: VirtualDeviceVisual;
    metadata?: Record<string, unknown>;
}

export interface VirtualDeviceDeleteParams {
    externalId: string;
    expectedRevision: number;
    retention?: 'tombstone' | 'purge';
}

export interface VirtualDeviceExtractionPreviewParams {
    organizationId?: string;
    hostExternalId: string;
    sourceKey: string;
}

export interface VirtualDeviceExtractionCreateParams
    extends VirtualDeviceExtractionPreviewParams {
    name?: string;
    typeKey?: string;
    categoryKey?: string;
    profileId?: string;
    imageAssetId?: string;
    locationId?: number;
    groupIds?: number[];
    tagIds?: number[];
    visual?: VirtualDeviceVisual;
    metadata?: Record<string, unknown>;
}

export interface VirtualDeviceExtractionRoleDto {
    roleKey: string;
    label: string;
    componentKey: string;
    componentType: string;
    writable: boolean;
    valueType: VirtualDeviceRoleValueType;
    dynamicCategory: keyof typeof SHELLY_DYNAMIC_COMPONENT_TREE;
}

export interface VirtualDeviceExtractionMemberSnapshotDto {
    roleKey: string;
    componentKey: string;
    componentType: string;
    valueType: VirtualDeviceRoleValueType;
    writable: boolean;
    required: boolean;
    unit: string | null;
    label: string | null;
}

export interface VirtualDeviceExtractionSnapshotDto {
    hostExternalId: string;
    hostDeviceListId: number;
    sourceKey: string;
    sourceType: 'virtual_group' | 'service';
    members: VirtualDeviceExtractionMemberSnapshotDto[];
    capturedAt: string;
}

export interface VirtualDeviceExtractionReplacementPreviewParams {
    externalId: string;
    newHostExternalId: string;
    newSourceKey: string;
}

export interface VirtualDeviceExtractionReplacementRoleMatchDto {
    roleKey: string;
    fromComponentKey: string;
    toComponentKey: string;
    componentType: string;
    valueType: VirtualDeviceRoleValueType;
}

export interface VirtualDeviceExtractionReplacementPreviewDto {
    compatible: boolean;
    score: number;
    roleMatches: VirtualDeviceExtractionReplacementRoleMatchDto[];
    roleMissing: string[];
    roleExtra: string[];
    warnings: string[];
}

export interface VirtualDeviceExtractionPreviewDto {
    hostDeviceListId: number;
    hostExternalId: string;
    sourceKey: string;
    sourceType: 'virtual_group' | 'service';
    name: string;
    typeKey: string;
    categoryKey: string | null;
    roles: VirtualDeviceExtractionRoleDto[];
    bindings: VirtualDeviceBindingSourceRef[];
    hiddenSourceComponentKeys: string[];
    alreadyExtracted: boolean;
    extractedExternalId: string | null;
    sourceSnapshot: VirtualDeviceExtractionSnapshotDto;
}

export type VirtualDeviceRoleValueType =
    | 'boolean'
    | 'number'
    | 'string'
    | 'event'
    | 'json';

export type VirtualDeviceHistoryMode =
    | 'linked'
    | 'materialized'
    | 'derived'
    | 'live_only';

export interface VirtualDeviceVisual {
    icon?: string;
    accent?: string;
    imageModel?: string;
    cardProfile?: 'meter' | 'climate' | 'safety' | 'actuator' | 'custom';
    summaryRoles?: string[];
    detailSections?: string[];
}

export interface VirtualRoleVisual {
    displayName?: string;
    icon?: string;
    slot?: 'primary' | 'secondary' | 'control' | 'diagnostic' | 'hidden';
    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
    format?: Record<string, unknown>;
    alertDefaults?: Record<string, unknown>;
}

export interface VirtualDeviceProfileRole {
    roleKey: string;
    label: string;
    valueType: VirtualDeviceRoleValueType;
    unit?: string;
    writable?: boolean;
    required?: boolean;
    historyMode: VirtualDeviceHistoryMode;
    visual?: VirtualRoleVisual;
    metadata?: Record<string, unknown>;
}

// Typed sibling of PROFILE_METADATA_SCHEMA — keep both in sync.
export interface VirtualDeviceProfileMetadata {
    categoryKey?: string;
    defaultVisual?: VisualDecoration;
}

export interface VirtualDeviceProfileDto {
    id: string;
    // null = system profile (shared across all orgs).
    organizationId: string | null;
    key: string;
    name: string;
    version: number;
    roles: VirtualDeviceProfileRole[];
    metadata: VirtualDeviceProfileMetadata;
}

export interface VirtualDeviceProfileCreateParams {
    // null = system profile (seeder only); omit for per-org create.
    organizationId?: string | null;
    key: string;
    name: string;
    version?: number;
    roles: VirtualDeviceProfileRole[];
    metadata?: VirtualDeviceProfileMetadata;
}

export interface VirtualDeviceProfileListParams {
    organizationId?: string;
    query?: string;
    limit?: number;
    offset?: number;
}

export interface VirtualDeviceProfileUpdateParams {
    organizationId?: string;
    profileId: string;
    name?: string;
    metadata?: VirtualDeviceProfileMetadata;
}

export interface VirtualDeviceProfileValidateParams {
    roles: VirtualDeviceProfileRole[];
}

export interface VirtualDeviceProfileMatchSourcesParams {
    organizationId?: string;
    profileId?: string;
    profileKey?: string;
    profileVersion?: number;
    deviceExternalId?: string;
    sourceDeviceExternalIds?: string[];
    query?: string;
    limit?: number;
    offset?: number;
}

export interface VirtualDeviceProfileMatchDto {
    deviceExternalId: string;
    deviceName: string;
    componentKey: string;
    componentType: string;
    label: string | null;
    score: number;
    reasons: string[];
}

export interface VirtualDeviceProfileMatchSlotDto {
    roleKey: string;
    label: string;
    valueType: VirtualDeviceRoleValueType;
    unit: string | null;
    writable: boolean;
    required: boolean;
    matches: VirtualDeviceProfileMatchDto[];
}

export interface VirtualDeviceProfileFillAssignmentDto {
    roleKey: string;
    componentKey: string;
}

export interface VirtualDeviceProfileFillFromDeviceDto {
    deviceExternalId: string;
    matchedRequired: number;
    totalRequired: number;
    assignments: VirtualDeviceProfileFillAssignmentDto[];
}

export interface VirtualDeviceProfileMatchSourcesDto {
    profile: {
        id: string;
        key: string;
        name: string;
        version: number;
    };
    slots: VirtualDeviceProfileMatchSlotDto[];
    fillFromDevice: VirtualDeviceProfileFillFromDeviceDto[];
}

export interface VirtualDeviceProfileSuggestParams {
    organizationId?: string;
    deviceExternalId: string;
    limit?: number;
}

export interface VirtualDeviceProfileSuggestRoleFitDto {
    roleKey: string;
    required: boolean;
    matched: boolean;
    bestComponentKey: string | null;
    bestScore: number;
}

export interface VirtualDeviceProfileSuggestCandidateDto {
    profile: {
        id: string;
        key: string;
        name: string;
        version: number;
    };
    confidence: number;
    coverage: number;
    matchedRequired: number;
    totalRequired: number;
    reasons: string[];
    roleFitness: VirtualDeviceProfileSuggestRoleFitDto[];
}

export interface VirtualDeviceProfileSuggestDto {
    device: {
        externalId: string;
        kind: 'physical' | 'bluetooth';
        modelHint: string | null;
    };
    candidates: VirtualDeviceProfileSuggestCandidateDto[];
}

export interface VirtualDeviceBindingSourceRef {
    deviceExternalId: string;
    componentKey: string;
    dynamicCategory?: keyof typeof SHELLY_DYNAMIC_COMPONENT_TREE;
}

export interface VirtualDeviceBindingDto {
    id: string;
    roleKey: string;
    source: VirtualDeviceBindingSourceRef;
    mode: VirtualDeviceHistoryMode;
    active: boolean;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    visual: VirtualRoleVisual;
    createdAt: string;
}

export interface VirtualDeviceBindingListParams {
    externalId: string;
}

export interface VirtualDeviceBindingReplaceParams {
    externalId: string;
    roleKey: string;
    source: VirtualDeviceBindingSourceRef;
    expectedRevision: number;
    idempotencyKey?: string;
    effectiveFrom?: string;
    visual?: VirtualRoleVisual;
    reason?: string;
}

export interface VirtualDeviceBindingRetireParams {
    externalId: string;
    bindingId: string;
    expectedRevision: number;
    effectiveTo?: string;
    reason?: string;
}

export interface VirtualDeviceCommandInvokeParams {
    externalId: string;
    roleKey: string;
    action: string;
    params?: Record<string, unknown>;
}

export interface VirtualDeviceCommandInvokeDto {
    externalId: string;
    roleKey: string;
    bindingId: string;
    source: VirtualDeviceBindingSourceRef;
    action: string;
    method: string;
    result: unknown;
}

export interface VirtualDeviceBindingCreateParams
    extends VirtualDeviceBindingReplaceParams {}

export interface VirtualDeviceBindingSourceCandidateDto {
    deviceExternalId: string;
    componentKey: string;
    deviceName: string;
    componentType: string;
    dynamicCategory: keyof typeof SHELLY_DYNAMIC_COMPONENT_TREE | null;
    label: string | null;
    valueType: VirtualDeviceRoleValueType;
    writable: boolean;
    connector?: {
        protocol: string;
        pointId: string | null;
    };
}

export interface VirtualDeviceBindingListSourcesParams {
    organizationId?: string;
    externalId?: string;
    query?: string;
    componentType?: string;
    roleKey?: string;
    limit?: number;
    offset?: number;
}

export interface VirtualDeviceBindingDraftItem {
    roleKey: string;
    source: VirtualDeviceBindingSourceRef;
    visual?: VirtualRoleVisual;
}

export interface VirtualDeviceBindingValidateDraftParams {
    externalId: string;
    bindings: VirtualDeviceBindingDraftItem[];
}

export interface VirtualDeviceDraftPreviewParams {
    device: VirtualDeviceCreateParams;
    bindings: VirtualDeviceBindingDraftItem[];
}

export interface VirtualDeviceDraftPreviewDto {
    device: VirtualDeviceDto;
    bindings: VirtualDeviceBindingDto[];
    validation: {
        valid: boolean;
        errors: Array<{field: string; error: string; code: string}>;
    };
}

export interface VirtualDeviceHistoryReadRoleParams {
    externalId: string;
    roleKey: string;
    field: string;
    from: string;
    to: string;
    limit?: number;
}

export interface VirtualDeviceHistoryReadProvenanceParams {
    externalId: string;
    roleKey: string;
    from: string;
    to: string;
    limit?: number;
}

export interface VirtualDeviceHistorySegmentDto {
    bindingId: string;
    roleKey: string;
    mode: VirtualDeviceHistoryMode;
    source: VirtualDeviceBindingSourceRef;
    effectiveFrom: string;
    effectiveTo: string | null;
    segmentFrom: string;
    segmentTo: string;
}

export interface VirtualDeviceHistoryPointDto {
    ts: string;
    value: number | string | null;
    prevValue: number | string | null;
    bindingId: string;
    roleKey: string;
    mode: VirtualDeviceHistoryMode;
    source: VirtualDeviceBindingSourceRef;
}

export interface VirtualDeviceHistorySampleProvenanceDto {
    ts: string;
    bindingId: string;
    roleKey: string;
    source: VirtualDeviceBindingSourceRef;
    sourceTs: string;
}

export interface VirtualDeviceHistoryReadRoleDto {
    items: VirtualDeviceHistoryPointDto[];
    provenance: VirtualDeviceHistorySegmentDto[];
}

export interface VirtualDeviceHistoryReadProvenanceDto {
    segments: VirtualDeviceHistorySegmentDto[];
    samples: VirtualDeviceHistorySampleProvenanceDto[];
}

export interface VirtualDeviceManifestProfile {
    key: string;
    name: string;
    version?: number;
    roles: VirtualDeviceProfileRole[];
    metadata?: VirtualDeviceProfileMetadata;
}

export interface VirtualDeviceManifestDevice {
    externalId: string;
    kind: VirtualDeviceKind;
    name: string;
    typeKey: string;
    categoryKey?: string;
    profileKey?: string;
    profileVersion?: number;
    imageAssetId?: string;
    locationId?: number | null;
    groupIds?: number[];
    tagIds?: number[];
    enabled?: boolean;
    visual?: VirtualDeviceVisual;
    metadata?: Record<string, unknown>;
}

export interface VirtualDeviceManifestBinding {
    externalId: string;
    roleKey: string;
    source: VirtualDeviceBindingSourceRef;
    mode?: VirtualDeviceHistoryMode;
    effectiveFrom?: string;
    reason?: string;
}

export interface VirtualDeviceManifestRemap {
    devices?: Record<string, string>;
    sources?: Record<string, string>;
    profiles?: Record<string, string>;
}

export interface VirtualDeviceManifestAlertReference {
    id: number;
    name: string;
    kind: string;
    scope?: Record<string, unknown>;
    config?: Record<string, unknown>;
}

export interface VirtualDeviceManifest {
    apiVersion: string;
    kind: 'VirtualDeviceBundle';
    spec: {
        profiles?: VirtualDeviceManifestProfile[];
        devices?: VirtualDeviceManifestDevice[];
        bindings?: VirtualDeviceManifestBinding[];
        alertReferences?: VirtualDeviceManifestAlertReference[];
        remap?: VirtualDeviceManifestRemap;
    };
}

export interface VirtualDeviceManifestParams {
    manifest: VirtualDeviceManifest;
}

export interface VirtualDeviceManifestExportParams {
    organizationId?: string;
    externalIds?: string[];
}

export interface VirtualDeviceManifestChange {
    action: 'create' | 'update' | 'replace' | 'skip';
    resourceType: 'profile' | 'device' | 'binding';
    ref: string;
    reason: string;
}

export interface VirtualDeviceManifestProblem {
    field: string;
    code: string;
    message: string;
}

export interface VirtualDeviceManifestPlanDto {
    valid: boolean;
    changes: VirtualDeviceManifestChange[];
    errors: VirtualDeviceManifestProblem[];
    remaps: Array<{
        kind: 'device' | 'source' | 'profile';
        from: string;
        to: string;
    }>;
}

// outcome verbs mirror VirtualDeviceManifestChange.action so consumers can
// read both fields with one vocabulary.
export interface VirtualDeviceManifestOutcome {
    resourceType: 'profile' | 'device' | 'binding';
    ref: string;
    outcome: 'create' | 'update' | 'skip' | 'fail';
    reason?: string;
}

export interface VirtualDeviceManifestApplyDto {
    applied: boolean;
    plan: VirtualDeviceManifestPlanDto;
    outcomes: VirtualDeviceManifestOutcome[];
}

export interface VirtualDeviceHistoryBackfillParams {
    externalId: string;
    roleKey: string;
    field: string;
    from: string;
    to: string;
    limit?: number;
}

export interface VirtualDeviceHistoryBackfillDto {
    externalId: string;
    roleKey: string;
    field: string;
    insertedRows: number;
    scannedRows: number;
}

export interface VirtualDeviceReplacementReportParams {
    externalId: string;
    roleKey?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
}

export interface VirtualDeviceReplacementReportItem {
    eventType: 'create' | 'replace' | 'retire';
    roleKey: string | null;
    oldSource: VirtualDeviceBindingSourceRef | null;
    newSource: VirtualDeviceBindingSourceRef | null;
    actorId: string | null;
    reason: string | null;
    createdAt: string;
}

export interface VirtualDeviceReplacementReportDto {
    items: VirtualDeviceReplacementReportItem[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

export interface BluetoothDeviceListParams {
    organizationId?: string;
    query?: string;
    capability?: BluCapability;
    limit?: number;
    offset?: number;
}

export interface BluetoothPrimaryTransportSummary {
    id: string;
    mode: BluTransportMode;
    canWrite: boolean;
    enabled: boolean;
    shellyDeviceExternalId?: string | null;
    assistantDeviceExternalId?: string | null;
    hostAdapterId?: string | null;
    serialPortRef?: string | null;
    lastSeenAt: string | null;
    lastRssi: number | null;
}

export interface BluetoothDeviceDto {
    deviceListId: number;
    externalId: string;
    stableId: string;
    bleAddress: string | null;
    productName: string | null;
    modelId: string | null;
    imageAssetId?: string | null;
    capability: BluCapability;
    keyRefSet: boolean;
    components: BluetoothSourceComponentDto[];
    visual: {icon?: string; accent?: string; imageModel?: string};
    primaryTransport?: BluetoothPrimaryTransportSummary | null;
}

export interface BluetoothUpdateParams {
    externalId: string;
    imageAssetId?: string | null;
    visual?: {icon?: string; accent?: string; imageModel?: string};
}

export interface BluetoothDeviceGetParams {
    externalId: string;
}

export interface BluetoothDeleteParams {
    externalId: string;
    retention?: 'tombstone' | 'purge';
    unpairFromGateway?: boolean;
    ignoreGatewayErrors?: boolean;
}

export interface BluetoothDeviceCandidateListParams {
    organizationId?: string;
    gatewayExternalId?: string;
    query?: string;
    limit?: number;
    offset?: number;
}

export interface BluetoothDeviceCandidateDto {
    gatewayDeviceListId: number;
    gatewayExternalId: string;
    componentKey: string;
    stableId: string;
    bleAddress: string;
    name: string | null;
    productName: string | null;
    modelId: string | null;
    capability: BluCapability;
    components: BluetoothSourceComponentDto[];
    alreadyPromoted: boolean;
    bluetoothExternalId: string | null;
}

export interface BluetoothSourceComponentDto {
    componentKey: string;
    kind: 'device' | 'sensor' | 'control' | 'trv';
    role: 'identity' | 'telemetry' | 'event_control' | 'writable_control';
    objectId: number | null;
    index: number | null;
    name: string | null;
    canWrite: boolean;
}

export interface BluetoothPromoteFromGatewayParams {
    organizationId?: string;
    gatewayExternalId: string;
    componentKey: string;
    makePrimary?: boolean;
}

export interface BluetoothTransportDto {
    id: string;
    mode: BluTransportMode;
    primary: boolean;
    canWrite: boolean;
    enabled: boolean;
    shellyDeviceExternalId: string | null;
    hostAdapterId: string | null;
    assistantDeviceExternalId: string | null;
    serialPortRef: string | null;
    keyDistributedAt: string | null;
    lastSeenAt: string | null;
    lastRssi: number | null;
}

export interface BluetoothTransportListParams {
    externalId: string;
}

export interface BluetoothTransportSetPrimaryParams {
    externalId: string;
    transportId: string;
}

export interface BluetoothKeySetRefParams {
    externalId: string;
    keyRef: string;
    reason?: string;
}

export interface BluetoothKeyClearParams {
    externalId: string;
    reason?: string;
}

const b = new DescribeBuilder('virtualdevice', {
    kind: 'fleet-manager',
    description:
        'Manage fleet-manager virtual devices (composed, extracted, connector kinds).'
}).setTags(['virtual-device', 'phase-0-contract']);

b.registerMethod('Create', {
    params: VIRTUAL_DEVICE_CREATE_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_SCHEMA,
    permission: PERM_CREATE,
    description:
        'virtualdevice.Create — create extracted/composed/connector device identity.'
});
b.registerMethod('Get', {
    params: VIRTUAL_DEVICE_GET_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_SCHEMA,
    permission: PERM_READ,
    description: 'virtualdevice.Get — fetch one virtual/custom device.'
});
b.registerMethod('List', {
    params: VIRTUAL_DEVICE_LIST_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_LIST_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description: 'virtualdevice.List — list virtual/custom devices.'
});
b.registerMethod('Update', {
    params: VIRTUAL_DEVICE_UPDATE_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_SCHEMA,
    permission: PERM_UPDATE,
    description: 'virtualdevice.Update — update metadata with revision check.'
});
b.registerMethod('Delete', {
    params: VIRTUAL_DEVICE_DELETE_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_DELETED_RESPONSE_SCHEMA,
    permission: PERM_DELETE,
    description: 'virtualdevice.Delete — tombstone or purge virtual identity.'
});
b.registerMethod('Extraction.Preview', {
    params: VIRTUAL_DEVICE_EXTRACTION_PREVIEW_PARAMS_SCHEMA,
    response: EXTRACTION_PREVIEW_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Extraction.Preview — preview host dynamic group/service extraction.'
});
b.registerMethod('Extraction.Create', {
    params: VIRTUAL_DEVICE_EXTRACTION_CREATE_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_SCHEMA,
    permission: PERM_CREATE,
    description:
        'virtualdevice.Extraction.Create — atomically create an extracted device with initial source bindings.'
});
b.registerMethod('Extraction.ReplacementPreview', {
    params: VIRTUAL_DEVICE_EXTRACTION_REPLACEMENT_PREVIEW_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_EXTRACTION_REPLACEMENT_PREVIEW_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Extraction.ReplacementPreview — score a candidate (host, sourceKey) against an existing extracted device.'
});
b.registerMethod('Profile.List', {
    params: VIRTUAL_DEVICE_PROFILE_LIST_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_PROFILE_LIST_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description: 'virtualdevice.Profile.List — list reusable profiles.'
});
b.registerMethod('Profile.Create', {
    params: VIRTUAL_DEVICE_PROFILE_CREATE_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_PROFILE_SCHEMA,
    permission: PERM_CREATE,
    description: 'virtualdevice.Profile.Create — create profile.'
});
b.registerMethod('Profile.Update', {
    params: VIRTUAL_DEVICE_PROFILE_UPDATE_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_PROFILE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Profile.Update — patch a per-org profile (name + metadata). System profiles are read-only.'
});
b.registerMethod('Profile.Validate', {
    params: VIRTUAL_DEVICE_PROFILE_VALIDATE_PARAMS_SCHEMA,
    response: VALIDATION_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description: 'virtualdevice.Profile.Validate — validate profile shape.'
});
b.registerMethod('Profile.MatchSources', {
    params: VIRTUAL_DEVICE_PROFILE_MATCH_SOURCES_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_PROFILE_MATCH_SOURCES_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Profile.MatchSources — score candidate source components against a profile.'
});
b.registerMethod('Profile.SuggestFromDevice', {
    params: VIRTUAL_DEVICE_PROFILE_SUGGEST_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_PROFILE_SUGGEST_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Profile.SuggestFromDevice — rank profiles likely to fit a given device.'
});
b.registerMethod('Binding.List', {
    params: VIRTUAL_DEVICE_BINDING_LIST_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_BINDING_LIST_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description: 'virtualdevice.Binding.List — list role source bindings.'
});
b.registerMethod('Binding.ListSources', {
    params: VIRTUAL_DEVICE_BINDING_LIST_SOURCES_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_BINDING_SOURCE_LIST_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Binding.ListSources — list backend-filtered source component candidates.'
});
b.registerMethod('Binding.ValidateDraft', {
    params: VIRTUAL_DEVICE_BINDING_VALIDATE_DRAFT_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_BINDING_VALIDATE_DRAFT_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Binding.ValidateDraft — validate a composed-device binding set without writing.'
});
b.registerMethod('Draft.Preview', {
    params: VIRTUAL_DEVICE_DRAFT_PREVIEW_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_DRAFT_PREVIEW_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Draft.Preview — render a composed-device preview from draft identity and bindings.'
});
b.registerMethod('Binding.Create', {
    params: VIRTUAL_DEVICE_BINDING_CREATE_PARAMS_SCHEMA,
    response: BINDING_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Binding.Create — create one role source binding when no active binding exists.'
});
b.registerMethod('Binding.Replace', {
    params: VIRTUAL_DEVICE_BINDING_REPLACE_PARAMS_SCHEMA,
    response: BINDING_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Binding.Replace — atomically replace one active role source.'
});
b.registerMethod('Binding.Retire', {
    params: VIRTUAL_DEVICE_BINDING_RETIRE_PARAMS_SCHEMA,
    response: BINDING_SCHEMA,
    permission: PERM_UPDATE,
    description: 'virtualdevice.Binding.Retire — stop one active role source.'
});
b.registerMethod('Command.Invoke', {
    params: VIRTUAL_DEVICE_COMMAND_INVOKE_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_COMMAND_RESPONSE_SCHEMA,
    permission: {component: 'devices', operation: 'execute'},
    description:
        'virtualdevice.Command.Invoke — execute a writable virtual role action on its active physical source.'
});
b.registerMethod('History.ReadRole', {
    params: VIRTUAL_DEVICE_HISTORY_READ_ROLE_PARAMS_SCHEMA,
    response: HISTORY_ROLE_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.History.ReadRole — read a stitched role time series across binding replacements.'
});
b.registerMethod('History.ReadProvenance', {
    params: VIRTUAL_DEVICE_HISTORY_READ_PROVENANCE_PARAMS_SCHEMA,
    response: HISTORY_PROVENANCE_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.History.ReadProvenance — explain which source produced a virtual role window.'
});
b.registerMethod('History.Backfill', {
    params: VIRTUAL_DEVICE_HISTORY_BACKFILL_PARAMS_SCHEMA,
    response: HISTORY_BACKFILL_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.History.Backfill — materialize linked source history onto a virtual role idempotently.'
});
b.registerMethod('Binding.ReplacementReport', {
    params: VIRTUAL_DEVICE_REPLACEMENT_REPORT_PARAMS_SCHEMA,
    response: REPLACEMENT_REPORT_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Binding.ReplacementReport — list source replacement events for a virtual device.'
});
b.registerMethod('Manifest.Validate', {
    params: VIRTUAL_DEVICE_MANIFEST_VALIDATE_PARAMS_SCHEMA,
    response: MANIFEST_PLAN_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Manifest.Validate — validate a virtual-device bundle without reading target state.'
});
b.registerMethod('Manifest.Export', {
    params: VIRTUAL_DEVICE_MANIFEST_EXPORT_PARAMS_SCHEMA,
    response: MANIFEST_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Manifest.Export — export virtual profiles, devices, bindings, visuals, and alert references.'
});
b.registerMethod('Manifest.Plan', {
    params: VIRTUAL_DEVICE_MANIFEST_PLAN_PARAMS_SCHEMA,
    response: MANIFEST_PLAN_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Manifest.Plan — dry-run a bundle import with conflict and remap checks.'
});
b.registerMethod('Manifest.Apply', {
    params: VIRTUAL_DEVICE_MANIFEST_APPLY_PARAMS_SCHEMA,
    response: MANIFEST_APPLY_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Manifest.Apply — apply a valid bundle through normal validation, idempotency, and audit paths.'
});
b.registerMethod('Bluetooth.Candidate.List', {
    params: BLUETOOTH_CANDIDATE_LIST_PARAMS_SCHEMA,
    response: BLUETOOTH_CANDIDATE_LIST_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Bluetooth.Candidate.List — list BTHome gateway children that can be promoted.'
});
b.registerMethod('Bluetooth.PromoteFromGateway', {
    params: BLUETOOTH_PROMOTE_FROM_GATEWAY_PARAMS_SCHEMA,
    response: BLU_DEVICE_SCHEMA,
    permission: PERM_CREATE,
    description:
        'virtualdevice.Bluetooth.PromoteFromGateway — create or update a first-class Bluetooth child device from bthomedevice:N.'
});
b.registerMethod('Bluetooth.List', {
    params: BLUETOOTH_DEVICE_LIST_PARAMS_SCHEMA,
    response: BLUETOOTH_DEVICE_LIST_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description: 'virtualdevice.Bluetooth.List — list Bluetooth child devices.'
});
b.registerMethod('Bluetooth.Get', {
    params: BLUETOOTH_DEVICE_GET_PARAMS_SCHEMA,
    response: BLU_DEVICE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Bluetooth.Get — fetch one Bluetooth child device.'
});
b.registerMethod('Bluetooth.Delete', {
    params: BLUETOOTH_DELETE_PARAMS_SCHEMA,
    response: VIRTUAL_DEVICE_DELETED_RESPONSE_SCHEMA,
    permission: PERM_DELETE,
    description:
        'virtualdevice.Bluetooth.Delete — tombstone or purge a Bluetooth child device, optionally unpairing it from its gateway first.'
});
b.registerMethod('Bluetooth.Transport.List', {
    params: BLUETOOTH_TRANSPORT_LIST_PARAMS_SCHEMA,
    response: BLUETOOTH_TRANSPORT_LIST_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'virtualdevice.Bluetooth.Transport.List — list transports for one Bluetooth child device.'
});
b.registerMethod('Bluetooth.Transport.SetPrimary', {
    params: BLUETOOTH_TRANSPORT_SET_PRIMARY_PARAMS_SCHEMA,
    response: BLUETOOTH_TRANSPORT_LIST_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Bluetooth.Transport.SetPrimary — manually choose the primary Bluetooth transport.'
});
b.registerMethod('Bluetooth.Key.SetRef', {
    params: BLUETOOTH_KEY_SET_REF_PARAMS_SCHEMA,
    response: BLU_DEVICE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Bluetooth.Key.SetRef — attach an audited secret reference for a Bluetooth device bindkey.'
});
b.registerMethod('Bluetooth.Key.Clear', {
    params: BLUETOOTH_KEY_CLEAR_PARAMS_SCHEMA,
    response: BLU_DEVICE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Bluetooth.Key.Clear — clear the audited Bluetooth bindkey reference.'
});

b.registerMethod('Image.CreateUploadTicket', {
    params: VIRTUAL_DEVICE_GET_PARAMS_SCHEMA,
    response: VISUAL_ASSET_UPLOAD_TICKET_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Image.CreateUploadTicket — issue a visual-asset upload ticket scoped to one virtual device.'
});

b.registerMethod('Bluetooth.Update', {
    params: BLUETOOTH_UPDATE_PARAMS_SCHEMA,
    response: BLU_DEVICE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Bluetooth.Update — set visual decoration on a BLU device.'
});

b.registerMethod('Bluetooth.Image.CreateUploadTicket', {
    params: BLUETOOTH_DEVICE_GET_PARAMS_SCHEMA,
    response: VISUAL_ASSET_UPLOAD_TICKET_RESPONSE_SCHEMA,
    permission: PERM_UPDATE,
    description:
        'virtualdevice.Bluetooth.Image.CreateUploadTicket — issue a visual-asset upload ticket scoped to one Bluetooth child device.'
});

export const VIRTUAL_DEVICE_DESCRIBE: DescribeOutput = b.build();
