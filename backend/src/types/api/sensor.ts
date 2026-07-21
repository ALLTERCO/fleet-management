// Sensor.* — cross-device read of device_sensor time-series. Two methods:
//   - Query  — numeric history (temperature/humidity/co2/pressure/...) from the
//              forever 15-minute rollup (device_sensor.numeric_15min). The
//              numeric twin of Events; mirrors Energy.Query's scope/bucket/
//              pagination shape. Energy.Query still exposes the same readings
//              for the dashboard until its env branch is migrated here.
//   - Events — discrete state changes (door/window/motion/flood/smoke/button/
//              ...), append-only with no bucket dimension.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema, JsonSchemaType} from './_schema';
import {ENERGY_BUCKETS, type EnergyBucket} from './energy';
import {DASHBOARD_SCOPE_SCHEMA, type DashboardScope} from './fleet';

export const SENSOR_EVENTS_LIMITS = {
    maxDevicesPerQuery: 500,
    defaultRowLimit: 5_000,
    maxRowLimit: 20_000
} as const;

export interface SensorEventsParams {
    /** ISO-8601 inclusive start timestamp */
    from: string;
    /** ISO-8601 exclusive end timestamp */
    to: string;
    /** shellyID allowlist — the device(s) to read events for */
    devices: string[];
    /**
     * Event kind filter (door/window/motion/flood/smoke/button/...). Free-
     * form: the device_sensor.events kind vocabulary is derived from
     * BTHomeData.ts sensor names plus native binary components, not a
     * fixed enum — a hardcoded list here would silently go stale.
     */
    kind?: string;
    /** Page size — defaults to 5000, max 20000 */
    limit?: number;
}

export const SENSOR_EVENTS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['from', 'to', 'devices'],
    additionalProperties: false,
    properties: {
        from: {type: 'string', minLength: 1, description: 'ISO-8601 start'},
        to: {type: 'string', minLength: 1, description: 'ISO-8601 end'},
        devices: {
            type: 'array',
            minItems: 1,
            maxItems: SENSOR_EVENTS_LIMITS.maxDevicesPerQuery,
            items: {type: 'string', minLength: 1},
            description: 'shellyID allowlist'
        },
        kind: {
            type: 'string',
            minLength: 1,
            maxLength: 24,
            description: 'Event kind filter — omit for every kind'
        },
        limit: {
            type: 'integer',
            minimum: 1,
            maximum: SENSOR_EVENTS_LIMITS.maxRowLimit
        }
    }
};

export interface SensorEventRow {
    /** Event timestamp (ISO-8601) */
    ts: string;
    /** Internal device id */
    device: number;
    /** Device shellyID */
    shellyID: string | null;
    /** Reading source: internal/builtin/addon/blu/weather */
    source: string;
    /** Event kind (door/window/motion/flood/smoke/button/...) */
    kind: string;
    /** Component / BTHome sensor channel */
    channel: number | null;
    /** Binary sensors: 0/1. Buttons: push code (1 single, 2 double, 3 triple, 4 long). */
    state: number;
}

export interface SensorEventsResponse {
    items: SensorEventRow[];
}

export const SENSOR_EVENTS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'ts',
                    'device',
                    'shellyID',
                    'source',
                    'kind',
                    'channel',
                    'state'
                ],
                properties: {
                    ts: {type: 'string'},
                    device: {type: 'number'},
                    shellyID: {type: ['string', 'null'] as JsonSchemaType[]},
                    source: {type: 'string'},
                    kind: {type: 'string'},
                    channel: {type: ['number', 'null'] as JsonSchemaType[]},
                    state: {type: 'number'}
                }
            }
        }
    }
};

// --- Query (numeric history) ---------------------------------------------

/**
 * Reading-source vocabulary. Mirrors `SensorSource` in
 * modules/sensorCapture.ts (the capture/classifier that produces these) — kept
 * here, like ENERGY_DOMAINS, so the generated API surface validates the filter
 * before it reaches the DB. internal = a device's own chip reading; blu = a
 * paired BTHome/BLU sensor; weather = an Ecowitt-class station.
 */
export const SENSOR_SOURCES = [
    'internal',
    'builtin',
    'addon',
    'blu',
    'weather'
] as const;
export type SensorSource = (typeof SENSOR_SOURCES)[number];

export const SENSOR_QUERY_LIMITS = {
    // Same device cap as Sensor.Events — one sensor-read fan-out ceiling.
    maxDevicesPerQuery: SENSOR_EVENTS_LIMITS.maxDevicesPerQuery,
    maxPageRows: 50_000
} as const;

export interface SensorQueryParams {
    /** ISO-8601 inclusive start timestamp */
    from: string;
    /** ISO-8601 exclusive end timestamp */
    to: string;
    /**
     * Sensor kinds to read (temperature/humidity/co2/pressure/...). Free-form
     * for the same reason as SensorEventsParams.kind: the numeric_15min kind
     * vocabulary is derived from capture (BTHome names + native), not a fixed
     * enum. One DB fan-out per kind.
     */
    kinds: string[];
    /**
     * Reading-source filter (internal/builtin/addon/blu/weather). Omit to
     * return every source — rows stay grouped per source either way.
     */
    source?: SensorSource;
    /** Scope: group / location / tag / fleet (mutually exclusive with devices) */
    scope?: DashboardScope;
    /** Scope: explicit device shellyIDs (mutually exclusive with scope) */
    devices?: string[];
    /** Bucket interval — defaults to '1 hour' */
    bucket?: EnergyBucket;
    /** Page size, max 50000. Omit to return the full set; set to paginate. */
    limit?: number;
    /** Default 0 */
    offset?: number;
}

