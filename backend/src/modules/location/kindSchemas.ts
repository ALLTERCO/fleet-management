// Per-kind JSON schemas. A location's kind determines which optional
// fields it accepts. `additionalProperties: false` guarantees the UI
// form can't submit unrelated fields for the wrong kind.

import type {JsonSchema} from '../../rpc/validation';
import type {LocationKind} from '../../types/api/location';

// ---- shared primitives ------------------------------------------------------

const ADDRESS_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: {
        streetName: {type: 'string', maxLength: 200},
        streetNumber: {type: 'string', maxLength: 32},
        city: {type: 'string', maxLength: 120},
        region: {type: 'string', maxLength: 120},
        postalCode: {type: 'string', maxLength: 32},
        countryCode: {type: 'string', pattern: '^[A-Z]{2}$'}
    }
};

export const LOCATION_GEO_SOURCES = [
    'manual',
    'autocomplete',
    'imported'
] as const;
export type LocationGeoSource = (typeof LOCATION_GEO_SOURCES)[number];

// How the coords were obtained — drives map-pin styling + edit affordances.
export const LOCATION_GEO_PRECISIONS = [
    'geocoded',
    'confirmed',
    'manual'
] as const;
export type LocationGeoPrecision = (typeof LOCATION_GEO_PRECISIONS)[number];

const GEO_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    required: ['lat', 'lng'],
    additionalProperties: false,
    properties: {
        lat: {type: 'number', minimum: -90, maximum: 90},
        lng: {type: 'number', minimum: -180, maximum: 180},
        source: {type: 'string', enum: [...LOCATION_GEO_SOURCES]},
        precision: {type: 'string', enum: [...LOCATION_GEO_PRECISIONS]},
        matchedName: {type: 'string', maxLength: 200},
        geonameid: {type: 'integer'},
        verifiedAt: {type: 'string', format: 'date-time'}
    }
};

const CONTACT_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['name'],
    properties: {
        name: {type: 'string', minLength: 1, maxLength: 120},
        role: {type: 'string', maxLength: 120},
        email: {type: 'string', format: 'email', maxLength: 255},
        phone: {type: 'string', maxLength: 40, pattern: '^\\+[0-9 \\-]{6,36}$'},
        afterHours: {type: 'boolean'}
    }
};

const WEEKDAY_WINDOW: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: {
        open: {type: 'string', pattern: '^[0-2][0-9]:[0-5][0-9]$'},
        close: {type: 'string', pattern: '^[0-2][0-9]:[0-5][0-9]$'},
        closed: {type: 'boolean'}
    }
};

const OPERATING_HOURS_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: {
        monday: WEEKDAY_WINDOW,
        tuesday: WEEKDAY_WINDOW,
        wednesday: WEEKDAY_WINDOW,
        thursday: WEEKDAY_WINDOW,
        friday: WEEKDAY_WINDOW,
        saturday: WEEKDAY_WINDOW,
        sunday: WEEKDAY_WINDOW,
        timezone: {type: 'string', maxLength: 120}
    }
};

const ENV_SETPOINT_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    properties: {
        tempMinC: {type: 'number', minimum: -40, maximum: 60},
        tempMaxC: {type: 'number', minimum: -40, maximum: 60},
        humidityMinPct: {type: 'number', minimum: 0, maximum: 100},
        humidityMaxPct: {type: 'number', minimum: 0, maximum: 100}
    }
};

const COMPLIANCE_TAGS: JsonSchema = {
    type: 'array',
    items: {type: 'string', minLength: 1, maxLength: 64},
    maxItems: 20
};

// Free-form user tags — same shape applies to every kind. Lowercase
// slug-like to keep them queryable + index-friendly. Limits mirror the
// frontend chip-input guard so the UI and backend reject the same payloads.
const TAGS_SCHEMA: JsonSchema = {
    type: 'array',
    items: {
        type: 'string',
        minLength: 1,
        maxLength: 32,
        pattern: '^[a-z0-9][a-z0-9._-]*$'
    },
    maxItems: 32
};

// Internal notes — single string per location. Length cap matches the
// frontend MAX_NOTES_LENGTH so the form's counter is the SoT.
const NOTES_SCHEMA: JsonSchema = {
    type: 'string',
    maxLength: 2000
};

const CUSTOM_FIELDS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: {
        type: ['string', 'number', 'boolean', 'null'],
        maxLength: 500
    },
    maxProperties: 32
};

// Visualisation: floor plan / device placement / zone overlay.
// Normalised coordinates (0..1) so the plan image can be resized without
// remapping pins or zones.

