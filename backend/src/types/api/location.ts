/** Public API types for the `location.*` namespace — physical scope hierarchy.
 *  Per-kind field model: each kind (continent/country/site/building/room/…)
 *  accepts only the fields that logically apply. See
 *  modules/location/kindSchemas.ts for the source of truth. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    MAX_BATCH_SIZE,
    NAME_SCHEMA,
    ORG_ID_SCHEMA,
    SUMMARY_COUNTS_SCHEMA,
    type SummaryCounts
} from './_shared';
import {
    LOCATION_UPLOAD_TICKET_PARAMS_SCHEMA,
    UPLOAD_TICKET_RESPONSE_SCHEMA
} from './upload';

// Sync with CHECK constraint in 2002_locations.sql.
export type LocationKind =
    | 'continent'
    | 'country'
    | 'region'
    | 'county'
    | 'city'
    | 'neighborhood'
    | 'campus'
    | 'site'
    | 'building'
    | 'office'
    | 'floor'
    | 'area'
    | 'room'
    | 'zone';

export const LOCATION_KINDS: readonly LocationKind[] = [
    'continent',
    'country',
    'region',
    'county',
    'city',
    'neighborhood',
    'campus',
    'site',
    'building',
    'office',
    'floor',
    'area',
    'room',
    'zone'
] as const;

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
    continent: 'Continent',
    country: 'Country',
    region: 'Region / State',
    county: 'County',
    city: 'City',
    neighborhood: 'Neighborhood',
    campus: 'Campus',
    site: 'Site',
    building: 'Building',
    office: 'Office / Suite',
    floor: 'Floor',
    area: 'Area / Wing',
    room: 'Room',
    zone: 'Zone'
};

/** Free-form key/value escape hatch for org-specific metadata the built-in
 *  kind schema doesn't cover. Validated in modules/location/kindSchemas.ts. */
export type LocationCustomFields = Record<
    string,
    string | number | boolean | null
>;

/** The per-kind validated object. Shape depends on `kind` — see descriptors. */
export type LocationKindFields = Record<string, unknown>;

/** Resolved values after walking the parent chain — read-side only. */
export interface LocationEffective {
    timezone: string | null;
    countryCode: string | null;
    currency: string | null;
    regulatoryZone: string | null;
    complianceTags: readonly string[];
}

export type LocationCoordinateState =
    | 'mapped'
    | 'address_only'
    | 'missing_address';

export interface LocationCoordinateStatus {
    state: LocationCoordinateState;
    summary: string;
}

export interface Location {
    id: number;
    organizationId: string;
    name: string;
    kind: LocationKind;
    parentLocationId: number | null;
    sortOrder: number;
    kindFields: LocationKindFields;
    customFields: LocationCustomFields;
    effective: LocationEffective;
    coordinateStatus: LocationCoordinateStatus;
    createdAt: string;
    updatedAt: string | null;
    counts?: SummaryCounts;
}

// ---- shared schema primitives ----------------------------------------------

const KIND_SCHEMA: JsonSchema = {type: 'string', enum: [...LOCATION_KINDS]};

const KIND_FIELDS_SCHEMA: JsonSchema = {
    type: 'object',
    // Per-kind properties enforced by the validator; this is the permissive
    // surface the RPC schema accepts.
    additionalProperties: true
};

const CUSTOM_FIELDS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: {
        type: ['string', 'number', 'boolean', 'null']
    },
    maxProperties: 32
};

const EFFECTIVE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'timezone',
        'countryCode',
        'currency',
        'regulatoryZone',
        'complianceTags'
    ],
    properties: {
        timezone: {type: ['string', 'null']},
        countryCode: {type: ['string', 'null']},
        currency: {type: ['string', 'null']},
        regulatoryZone: {type: ['string', 'null']},
        complianceTags: {type: 'array', items: {type: 'string'}}
    }
};

const COORDINATE_STATUS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['state', 'summary'],
    properties: {
        state: {
            type: 'string',
            enum: ['mapped', 'address_only', 'missing_address']
        },
        summary: {type: 'string'}
    }
};