export interface SensorQueryRow {
    /** Bucket timestamp (ISO-8601) */
    bucket: string;
    /** Internal device id */
    device: number;
    /** Device shellyID */
    shellyID: string | null;
    /** Sensor kind (temperature/humidity/co2/...) */
    kind: string;
    /** Reading source: internal/builtin/addon/blu/weather */
    source: string;
    /** Physical sensor channel. Null means the source has no channel. */
    channel: number | null;
    /** Number of raw readings represented by this bucket. */
    sampleCount: number;
    /** Sample-weighted average over the bucket, in the sensor's native unit */
    value: number;
    /** Bucket minimum */
    min: number | null;
    /** Bucket maximum */
    max: number | null;
}

export interface SensorQueryMeta {
    from: string;
    to: string;
    bucket: EnergyBucket;
    /** Server-side execution time in ms */
    executionMs: number;
}

export interface SensorQueryResponse {
    items: SensorQueryRow[];
    /** Lower bound on total rows; has_more is authoritative. */
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    meta: SensorQueryMeta;
}

export const SENSOR_QUERY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['from', 'to', 'kinds'],
    additionalProperties: false,
    properties: {
        from: {type: 'string', minLength: 1, description: 'ISO-8601 start'},
        to: {type: 'string', minLength: 1, description: 'ISO-8601 end'},
        kinds: {
            type: 'array',
            minItems: 1,
            items: {type: 'string', minLength: 1, maxLength: 24},
            description: 'Sensor kinds to read — one DB fan-out per kind'
        },
        source: {
            type: 'string',
            enum: [...SENSOR_SOURCES],
            description: 'Reading-source filter — omit for every source'
        },
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {
            type: 'array',
            maxItems: SENSOR_QUERY_LIMITS.maxDevicesPerQuery,
            items: {type: 'string', minLength: 1},
            description: 'shellyID allowlist — mutually exclusive with scope'
        },
        bucket: {
            type: 'string',
            enum: [...ENERGY_BUCKETS],
            description: 'Bucket interval — defaults to 1 hour'
        },
        limit: {
            type: 'integer',
            minimum: 1,
            maximum: SENSOR_QUERY_LIMITS.maxPageRows,
            description:
                'Page size. Omit to return the full set (up to the server row ceiling); set to paginate.'
        },
        offset: {type: 'integer', minimum: 0}
    }
};

export const SENSOR_QUERY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more', 'meta'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'bucket',
                    'device',
                    'shellyID',
                    'kind',
                    'source',
                    'channel',
                    'sampleCount',
                    'value',
                    'min',
                    'max'
                ],
                properties: {
                    bucket: {type: 'string'},
                    device: {type: 'number'},
                    shellyID: {type: ['string', 'null'] as JsonSchemaType[]},
                    kind: {type: 'string'},
                    source: {type: 'string'},
                    channel: {
                        type: ['number', 'null'] as JsonSchemaType[]
                    },
                    sampleCount: {
                        type: 'number',
                        minimum: 0,
                        description:
                            'Number of raw readings represented by this bucket.'
                    },
                    value: {type: 'number'},
                    min: {type: ['number', 'null'] as JsonSchemaType[]},
                    max: {type: ['number', 'null'] as JsonSchemaType[]}
                }
            }
        },
        total: {
            type: 'number',
            description:
                'Lower bound on total rows (offset + returned + 1 when more exist) — has_more is authoritative.'
        },
        limit: {type: 'number'},
        offset: {type: 'number'},
        has_more: {
            type: 'boolean',
            description:
                'Authoritative signal that more rows exist beyond this page.'
        },
        meta: {
            type: 'object',
            required: ['from', 'to', 'bucket', 'executionMs'],
            properties: {
                from: {type: 'string'},
                to: {type: 'string'},
                bucket: {type: 'string'},
                executionMs: {type: 'number'}
            }
        }
    }
};

export const SENSOR_DESCRIBE: DescribeOutput = new DescribeBuilder('sensor', {
    kind: 'fleet-manager',
    description:
        'Cross-device read of numeric sensor history (Query) and discrete sensor events (Events).'
})
    .registerMethod('Query', {
        safety: {operation: 'read'},
        params: SENSOR_QUERY_PARAMS_SCHEMA,
        response: SENSOR_QUERY_RESPONSE_SCHEMA,
        permission: {
            note: 'Scope-dependent: groupId→groups:read, devices→devices:read per device, fleet→dashboards:read — same model as Energy.Query'
        },
        description:
            'Numeric sensor history from device_sensor.numeric_15min (the forever 15-minute rollup), ' +
            're-bucketed per channel to sample-weighted avg + true min/max, with reading counts. The numeric twin of Sensor.Events. ' +
            'Group / location / tag / devices / fleet scope selected by params (scope XOR devices). ' +
            'kinds fan out one DB call each; source narrows to one reading source (omit for all). ' +
            'Omit limit for the full set (up to the server row ceiling); set limit to paginate. ' +
            'total is a lower bound — has_more is authoritative.'
    })
    .registerMethod('Events', {
        safety: {operation: 'read'},
        params: SENSOR_EVENTS_PARAMS_SCHEMA,
        response: SENSOR_EVENTS_RESPONSE_SCHEMA,
        permission: {
            note: 'devices:read per requested device — same devices-allowlist model as Energy.Query'
        },
        description:
            'Discrete event history from device_sensor.events (append-only: binary sensors record ' +
            'on state change, buttons record every push). devices is a required shellyID allowlist — ' +
            'no group/location/tag/fleet scope yet. kind narrows to one event kind; omit for all kinds.'
    })
    .build();