const FLOOR_PLAN_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['url', 'widthPx', 'heightPx'],
    properties: {
        url: {type: 'string', minLength: 1, maxLength: 2048},
        widthPx: {type: 'integer', minimum: 1, maximum: 50_000},
        heightPx: {type: 'integer', minimum: 1, maximum: 50_000}
    }
};

const PLACEMENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y'],
    properties: {
        x: {type: 'number', minimum: 0, maximum: 1},
        y: {type: 'number', minimum: 0, maximum: 1},
        rot: {type: 'number', minimum: 0, maximum: 360}
    }
};

const DEVICE_PLACEMENTS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: PLACEMENT_SCHEMA,
    maxProperties: 1000
};

const ZONE_POINT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['x', 'y'],
    properties: {
        x: {type: 'number', minimum: 0, maximum: 1},
        y: {type: 'number', minimum: 0, maximum: 1}
    }
};

const ZONE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'color', 'points'],
    properties: {
        id: {type: 'string', minLength: 1, maxLength: 64},
        name: {type: 'string', minLength: 1, maxLength: 120},
        // CSS hex color, optional alpha. Example: #aabb33 or #aabb3380.
        color: {type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$'},
        points: {
            type: 'array',
            minItems: 3,
            maxItems: 256,
            items: ZONE_POINT_SCHEMA
        }
    }
};

const ZONES_SCHEMA: JsonSchema = {
    type: 'array',
    maxItems: 100,
    items: ZONE_SCHEMA
};

// ---- field fragments --------------------------------------------------------

type FieldFragment = Record<string, JsonSchema>;

const TIMEZONE_FIELD: FieldFragment = {
    timezone: {type: 'string', maxLength: 120}
};
const COUNTRY_CODE_FIELD: FieldFragment = {
    countryCode: {type: 'string', pattern: '^[A-Z]{2}$'}
};
const CURRENCY_FIELD: FieldFragment = {
    currency: {type: 'string', pattern: '^[A-Z]{3}$'}
};
const REG_ZONE_FIELD: FieldFragment = {
    regulatoryZone: {type: 'string', minLength: 1, maxLength: 32}
};
const REGION_CODE_FIELD: FieldFragment = {
    regionCode: {type: 'string', pattern: '^[A-Z]{2}-[A-Z0-9]{1,3}$'}
};
const ADDRESS_FIELD: FieldFragment = {address: ADDRESS_SCHEMA};
const GEO_FIELD: FieldFragment = {geo: GEO_SCHEMA};
const OP_TIER_FIELD: FieldFragment = {
    operationalTier: {type: 'string', minLength: 1, maxLength: 32}
};
const OP_HOURS_FIELD: FieldFragment = {operatingHours: OPERATING_HOURS_SCHEMA};
const PRIMARY_CONTACT_FIELD: FieldFragment = {primaryContact: CONTACT_SCHEMA};
const EMERGENCY_CONTACT_FIELD: FieldFragment = {
    emergencyContact: CONTACT_SCHEMA
};
const COMPLIANCE_FIELD: FieldFragment = {complianceTags: COMPLIANCE_TAGS};
const ACCESS_FIELD: FieldFragment = {
    accessProcedure: {type: 'string', minLength: 1, maxLength: 32}
};
const SITE_TYPE_FIELD: FieldFragment = {
    siteType: {type: 'string', minLength: 1, maxLength: 32}
};
const BUILDING_TYPE_FIELD: FieldFragment = {
    buildingType: {type: 'string', minLength: 1, maxLength: 32}
};
const ROOM_TYPE_FIELD: FieldFragment = {
    roomType: {type: 'string', minLength: 1, maxLength: 32}
};
const FLOOR_COUNT_FIELD: FieldFragment = {
    floorCount: {type: 'integer', minimum: -5, maximum: 300}
};
const FLOOR_AREA_FIELD: FieldFragment = {
    grossFloorArea: {type: 'number', minimum: 0}
};
const YEAR_BUILT_FIELD: FieldFragment = {
    yearBuilt: {type: 'integer', minimum: 1500, maximum: 2200}
};
const ENERGY_CERT_FIELD: FieldFragment = {
    energyCertification: {type: 'string', minLength: 1, maxLength: 32}
};
const FLOOR_NUMBER_FIELD: FieldFragment = {
    floorNumber: {type: 'integer', minimum: -20, maximum: 300}
};
const ROOM_NUMBER_FIELD: FieldFragment = {
    roomNumber: {type: 'string', minLength: 1, maxLength: 32}
};
const CAPACITY_FIELD: FieldFragment = {
    capacity: {type: 'integer', minimum: 0, maximum: 100000}
};
const ENV_SETPOINT_FIELD: FieldFragment = {
    environmentalSetpoint: ENV_SETPOINT_SCHEMA
};
const CUSTOM_FIELDS_FIELD: FieldFragment = {customFields: CUSTOM_FIELDS_SCHEMA};
const TAGS_FIELD: FieldFragment = {tags: TAGS_SCHEMA};
const NOTES_FIELD: FieldFragment = {notes: NOTES_SCHEMA};
// Spatial visualisation triplet — applied to every kind that can host
// a floor plan / map (campus down to zone).
const VISUALIZATION_FIELDS: FieldFragment = {
    floorPlan: FLOOR_PLAN_SCHEMA,
    devicePlacements: DEVICE_PLACEMENTS_SCHEMA,
    zones: ZONES_SCHEMA
};

