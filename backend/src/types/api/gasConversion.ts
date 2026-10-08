import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const ID_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {id: {type: 'integer'}}
};
const PAGE_PARAMS: Record<string, JsonSchema> = {
    limit: {type: 'integer', minimum: 1, maximum: 100, default: 100},
    beforeId: {type: 'integer', minimum: 1}
};
const NEXT_BEFORE_ID: JsonSchema = {
    type: ['integer', 'null'],
    minimum: 1
};
export const GAS_ZONE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'zoneKind', 'externalCode', 'timezone', 'dayBoundary'],
    properties: {
        name: {type: 'string', minLength: 1, maxLength: 120},
        zoneKind: {type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$'},
        externalCode: {type: 'string', minLength: 1, maxLength: 120},
        timezone: {type: 'string', minLength: 1, maxLength: 64},
        dayBoundary: {
            type: 'string',
            pattern: '^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$'
        }
    }
};
export const GAS_PROFILE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'deviceExternalId',
        'channel',
        'pricingZoneId',
        'meteredUnit',
        'billedUnit',
        'volumeState',
        'correctionMode',
        'energyDivisor',
        'effectiveFrom',
        'sourceReference'
    ],
    properties: {
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 255},
        channel: {type: ['integer', 'null'], minimum: 0, maximum: 32767},
        pricingZoneId: {type: 'integer', minimum: 1},
        meteredUnit: {type: 'string', enum: ['m3', 'ft3', 'ccf']},
        billedUnit: {type: 'string', enum: ['kWh', 'therm', 'MMBtu', 'GJ']},
        volumeState: {type: 'string', enum: ['corrected', 'uncorrected']},
        correctionMode: {
            type: 'string',
            enum: [
                'none',
                'statutory_constant',
                'altitude_formula',
                'zone_table',
                'computed_PZ',
                'computed_TPZ'
            ]
        },
        correctionFactor: {type: ['number', 'null'], exclusiveMinimum: 0},
        metricFactor: {type: ['number', 'null'], exclusiveMinimum: 0},
        energyDivisor: {type: 'number', exclusiveMinimum: 0},
        effectiveFrom: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
        effectiveTo: {
            type: ['string', 'null'],
            pattern: '^\\d{4}-\\d{2}-\\d{2}$'
        },
        sourceReference: {type: 'string', minLength: 1, maxLength: 500},
        // Why the figures may contradict their units. Blank or whitespace-only
        // excuses nothing, so the pattern demands a non-space at each end.
        unitOverrideReason: {
            type: 'string',
            pattern: '^\\S(?:[\\s\\S]*\\S)?$',
            maxLength: 500
        },
        revision: {type: 'integer', minimum: 1}
    }
};
export const GAS_CV_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'pricingZoneId',
        'gasDay',
        'value',
        'unit',
        'weighting',
        'roundingRule',
        'revision',
        'publishedAt',
        'sourceReference'
    ],
    properties: {
        pricingZoneId: {type: 'integer', minimum: 1},
        gasDay: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
        value: {type: 'number', exclusiveMinimum: 0},
        unit: {type: 'string', enum: ['MJ/m3', 'kWh/m3']},
        weighting: {type: 'string', enum: ['none', 'quantity']},
        roundingRule: {type: 'string', enum: ['none', 'truncate_0_1']},
        revision: {type: 'integer', minimum: 1},
        publishedAt: {type: 'string', format: 'date-time'},
        sourceReference: {type: 'string', minLength: 1, maxLength: 500}
    }
};

const GAS_ZONE_RECORD_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'name',
        'zoneKind',
        'externalCode',
        'timezone',
        'dayBoundary'
    ],
    properties: {
        id: {type: 'integer', minimum: 1},
        ...GAS_ZONE_SCHEMA.properties
    }
};
const GAS_PROFILE_RECORD_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', ...GAS_PROFILE_SCHEMA.required!, 'revision', 'createdAt'],
    properties: {
        id: {type: 'integer', minimum: 1},
        ...GAS_PROFILE_SCHEMA.properties,
        createdAt: {type: 'string', format: 'date-time'}
    }
};
const GAS_CV_RECORD_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', ...GAS_CV_SCHEMA.required!, 'createdAt'],
    properties: {
        id: {type: 'integer', minimum: 1},
        ...GAS_CV_SCHEMA.properties,
        createdAt: {type: 'string', format: 'date-time'}
    }
};

function pageResponse(item: JsonSchema): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'nextBeforeId'],
        properties: {
            items: {type: 'array', maxItems: 100, items: item},
            nextBeforeId: NEXT_BEFORE_ID
        }
    };
}

export const GAS_ZONE_LIST_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: PAGE_PARAMS
};
export const GAS_PROFILE_LIST_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 255},
        channel: {type: 'integer', minimum: 0, maximum: 32767},
        ...PAGE_PARAMS
    }
};
export const GAS_CV_LIST_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        pricingZoneId: {type: 'integer', minimum: 1},
        gasDayFrom: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
        gasDayTo: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
        ...PAGE_PARAMS
    }
};

export const GAS_CONVERSION_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'gasConversion',
    {
        kind: 'fleet-manager',
        description: 'Versioned gas volume-to-energy conversion configuration.'
    }
)
    .registerMethod('UpsertZone', {
        params: GAS_ZONE_SCHEMA,
        response: ID_RESPONSE,
        permission: {component: 'reports', operation: 'update'}
    })
    .registerMethod('UpsertProfile', {
        params: GAS_PROFILE_SCHEMA,
        response: ID_RESPONSE,
        permission: {component: 'reports', operation: 'update'}
    })
    .registerMethod('AddCalorificValue', {
        params: GAS_CV_SCHEMA,
        response: ID_RESPONSE,
        permission: {component: 'reports', operation: 'update'}
    })
    .registerMethod('ListZones', {
        params: GAS_ZONE_LIST_SCHEMA,
        response: pageResponse(GAS_ZONE_RECORD_SCHEMA),
        permission: {component: 'reports', operation: 'read'}
    })
    .registerMethod('ListProfiles', {
        params: GAS_PROFILE_LIST_SCHEMA,
        response: pageResponse(GAS_PROFILE_RECORD_SCHEMA),
        permission: {component: 'reports', operation: 'read'}
    })
    .registerMethod('ListCalorificValues', {
        params: GAS_CV_LIST_SCHEMA,
        response: pageResponse(GAS_CV_RECORD_SCHEMA),
        permission: {component: 'reports', operation: 'read'}
    })
    .build();