const LOCATION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'organizationId',
        'name',
        'kind',
        'parentLocationId',
        'sortOrder',
        'kindFields',
        'customFields',
        'effective',
        'coordinateStatus',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        id: {type: 'integer'},
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        kind: KIND_SCHEMA,
        parentLocationId: {type: ['integer', 'null']},
        sortOrder: {type: 'integer'},
        kindFields: KIND_FIELDS_SCHEMA,
        customFields: CUSTOM_FIELDS_SCHEMA,
        effective: EFFECTIVE_SCHEMA,
        coordinateStatus: COORDINATE_STATUS_SCHEMA,
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']},
        counts: SUMMARY_COUNTS_SCHEMA
    }
};

export const LOCATION_CREATE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['name', 'kind'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        name: NAME_SCHEMA,
        kind: KIND_SCHEMA,
        parentLocationId: {type: ['integer', 'null']},
        sortOrder: {type: 'integer'},
        kindFields: KIND_FIELDS_SCHEMA,
        customFields: CUSTOM_FIELDS_SCHEMA
    }
};

export const LOCATION_UPDATE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        name: NAME_SCHEMA,
        parentLocationId: {type: ['integer', 'null']},
        sortOrder: {type: 'integer'},
        kindFields: KIND_FIELDS_SCHEMA,
        customFields: CUSTOM_FIELDS_SCHEMA
    }
};

export const LOCATION_DELETE_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const LOCATION_GET_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        includeSummary: {type: 'boolean'}
    }
};

export const LOCATION_LIST_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        parentLocationId: {type: ['integer', 'null']},
        kind: KIND_SCHEMA,
        rootsOnly: {type: 'boolean'},
        query: {type: 'string', minLength: 1, maxLength: 120},
        limit: {type: 'integer', minimum: 1, maximum: 1000},
        offset: {type: 'integer', minimum: 0},
        includeSummary: {type: 'boolean'},
        // When true, resolve inherited timezone/country/currency/regulatoryZone
        // + union compliance tags from each row's ancestor chain in one SQL
        // round-trip (fn_location_resolve_effective_many). Without it rows
        // carry only self fields.
        includeEffective: {type: 'boolean'}
    }
};

const LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: LOCATION_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

const DELETED_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};

// Signal heatmap (live RSSI projected onto location geo).

export const LOCATION_SIGNAL_HEATMAP_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA
    }
};

const HEATMAP_POINT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['lat', 'lng', 'weight'],
    properties: {
        lat: {type: 'number', minimum: -90, maximum: 90},
        lng: {type: 'number', minimum: -180, maximum: 180},
        weight: {type: 'number', minimum: 0, maximum: 1}
    }
};

export const LOCATION_SIGNAL_HEATMAP_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['points'],
    properties: {
        points: {type: 'array', items: HEATMAP_POINT_SCHEMA}
    }
};

// Event replay (deck.gl TripsLayer-shaped per-device paths through time).

export const LOCATION_EVENT_REPLAY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['from', 'to'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        from: {type: 'string', description: 'ISO-8601 inclusive start'},
        to: {type: 'string', description: 'ISO-8601 exclusive end'},
        eventTypes: {
            type: 'array',
            maxItems: 16,
            items: {type: 'string', minLength: 1, maxLength: 64}
        },
        maxDevices: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            default: 200
        }
    }
};

const TRIP_PATH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'path', 'timestamps'],
    properties: {
        id: {type: 'string'},
        path: {
            type: 'array',
            items: {
                type: 'array',
                minItems: 2,
                maxItems: 2,
                items: {type: 'number'}
            }
        },
        timestamps: {type: 'array', items: {type: 'number'}}
    }
};

export const LOCATION_EVENT_REPLAY_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['trips'],
    properties: {
        trips: {type: 'array', items: TRIP_PATH_SCHEMA}
    }
};

// Devices, entities, and device-groups each map to a single location. A group
// assignment rolls up to its member devices for "devices in this location".
export const LOCATION_SUBJECT_TYPES = ['device', 'entity', 'group'] as const;
export type LocationSubjectType = (typeof LOCATION_SUBJECT_TYPES)[number];

export interface LocationAssignment {
    organizationId: string;
    subjectType: LocationSubjectType;
    subjectId: string;
    locationId: number;
    createdAt: string;
    updatedAt: string | null;
}

export interface LocationBreadcrumbEntry {
    id: number;
    name: string;
    kind: LocationKind;
}

const SUBJECT_TYPE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...LOCATION_SUBJECT_TYPES]
};
const SUBJECT_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 255
};

const ASSIGNMENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'organizationId',
        'subjectType',
        'subjectId',
        'locationId',
        'createdAt',
        'updatedAt'
    ],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        subjectType: SUBJECT_TYPE_SCHEMA,
        subjectId: SUBJECT_ID_SCHEMA,
        locationId: {type: 'integer'},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

const BREADCRUMB_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'kind'],
    properties: {
        id: {type: 'integer'},
        name: {type: 'string'},
        kind: KIND_SCHEMA
    }
};

const ASSIGNMENT_LIST_ENVELOPE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {type: 'array', items: ASSIGNMENT_SCHEMA},
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};

export const LOCATION_CHILDREN_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'},
        limit: {type: 'integer', minimum: 1, maximum: 1000},
        offset: {type: 'integer', minimum: 0},
        includeSummary: {type: 'boolean'},
        includeEffective: {type: 'boolean'}
    }
};

export const LOCATION_PATH_PARAMS: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        id: {type: 'integer'}
    }
};

export const LOCATION_SET_ASSIGNMENT_PARAMS: JsonSchema = {
    type: 'object',
    required: ['subjectType', 'subjectId', 'locationId'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        subjectType: SUBJECT_TYPE_SCHEMA,
        subjectId: SUBJECT_ID_SCHEMA,
        locationId: {type: 'integer'}
    }
};

// Batch: assign many subjects to ONE location in one atomic call.
export const LOCATION_SET_ASSIGNMENTS_PARAMS: JsonSchema = {
    type: 'object',
    required: ['locationId', 'subjects'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        locationId: {type: 'integer'},
        subjects: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_BATCH_SIZE,
            items: {
                type: 'object',
                required: ['subjectType', 'subjectId'],
                additionalProperties: false,
                properties: {
                    subjectType: SUBJECT_TYPE_SCHEMA,
                    subjectId: SUBJECT_ID_SCHEMA
                }
            }
        }
    }
};

export const LOCATION_SET_ASSIGNMENTS_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['locationId', 'assigned'],
    properties: {
        locationId: {type: 'integer'},
        assigned: {type: 'array', items: ASSIGNMENT_SCHEMA}
    }
};

export const LOCATION_REMOVE_ASSIGNMENT_PARAMS: JsonSchema = {
    type: 'object',
    required: ['subjectType', 'subjectId'],
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        subjectType: SUBJECT_TYPE_SCHEMA,
        subjectId: SUBJECT_ID_SCHEMA
    }
};

export const LOCATION_LIST_ASSIGNMENTS_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        subjectType: SUBJECT_TYPE_SCHEMA,
        subjectId: SUBJECT_ID_SCHEMA,
        locationId: {type: 'integer'},
        locationIds: {
            type: 'array',
            items: {type: 'integer'},
            minItems: 1,
            maxItems: 1000
        },
        limit: {type: 'integer', minimum: 1, maximum: 1000},
        offset: {type: 'integer', minimum: 0}
    }
};

export const LOCATION_LIST_KINDS_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

const OPTION_SET_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['field', 'kind', 'values', 'allowCustom', 'multi'],
    properties: {
        field: {type: 'string'},
        kind: {type: 'string', enum: ['enum', 'combobox', 'iso']},
        values: {type: 'array', items: {type: 'string'}},
        allowCustom: {type: 'boolean'},
        multi: {type: 'boolean'}
    }
};

const FIELD_DESCRIPTOR_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'label', 'description', 'group', 'widget'],
    properties: {
        key: {type: 'string'},
        label: {type: 'string'},
        description: {type: 'string'},
        group: {
            type: 'string',
            enum: [
                'identity',
                'physical',
                'contact',
                'hours',
                'compliance',
                'operational',
                'environmental',
                'custom'
            ]
        },
        widget: {
            type: 'string',
            enum: [
                'text',
                'number',
                'iso',
                'combobox',
                'multiCombobox',
                'address',
                'geo',
                'contact',
                'operatingHours',
                'environmentalSetpoint'
            ]
        },
        optionSet: {type: 'string'},
        min: {type: 'number'},
        max: {type: 'number'},
        pattern: {type: 'string'},
        unit: {type: 'string'},
        placeholder: {type: 'string'}
    }
};