// ---- per-kind schemas -------------------------------------------------------
// Each entry enumerates ONLY the fields that logically apply to that kind.
// Inherited fields (timezone/countryCode/…) still live on the ancestor.

function kindSchema(props: Record<string, JsonSchema>): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            ...CUSTOM_FIELDS_FIELD,
            ...TAGS_FIELD,
            ...NOTES_FIELD,
            ...props
        }
    };
}

export const LOCATION_KIND_FIELD_SCHEMAS: Record<LocationKind, JsonSchema> = {
    continent: kindSchema({}),
    country: kindSchema({
        ...COUNTRY_CODE_FIELD,
        ...TIMEZONE_FIELD,
        ...CURRENCY_FIELD,
        ...REG_ZONE_FIELD,
        ...GEO_FIELD
    }),
    region: kindSchema({
        ...REGION_CODE_FIELD,
        ...TIMEZONE_FIELD,
        ...GEO_FIELD
    }),
    county: kindSchema({
        ...TIMEZONE_FIELD,
        ...GEO_FIELD
    }),
    city: kindSchema({
        ...TIMEZONE_FIELD,
        ...GEO_FIELD
    }),
    neighborhood: kindSchema({}),
    campus: kindSchema({
        ...ADDRESS_FIELD,
        ...GEO_FIELD,
        ...TIMEZONE_FIELD,
        ...OP_TIER_FIELD,
        ...OP_HOURS_FIELD,
        ...PRIMARY_CONTACT_FIELD,
        ...EMERGENCY_CONTACT_FIELD,
        ...COMPLIANCE_FIELD,
        ...ACCESS_FIELD,
        ...VISUALIZATION_FIELDS
    }),
    site: kindSchema({
        ...ADDRESS_FIELD,
        ...GEO_FIELD,
        ...TIMEZONE_FIELD,
        ...SITE_TYPE_FIELD,
        ...OP_TIER_FIELD,
        ...OP_HOURS_FIELD,
        ...PRIMARY_CONTACT_FIELD,
        ...EMERGENCY_CONTACT_FIELD,
        ...COMPLIANCE_FIELD,
        ...ACCESS_FIELD,
        ...VISUALIZATION_FIELDS
    }),
    building: kindSchema({
        ...ADDRESS_FIELD,
        ...GEO_FIELD,
        ...BUILDING_TYPE_FIELD,
        ...FLOOR_COUNT_FIELD,
        ...FLOOR_AREA_FIELD,
        ...YEAR_BUILT_FIELD,
        ...ENERGY_CERT_FIELD,
        ...OP_HOURS_FIELD,
        ...PRIMARY_CONTACT_FIELD,
        ...EMERGENCY_CONTACT_FIELD,
        ...COMPLIANCE_FIELD,
        ...ACCESS_FIELD,
        ...VISUALIZATION_FIELDS
    }),
    office: kindSchema({
        ...ROOM_NUMBER_FIELD,
        ...FLOOR_NUMBER_FIELD,
        ...FLOOR_AREA_FIELD,
        ...CAPACITY_FIELD,
        ...PRIMARY_CONTACT_FIELD,
        ...OP_HOURS_FIELD,
        ...COMPLIANCE_FIELD,
        ...ACCESS_FIELD,
        ...VISUALIZATION_FIELDS
    }),
    floor: kindSchema({
        ...FLOOR_NUMBER_FIELD,
        ...FLOOR_AREA_FIELD,
        ...VISUALIZATION_FIELDS
    }),
    area: kindSchema({
        ...FLOOR_AREA_FIELD,
        ...VISUALIZATION_FIELDS
    }),
    room: kindSchema({
        ...ROOM_NUMBER_FIELD,
        ...ROOM_TYPE_FIELD,
        ...CAPACITY_FIELD,
        ...ENV_SETPOINT_FIELD,
        ...COMPLIANCE_FIELD,
        ...ACCESS_FIELD,
        ...VISUALIZATION_FIELDS
    }),
    zone: kindSchema({
        ...CAPACITY_FIELD,
        ...ENV_SETPOINT_FIELD,
        ...VISUALIZATION_FIELDS
    })
};
