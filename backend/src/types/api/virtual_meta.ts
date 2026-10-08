import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';
import {MEASUREMENT_META_SCHEMA, type MeasurementMeta} from './measurement';

const SHELLY_ID = SHELLY_ID_SCHEMA;
const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};

const COMPONENT_KEY: JsonSchema = {
    type: 'string',
    minLength: 3,
    maxLength: 64,
    pattern: '^[a-z][a-z0-9_]*:\\d+$',
    title: 'Component key',
    description: 'Shelly component key in <type>:<id> form (e.g. boolean:200).'
};

const GLYPH: JsonSchema = {
    type: 'string',
    maxLength: 128
};

const COLOR: JsonSchema = {
    type: 'string',
    maxLength: 32
};

const GRADIENT: JsonSchema = {
    type: 'object',
    required: ['stops'],
    additionalProperties: false,
    properties: {
        angle: {type: 'number', minimum: 0, maximum: 360},
        stops: {
            type: 'array',
            minItems: 2,
            maxItems: 5,
            items: {
                type: 'object',
                required: ['color', 'offset'],
                additionalProperties: false,
                properties: {
                    color: {type: 'string', maxLength: 32},
                    offset: {type: 'number', minimum: 0, maximum: 1}
                }
            }
        }
    }
};

const P_SET: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'componentKey'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        componentKey: COMPONENT_KEY,
        glyph: GLYPH,
        color: COLOR,
        gradient: GRADIENT,
        promoted: {type: 'boolean'},
        // UUID — holder column is asset_id, resolveAssetSrc builds the URL.
        imagePath: {
            type: 'string',
            pattern:
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        },
        measurement: MEASUREMENT_META_SCHEMA
    }
};

const P_CLEAR: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'componentKey'],
    additionalProperties: false,
    properties: {
        shellyID: SHELLY_ID,
        componentKey: COMPONENT_KEY,
        clearGlyph: {type: 'boolean'},
        clearColor: {type: 'boolean'},
        clearGradient: {type: 'boolean'},
        clearMeasurement: {type: 'boolean'},
        clearPromoted: {type: 'boolean'},
        clearImage: {type: 'boolean'}
    }
};

const P_DELETE: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'componentKey'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID, componentKey: COMPONENT_KEY}
};

const P_FETCH: JsonSchema = {
    type: 'object',
    required: ['shellyID'],
    additionalProperties: false,
    properties: {shellyID: SHELLY_ID}
};

// The whole device.virtual_metadata row — the DB function RETURNS the table
// type, and the handler passes the raw snake_case row through unmapped.
const RESP_ROW: JsonSchema = {
    type: 'object',
    required: [
        'organization_id',
        'host_shelly_id',
        'component_key',
        'glyph',
        'color',
        'gradient',
        'promoted_at',
        'image_path',
        'created',
        'updated',
        'measurement',
        'host_device_id'
    ],
    additionalProperties: false,
    properties: {
        organization_id: {type: 'string'},
        host_shelly_id: SHELLY_ID,
        component_key: COMPONENT_KEY,
        glyph: {type: ['string', 'null']},
        color: {type: ['string', 'null']},
        gradient: {anyOf: [GRADIENT, {type: 'null'}]},
        promoted_at: {type: ['string', 'null'], format: 'date-time'},
        image_path: {type: ['string', 'null'], format: 'uuid'},
        created: {type: 'string', format: 'date-time'},
        updated: {type: 'string', format: 'date-time'},
        measurement: {anyOf: [MEASUREMENT_META_SCHEMA, {type: 'null'}]},
        host_device_id: {type: 'integer'}
    }
};

// Clearing a component that has no row still returns one row, every column
// NULL — so on this call even the NOT NULL columns can come back null.
const RESP_CLEARED_ROW: JsonSchema = {
    ...RESP_ROW,
    properties: {
        ...(RESP_ROW.properties ?? {}),
        organization_id: {type: ['string', 'null']},
        host_shelly_id: {type: ['string', 'null']},
        component_key: {type: ['string', 'null']},
        created: {type: ['string', 'null'], format: 'date-time'},
        updated: {type: ['string', 'null'], format: 'date-time'},
        host_device_id: {type: ['integer', 'null']}
    }
};

const RESP_FETCH: JsonSchema = {
    type: 'object',
    required: ['items'],
    additionalProperties: false,
    properties: {items: {type: 'array', items: RESP_ROW}}
};

const RESP_VOID: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export interface VirtualMetaSetParams {
    shellyID: string;
    componentKey: string;
    glyph?: string;
    color?: string;
    gradient?: {
        angle?: number;
        stops: Array<{color: string; offset: number}>;
    };
    promoted?: boolean;
    imagePath?: string;
    measurement?: MeasurementMeta;
}

export interface VirtualMetaClearParams {
    shellyID: string;
    componentKey: string;
    clearGlyph?: boolean;
    clearColor?: boolean;
    clearGradient?: boolean;
    clearPromoted?: boolean;
    clearImage?: boolean;
    clearMeasurement?: boolean;
}

export interface VirtualMetaDeleteParams {
    shellyID: string;
    componentKey: string;
}

export interface VirtualMetaFetchParams {
    shellyID: string;
}

export const VIRTUAL_META_SET_PARAMS_SCHEMA = P_SET;
export const VIRTUAL_META_CLEAR_PARAMS_SCHEMA = P_CLEAR;
export const VIRTUAL_META_DELETE_PARAMS_SCHEMA = P_DELETE;
export const VIRTUAL_META_FETCH_PARAMS_SCHEMA = P_FETCH;

const b = new DescribeBuilder('virtual_meta', {
    kind: 'fleet-manager',
    description:
        'Manage fleet-manager measurement metadata for device virtual components.'
});

b.registerMethod('Set', {
    params: VIRTUAL_META_SET_PARAMS_SCHEMA,
    response: RESP_ROW,
    permission: PERM_UPDATE,
    description: 'virtual_meta.Set — upsert decoration for a virtual component.'
});
b.registerMethod('Clear', {
    params: VIRTUAL_META_CLEAR_PARAMS_SCHEMA,
    response: RESP_CLEARED_ROW,
    permission: PERM_UPDATE,
    description: 'virtual_meta.Clear — clear specific decoration fields.'
});
b.registerMethod('Delete', {
    params: VIRTUAL_META_DELETE_PARAMS_SCHEMA,
    response: RESP_VOID,
    permission: PERM_UPDATE,
    description: 'virtual_meta.Delete — drop the decoration row entirely.'
});
b.registerMethod('Fetch', {
    params: VIRTUAL_META_FETCH_PARAMS_SCHEMA,
    response: RESP_FETCH,
    permission: PERM_READ,
    description: 'virtual_meta.Fetch — all decoration rows for a host device.'
});
export const VIRTUAL_META_DESCRIBE: DescribeOutput = b.build();