const KIND_DESCRIPTOR_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'kind',
        'label',
        'allowedParents',
        'allowRoot',
        'fields',
        'inheritableFields',
        'sortRank'
    ],
    properties: {
        kind: KIND_SCHEMA,
        label: {type: 'string'},
        allowedParents: {type: 'array', items: KIND_SCHEMA},
        allowRoot: {type: 'boolean'},
        fields: {type: 'array', items: FIELD_DESCRIPTOR_SCHEMA},
        inheritableFields: {type: 'array', items: {type: 'string'}},
        sortRank: {type: 'integer'}
    }
};

const LIST_KINDS_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kinds', 'optionSets'],
    properties: {
        kinds: {type: 'array', items: KIND_DESCRIPTOR_SCHEMA},
        optionSets: {
            type: 'object',
            additionalProperties: OPTION_SET_SCHEMA
        }
    }
};

// ── Geocoding / place search (GeoNames Postgres + Nominatim fallback) ───────

export type GeocodeSource = 'local' | 'cache' | 'nominatim' | 'local-weak';
export type GeocodeKind = 'country' | 'admin' | 'city' | 'street';

export interface GeocodeCandidate {
    kind: GeocodeKind;
    geonameid?: number;
    name: string;
    asciiname?: string;
    countryCode: string;
    countryName?: string;
    adminCode?: string;
    adminName?: string;
    // Street-level fields (Nominatim only); absent for country/admin/city.
    city?: string;
    streetName?: string;
    houseNumber?: string;
    postalCode?: string;
    lat: number;
    lng: number;
    timezone?: string;
    weight: number;
    score: number;
}

export interface LocationSearchPlacesParams {
    query: string;
    biasCountryCode?: string;
    limit?: number;
    precision?: 'place' | 'street';
}

export const LOCATION_SEARCH_PLACES_PARAMS: JsonSchema = {
    type: 'object',
    required: ['query'],
    additionalProperties: false,
    properties: {
        query: {type: 'string', minLength: 1, maxLength: 200},
        biasCountryCode: {type: 'string', pattern: '^[A-Z]{2}$'},
        limit: {type: 'integer', minimum: 1, maximum: 25},
        precision: {type: 'string', enum: ['place', 'street']}
    }
};

const GEOCODE_CANDIDATE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['kind', 'name', 'countryCode', 'lat', 'lng', 'weight', 'score'],
    properties: {
        kind: {type: 'string', enum: ['country', 'admin', 'city', 'street']},
        geonameid: {type: 'integer'},
        name: {type: 'string'},
        asciiname: {type: 'string'},
        countryCode: {type: 'string'},
        countryName: {type: 'string'},
        adminCode: {type: 'string'},
        adminName: {type: 'string'},
        city: {type: 'string'},
        streetName: {type: 'string'},
        houseNumber: {type: 'string'},
        postalCode: {type: 'string'},
        lat: {type: 'number'},
        lng: {type: 'number'},
        timezone: {type: 'string'},
        weight: {type: 'number'},
        score: {type: 'number'}
    }
};

export const LOCATION_SEARCH_PLACES_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['candidates', 'source'],
    properties: {
        candidates: {type: 'array', items: GEOCODE_CANDIDATE_SCHEMA},
        source: {
            type: 'string',
            enum: ['local', 'cache', 'nominatim', 'local-weak']
        }
    }
};

export const LOCATION_LIST_COUNTRIES_PARAMS: JsonSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false
};

export interface CountryEntry {
    iso2: string;
    iso3: string;
    name: string;
    continent: string;
    capital?: string;
    lat?: number;
    lng?: number;
}

export const LOCATION_LIST_COUNTRIES_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['countries'],
    properties: {
        countries: {
            type: 'array',
            items: {
                type: 'object',
                required: ['iso2', 'iso3', 'name', 'continent'],
                properties: {
                    iso2: {type: 'string'},
                    iso3: {type: 'string'},
                    name: {type: 'string'},
                    continent: {type: 'string'},
                    capital: {type: 'string'},
                    lat: {type: 'number'},
                    lng: {type: 'number'}
                }
            }
        }
    }
};

export interface LocationListRegionsParams {
    countryCode: string;
}

export interface LocationBackfillGeoParams {
    organizationId?: string;
    batchSize?: number;
    forceRefresh?: boolean;
}

export const LOCATION_BACKFILL_GEO_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA,
        batchSize: {type: 'integer', minimum: 1, maximum: 50},
        forceRefresh: {type: 'boolean'}
    }
};

export interface BackfillGeoError {
    locationId: number;
    reason: string;
}

export interface BackfillGeoSummary {
    processed: number;
    updated: number;
    skipped: number;
    unresolved: number;
    remaining: number;
    errors: BackfillGeoError[];
}

export const LOCATION_BACKFILL_GEO_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'processed',
        'updated',
        'skipped',
        'unresolved',
        'remaining',
        'errors'
    ],
    properties: {
        processed: {type: 'integer', minimum: 0},
        updated: {type: 'integer', minimum: 0},
        skipped: {type: 'integer', minimum: 0},
        unresolved: {type: 'integer', minimum: 0},
        remaining: {type: 'integer', minimum: 0},
        errors: {
            type: 'array',
            items: {
                type: 'object',
                required: ['locationId', 'reason'],
                properties: {
                    locationId: {type: 'integer'},
                    reason: {type: 'string'}
                }
            }
        }
    }
};

export const LOCATION_LIST_REGIONS_PARAMS: JsonSchema = {
    type: 'object',
    required: ['countryCode'],
    additionalProperties: false,
    properties: {
        countryCode: {type: 'string', pattern: '^[A-Z]{2}$'}
    }
};

export interface RegionEntry {
    code: string;
    countryCode: string;
    name: string;
    lat: number;
    lng: number;
}

export const LOCATION_LIST_REGIONS_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['regions'],
    properties: {
        regions: {
            type: 'array',
            items: {
                type: 'object',
                required: ['code', 'countryCode', 'name', 'lat', 'lng'],
                properties: {
                    code: {type: 'string'},
                    countryCode: {type: 'string'},
                    name: {type: 'string'},
                    lat: {type: 'number'},
                    lng: {type: 'number'}
                }
            }
        }
    }
};

export const LOCATION_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'location',
    {
        kind: 'fleet-manager',
        description:
            'Manage the physical location hierarchy, assignments, geocoding, and map overlays.'
    }
)
    .registerMethod('Create', {
        params: LOCATION_CREATE_PARAMS,
        response: LOCATION_SCHEMA,
        permission: {component: 'locations', operation: 'create'},
        description:
            'Create a location. kindFields is validated against the per-kind schema returned by Location.ListKinds. Unique sibling-name per parent.'
    })
    .registerMethod('Update', {
        params: LOCATION_UPDATE_PARAMS,
        response: LOCATION_SCHEMA,
        permission: {component: 'locations', operation: 'update'},
        description:
            'Partial-update a location. Cycle-safe parent changes. kindFields replaces the stored object.'
    })
    .registerMethod('Delete', {
        params: LOCATION_DELETE_PARAMS,
        response: DELETED_SCHEMA,
        permission: {component: 'locations', operation: 'delete'},
        description:
            'Delete a location. Blocked if it has children or assignments.'
    })
    .registerMethod('Get', {
        params: LOCATION_GET_PARAMS,
        response: LOCATION_SCHEMA,
        permission: {component: 'locations', operation: 'read'},
        description:
            'Fetch one location by id with inherited effective fields resolved.'
    })
    .registerMethod('List', {
        params: LOCATION_LIST_PARAMS,
        response: LIST_ENVELOPE,
        permission: {component: 'locations', operation: 'read'},
        description:
            'List locations. Optional parent filter: omit = all, null = roots only, integer = children of that parent.'
    })
    .registerMethod('Children', {
        params: LOCATION_CHILDREN_PARAMS,
        response: LIST_ENVELOPE,
        permission: {component: 'locations', operation: 'read'},
        description: 'Direct children of the given location.'
    })
    .registerMethod('Path', {
        params: LOCATION_PATH_PARAMS,
        response: {
            type: 'object',
            required: ['items'],
            properties: {
                items: {type: 'array', items: BREADCRUMB_ENTRY_SCHEMA}
            }
        },
        permission: {component: 'locations', operation: 'read'},
        description: 'Breadcrumb from root to the given location.'
    })
    .registerMethod('ListKinds', {
        safety: {operation: 'read'},
        params: LOCATION_LIST_KINDS_PARAMS,
        response: LIST_KINDS_RESPONSE,
        permission: {note: 'authenticated'},
        description:
            'Per-kind field descriptors + option-set snapshots. Frontend renders the Create/Update form from this response.'
    })
    .registerMethod('SearchPlaces', {
        params: LOCATION_SEARCH_PLACES_PARAMS,
        response: LOCATION_SEARCH_PLACES_RESPONSE,
        permission: {component: 'locations', operation: 'read'},
        description:
            'Typeahead place lookup over GeoNames (countries, admin, cities) with Nominatim fallback.'
    })
    .registerMethod('ListCountries', {
        safety: {operation: 'read'},
        params: LOCATION_LIST_COUNTRIES_PARAMS,
        response: LOCATION_LIST_COUNTRIES_RESPONSE,
        permission: {note: 'authenticated'},
        description:
            'All countries from the GeoNames reference. Cached at boot.'
    })
    .registerMethod('ListRegions', {
        safety: {operation: 'read'},
        params: LOCATION_LIST_REGIONS_PARAMS,
        response: LOCATION_LIST_REGIONS_RESPONSE,
        permission: {note: 'authenticated'},
        description:
            'First-level admin divisions (state/province/region) for a country.'
    })
    .registerMethod('BackfillGeo', {
        params: LOCATION_BACKFILL_GEO_PARAMS,
        response: LOCATION_BACKFILL_GEO_RESPONSE,
        permission: {component: 'locations', operation: 'update'},
        description:
            'Resolve missing geo coords for legacy locations. Paginated; call repeatedly until remaining=0.'
    })
    .registerMethod('FloorPlan.CreateUploadTicket', {
        params: LOCATION_UPLOAD_TICKET_PARAMS_SCHEMA,
        response: UPLOAD_TICKET_RESPONSE_SCHEMA,
        permission: {component: 'locations', operation: 'update'},
        description:
            'Mint a short-lived ticket for POST /api/uploads/floor-plan.'
    })
    .registerMethod('SignalHeatmap', {
        params: LOCATION_SIGNAL_HEATMAP_PARAMS,
        response: LOCATION_SIGNAL_HEATMAP_RESPONSE,
        permission: {component: 'locations', operation: 'read'},
        description:
            'Live device RSSI projected onto location geo as {lat,lng,weight} heatmap points. Weight is 0..1 (RSSI normalised from -100..-30 dBm). Only devices assigned to a geo-equipped location are included.'
    })
    .registerMethod('EventReplay', {
        params: LOCATION_EVENT_REPLAY_PARAMS,
        response: LOCATION_EVENT_REPLAY_RESPONSE,
        permission: {component: 'locations', operation: 'read'},
        description:
            'Windowed per-device audit events projected onto location geo. Returns deck.gl TripsLayer-shaped {id, path:[[lng,lat]…], timestamps:[secs…]}. Useful for fleet event playback (online/offline, RPC, alerts) over a map.'
    })
    .registerMethod('SetAssignment', {
        params: LOCATION_SET_ASSIGNMENT_PARAMS,
        response: ASSIGNMENT_SCHEMA,
        permission: {component: 'locations', operation: 'update'},
        description: 'Upsert primary location assignment for a device/entity.'
    })
    .registerMethod('SetAssignments', {
        params: LOCATION_SET_ASSIGNMENTS_PARAMS,
        response: LOCATION_SET_ASSIGNMENTS_RESPONSE,
        permission: {component: 'locations', operation: 'update'},
        description:
            'Assign many subjects to one location in a single atomic call.'
    })
    .registerMethod('RemoveAssignment', {
        params: LOCATION_REMOVE_ASSIGNMENT_PARAMS,
        response: {
            type: 'object',
            required: ['removed'],
            properties: {
                removed: {type: 'boolean'},
                assignment: {oneOf: [ASSIGNMENT_SCHEMA, {type: 'null'}]}
            }
        },
        permission: {component: 'locations', operation: 'update'},
        description:
            'Remove the primary location assignment for a device/entity. removed=false if no assignment existed.'
    })
    .registerMethod('ListAssignments', {
        params: LOCATION_LIST_ASSIGNMENTS_PARAMS,
        response: ASSIGNMENT_LIST_ENVELOPE,
        permission: {component: 'locations', operation: 'read'},
        description: 'List location assignments with optional filters.'
    })
    .build();
