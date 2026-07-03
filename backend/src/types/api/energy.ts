// Public API types for the `Energy.*` namespace — reads, logical meters,
// and the point override.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema, JsonSchemaType} from './_schema';
import {DASHBOARD_SCOPE_SCHEMA, type DashboardScope} from './fleet';

// --- Shared enums --------------------------------------------------------

/**
 * Canonical bucket strings accepted by Energy.* methods. Mirrors
 * `GRANULARITY_MAP` in `config/energy.ts` — callers must pass one of these
 * exact strings. The DB function `fn_report_stats` accepts arbitrary
 * TimescaleDB intervals, but external callers go through this allowlist to
 * prevent injection into `time_bucket()`.
 */
export const ENERGY_BUCKETS = [
    '1 minute',
    '5 minutes',
    '15 minutes',
    '30 minutes',
    '1 hour',
    '6 hours',
    '12 hours',
    '1 day',
    '1 week',
    '1 month'
] as const;

export type EnergyBucket = (typeof ENERGY_BUCKETS)[number];

/**
 * Tags accepted by Energy.Query. Energy tags route to `device_em.stats`;
 * environmental tags route to `device.status`. Mixed tag sets fan out in
 * parallel and merge results (EnergyRepository handles routing).
 */
export const ENERGY_QUERY_TAGS = [
    // From device_em.stats
    'total_act_energy',
    'total_act_ret_energy',
    'volume_l',
    'volume_m3',
    'thermal_energy_kwh',
    'power',
    'volume_flow_m3h',
    'volume_storage_l',
    'voltage',
    'current',
    'min_voltage',
    'max_voltage',
    'min_current',
    'max_current',
    // From device.status
    'temperature',
    'humidity',
    'luminance'
] as const;

export type EnergyQueryTag = (typeof ENERGY_QUERY_TAGS)[number];

// --- Limits --------------------------------------------------------------

export const ENERGY_LIMITS = {
    maxDevicesPerQuery: 500,
    maxRowsPerPage: 50_000,
    maxRangeMsEnergy: 365 * 24 * 60 * 60 * 1000,
    maxRangeMsEnvironmental: 30 * 24 * 60 * 60 * 1000,
    maxRangeMsSummary: 30 * 24 * 60 * 60 * 1000,
    // Bound a single save payload — a meter aggregates channels, not fleets.
    maxPointsPerMeter: 512,
    maxFormulaTerms: 256
} as const;

// --- Query ---------------------------------------------------------------

export interface EnergyQueryParams {
    /** ISO-8601 inclusive start timestamp */
    from: string;
    /** ISO-8601 exclusive end timestamp */
    to: string;
    /** One or more metric tags */
    tags: EnergyQueryTag[];
    /** Bucket interval — defaults to '1 day' */
    bucket?: EnergyBucket;
    /** Scope: group / location / tag / fleet (mutually exclusive with `devices`) */
    scope?: DashboardScope;
    /** Scope: explicit device shellyIDs (mutually exclusive with `scope`) */
    devices?: string[];
    /**
     * Scope: logical-meter ids (mutually exclusive with `scope`/`devices`).
     * Each output row carries its `meterId`. Energy tags only — power/voltage
     * at meter grain is rejected because they cannot be summed across points.
     */
    meterIds?: number[];
    /**
     * When false, rows are aggregated across all devices into a single
     * `device = 0` bucket. Defaults to true.
     */
    perDevice?: boolean;
    /**
     * When true, the energy-table query uses `fn_report_stats_by_phase` and
     * rows carry a non-null `phase` field (`'a'|'b'|'c'`).
     */
    perPhase?: boolean;
    /** Page size, max 50000. Omit to return the full set; set to paginate. */
    limit?: number;
    /** Default 0 */
    offset?: number;
    /** IANA timezone for the daily bucket boundary. Defaults to UTC. */
    timezone?: string;
    /**
     * Fold per-meter energy into one series per dimension (meter/role/kind/
     * utility). Runs the meter path: energy tags only, 15min–1day buckets,
     * and mutually exclusive with perDevice/perPhase. Selection is meterIds,
     * or a group/location scope, or all org meters when neither is given.
     */
    groupBy?: EnergyGroupDimension;
    /** With `groupBy`: collapse buckets to one value per group over the window. */
    totals?: boolean;
}

export interface EnergyQueryRow {
    /** Bucket timestamp (ISO-8601) */
    bucket: string;
    /** Logical-meter id — present only on meterIds-scoped rows */
    meterId?: number;
    /** Internal device id when `perDevice=true`, else 0 */
    device: number;
    /** Device shellyID when `perDevice=true`, else null */
    shellyID: string | null;
    /** Metric tag */
    tag: EnergyQueryTag;
    /** Aggregated value in display units (kWh / V / A / W / °C / % / lux) */
    value: number;
    /** Bucket minimum — present for environmental tags */
    min?: number | null;
    /** Bucket maximum — present for environmental tags */
    max?: number | null;
    /** Phase letter when `perPhase=true` (energy tags only) */
    phase?: 'a' | 'b' | 'c';
}

export interface EnergyQueryMeta {
    from: string;
    to: string;
    bucket: EnergyBucket;
    /** Server-side execution time in ms */
    executionMs: number;
    /** True when the response was served from a continuous aggregate */
    fromMaterializedView?: boolean;
}

export interface EnergyQueryResponse {
    items: EnergyQueryRow[];
    /** Present when `groupBy` is set — one series per group; `items` is empty. */
    groups?: EnergyGroupRow[];
    /** Lower bound on total rows; has_more is authoritative. */
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    meta: EnergyQueryMeta;
}

// --- Group-by (live "by appliance" chart) --------------------------------
// A group-by folds per-meter energy into one series per dimension, the same
// meaning the report's byRole/byKind/byUtility breakdown uses. Logical-meter
// concept — role/kind/utility live on the meter — so it runs the meter path.
export const ENERGY_GROUP_DIMENSIONS = [
    'meter',
    'role',
    'kind',
    'utility'
] as const;
export type EnergyGroupDimension = (typeof ENERGY_GROUP_DIMENSIONS)[number];

export interface EnergyGroupRow {
    /** Bucket timestamp (ISO-8601). In totals mode, the window's first bucket. */
    bucket: string;
    /** The dimension this row was grouped by. */
    groupBy: EnergyGroupDimension;
    /** Group identity: meterId (as string) | role | kindId | utilityType. */
    key: string;
    /** Display label — the meter name for `meter`, else the key. */
    label: string;
    /** Value unit ('kWh' | 'volume'). Part of the group identity so a role or
     *  kind spanning utilities of different units never sums across them. */
    unit: string;
    /** Aggregated value in display units. */
    value: number;
}

export const ENERGY_QUERY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['from', 'to', 'tags'],
    properties: {
        from: {type: 'string', minLength: 1, description: 'ISO-8601 start'},
        to: {type: 'string', minLength: 1, description: 'ISO-8601 end'},
        tags: {
            type: 'array',
            minItems: 1,
            items: {type: 'string', enum: [...ENERGY_QUERY_TAGS]}
        },
        bucket: {
            type: 'string',
            enum: [...ENERGY_BUCKETS],
            description: 'Bucket interval — defaults to 1 day'
        },
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {
            type: 'array',
            maxItems: ENERGY_LIMITS.maxDevicesPerQuery,
            items: {type: 'string', minLength: 1},
            description: 'shellyID allowlist — mutually exclusive with scope'
        },
        meterIds: {
            type: 'array',
            maxItems: ENERGY_LIMITS.maxDevicesPerQuery,
            items: {type: 'number'},
            description:
                'logical-meter ids — energy tags only; mutually exclusive with scope/devices'
        },
        perDevice: {type: 'boolean'},
        perPhase: {type: 'boolean'},
        timezone: {type: 'string', maxLength: 64},
        limit: {
            type: 'number',
            minimum: 1,
            maximum: 50000,
            description:
                'Page size. Omit to return the full set (up to server OOM ceiling); pagination applies only when set.'
        },
        offset: {type: 'number', minimum: 0},
        groupBy: {type: 'string', enum: [...ENERGY_GROUP_DIMENSIONS]},
        totals: {type: 'boolean'}
    }
};

export const ENERGY_QUERY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more', 'meta'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: ['bucket', 'device', 'shellyID', 'tag', 'value'],
                properties: {
                    bucket: {type: 'string'},
                    meterId: {type: 'number'},
                    device: {type: 'number'},
                    shellyID: {
                        type: ['string', 'null'] as JsonSchemaType[]
                    },
                    tag: {type: 'string'},
                    value: {type: 'number'},
                    min: {type: ['number', 'null'] as JsonSchemaType[]},
                    max: {type: ['number', 'null'] as JsonSchemaType[]},
                    phase: {type: 'string', enum: ['a', 'b', 'c']}
                }
            }
        },
        groups: {
            type: 'array',
            description:
                'Grouped series — present only when groupBy is set; items is empty.',
            items: {
                type: 'object',
                required: [
                    'bucket',
                    'groupBy',
                    'key',
                    'label',
                    'unit',
                    'value'
                ],
                properties: {
                    bucket: {type: 'string'},
                    groupBy: {
                        type: 'string',
                        enum: [...ENERGY_GROUP_DIMENSIONS]
                    },
                    key: {type: 'string'},
                    label: {type: 'string'},
                    unit: {type: 'string'},
                    value: {type: 'number'}
                }
            }
        },
        total: {
            type: 'number',
            description:
                'Lower bound on total rows (offset + returned + 1 when more exist), not exact — has_more is authoritative.'
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
                executionMs: {type: 'number'},
                fromMaterializedView: {type: 'boolean'}
            }
        }
    }
};

// --- Current (live power) ------------------------------------------------

export type EnergyCurrentDetail = 'total' | 'device' | 'channel' | 'meter';

export interface EnergyCurrentParams {
    /** Scope: group / location / tag / fleet (mutually exclusive with devices) */
    scope?: DashboardScope;
    /** Explicit device shellyIDs (mutually exclusive with scope) */
    devices?: string[];
    /** Logical-meter ids (mutually exclusive with scope/devices). detail='meter'
     *  returns per-meter live watts. Physical meters only. */
    meterIds?: number[];
    /**
     * Component-key allowlist, e.g. ['switch:0', 'switch:2']. When set, only
     * those components contribute — a card can show a chosen subset of a
     * device's switches. Applied per device.
     */
    components?: string[];
    /**
     * Response granularity. 'total' = one number; 'device' = per-device sums;
     * 'channel' = per-device, per-(component, phase) breakdown; 'meter' = per
     * logical meter (with meterIds). Default 'total'.
     */
    detail?: EnergyCurrentDetail;
}

export interface EnergyCurrentChannel {
    /** Component instance, e.g. "switch:0" or "em:0". */
    componentKey: string;
    /** 'z' = single / whole-component; a|b|c = one phase of a meter. */
    phase: 'a' | 'b' | 'c' | 'z';
    /** Signed instantaneous active power (W). Negative = export. */
    watts: number;
}

export interface EnergyCurrentDevice {
    shellyID: string;
    online: boolean;
    /** Sum of this device's selected channels (signed W). */
    watts: number;
    /** Per-channel breakdown — present only when detail='channel'. */
    channels?: EnergyCurrentChannel[];
}

export interface EnergyCurrentMeter {
    meterId: number;
    /** Sum of this meter's live channel power (signed W). */
    watts: number;
}

export interface EnergyCurrentResponse {
    /** Sum of selected channels across all in-scope devices (signed W). */
    watts: number;
    /** Server timestamp (ISO-8601) the reading was assembled. */
    asOf: string;
    /** Number of in-scope devices currently online and contributing. */
    onlineDevices: number;
    /** Per-device rows — present when detail = device/channel. */
    devices?: EnergyCurrentDevice[];
    /** Per-meter rows — present when detail = meter (meterIds path). */
    meters?: EnergyCurrentMeter[];
}

export const ENERGY_CURRENT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {
            type: 'array',
            maxItems: ENERGY_LIMITS.maxDevicesPerQuery,
            items: {type: 'string', minLength: 1},
            description: 'shellyID allowlist — mutually exclusive with scope'
        },
        meterIds: {
            type: 'array',
            maxItems: ENERGY_LIMITS.maxDevicesPerQuery,
            items: {type: 'number'},
            description:
                'logical-meter ids — mutually exclusive with scope/devices'
        },
        components: {
            type: 'array',
            items: {type: 'string', minLength: 1},
            description:
                'component-key allowlist, e.g. switch:0 — applied per device'
        },
        detail: {
            type: 'string',
            enum: ['total', 'device', 'channel', 'meter'],
            description: 'response granularity — defaults to total'
        }
    }
};

export const ENERGY_CURRENT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['watts', 'asOf', 'onlineDevices'],
    properties: {
        watts: {type: 'number'},
        asOf: {type: 'string'},
        onlineDevices: {type: 'number'},
        devices: {
            type: 'array',
            items: {
                type: 'object',
                required: ['shellyID', 'online', 'watts'],
                properties: {
                    shellyID: {type: 'string'},
                    online: {type: 'boolean'},
                    watts: {type: 'number'},
                    channels: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['componentKey', 'phase', 'watts'],
                            properties: {
                                componentKey: {type: 'string'},
                                phase: {
                                    type: 'string',
                                    enum: ['a', 'b', 'c', 'z']
                                },
                                watts: {type: 'number'}
                            }
                        }
                    }
                }
            }
        },
        meters: {
            type: 'array',
            items: {
                type: 'object',
                required: ['meterId', 'watts'],
                properties: {
                    meterId: {type: 'number'},
                    watts: {type: 'number'}
                }
            }
        }
    }
};

// --- Classification (PR 5) ----------------------------------------------

// Same closed enums as the runtime classifier — kept here so the
// generated API surface validates inputs before they reach the
// classifier module.
const ENERGY_CLASSIFICATION_TAGS = [
    'power',
    'apparent_power',
    'reactive_power',
    'voltage',
    'current',
    'frequency',
    'power_factor',
    'total_power',
    'total_apparent_power',
    'total_current',
    'neutral_current',
    'total_act_energy',
    'total_act_ret_energy',
    'percentage',
    'temperature_c',
    'temperature_f',
    'volume_l',
    'volume_m3',
    'volume_storage_l',
    'volume_flow_m3h',
    'thermal_energy_kwh'
] as const;

const ENERGY_CLASSIFICATION_DOMAINS = [
    'ac_mains',
    'dc_pv',
    'dc_battery',
    'dc_bus',
    'thermal',
    'unspecified'
] as const;

export interface EnergyClassificationRow {
    deviceId: number;
    componentKey: string;
    tag: (typeof ENERGY_CLASSIFICATION_TAGS)[number];
    domain: (typeof ENERGY_CLASSIFICATION_DOMAINS)[number];
    channel: number;
    source: string;
    declaredAt: string;
    declaredBy: string | null;
}

// SetPointOverride — fix the one fact a device cannot state: the
// electrical domain or tag of an unknown point (e.g. a voltmeter that may
// be AC or DC). Writes the tier-1 operator override fm.energy_classification
// stores; all other facts are auto-derived by the classifier.

export interface EnergySetPointOverrideParams {
    deviceId: number;
    componentKey: string;
    channel: number;
    tag: (typeof ENERGY_CLASSIFICATION_TAGS)[number];
    electricalDomain: (typeof ENERGY_CLASSIFICATION_DOMAINS)[number];
}
export interface EnergySetPointOverrideResponse {
    ok: boolean;
}

export const ENERGY_SET_POINT_OVERRIDE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'deviceId',
        'componentKey',
        'channel',
        'tag',
        'electricalDomain'
    ],
    properties: {
        deviceId: {type: 'number'},
        componentKey: {type: 'string', minLength: 1, maxLength: 100},
        channel: {type: 'number', minimum: 0, maximum: 31},
        tag: {type: 'string', enum: [...ENERGY_CLASSIFICATION_TAGS]},
        electricalDomain: {
            type: 'string',
            enum: [...ENERGY_CLASSIFICATION_DOMAINS]
        }
    }
};

export const ENERGY_SET_POINT_OVERRIDE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};

export interface EnergyResetAuditRow {
    deviceId: number;
    channel: number;
    tag: string;
    resetCount: number;
    lastResetAt: string | null;
    lastSeenAt: string | null;
}

export const ENERGY_GET_RESET_AUDIT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        deviceId: {type: 'number', description: 'Limit to one device'},
        windowDays: {
            type: 'number',
            minimum: 1,
            maximum: 365,
            description: 'Only rows whose last reset is within this window'
        }
    }
};

export const ENERGY_GET_RESET_AUDIT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                required: ['deviceId', 'channel', 'tag', 'resetCount'],
                properties: {
                    deviceId: {type: 'number'},
                    channel: {type: 'number'},
                    tag: {type: 'string'},
                    resetCount: {type: 'number'},
                    lastResetAt: {type: ['string', 'null'] as JsonSchemaType[]},
                    lastSeenAt: {type: ['string', 'null'] as JsonSchemaType[]}
                }
            }
        }
    }
};

export interface EnergyGetResetAuditParams {
    deviceId?: number;
    windowDays?: number;
}
export interface EnergyGetResetAuditResponse {
    items: EnergyResetAuditRow[];
}

// --- Logical meters ------------------------------------------------------

// The "meaning" layer over raw device_em readings. Vocabularies are
// closed and mirror the DB CHECK constraints in fm.logical_meter; the
// physics vocabularies (domain/phase/tag) keep their one home in the
// classifier and are reused here.

export const ENERGY_UTILITY_TYPES = [
    'electric',
    'gas',
    'water',
    'heat'
] as const;
export type EnergyUtilityType = (typeof ENERGY_UTILITY_TYPES)[number];

// Role is utility-scoped: electric uses energy-flow roles, the other
// utilities share supply/production/storage/usage/aux. The schema enum is
// the union; the handler enforces the per-utility scoping (as does the DB).
export const ENERGY_ELECTRIC_ROLES = [
    'grid',
    'pv',
    'battery',
    'generator',
    'ev_charge',
    'load',
    'aux'
] as const;
export const ENERGY_RESOURCE_ROLES = [
    'supply',
    'production',
    'storage',
    'usage',
    'aux'
] as const;
export const ENERGY_ALL_ROLES = [
    ...ENERGY_ELECTRIC_ROLES,
    ...ENERGY_RESOURCE_ROLES
] as const;
export type EnergyMeterRole = (typeof ENERGY_ALL_ROLES)[number];

export const ENERGY_PHASE_MODES = [
    'single_phase',
    'three_phase',
    'independent_channels',
    'dc',
    'unknown'
] as const;
export type EnergyPhaseMode = (typeof ENERGY_PHASE_MODES)[number];

export const ENERGY_AGGREGATION_MODES = ['sum_points', 'formula'] as const;
export type EnergyAggregationMode = (typeof ENERGY_AGGREGATION_MODES)[number];

export const ENERGY_POINT_PHASES = ['a', 'b', 'c', 'z'] as const;
export type EnergyPointPhase = (typeof ENERGY_POINT_PHASES)[number];

export const ENERGY_DIRECTION_HINTS = [
    'import',
    'export',
    'charge',
    'discharge'
] as const;
export type EnergyDirectionHint = (typeof ENERGY_DIRECTION_HINTS)[number];

// Returns the valid role list for one utility — single home for the
// utility→role scoping rule, used by handler validation.
export function rolesForUtility(
    utilityType: EnergyUtilityType
): readonly EnergyMeterRole[] {
    return utilityType === 'electric'
        ? ENERGY_ELECTRIC_ROLES
        : ENERGY_RESOURCE_ROLES;
}

export interface EnergyLogicalMeterPoint {
    deviceId: number;
    // Display metadata, not identity — null/absent for a history-only point.
    componentKey?: string | null;
    channel: number;
    phase: EnergyPointPhase;
    tag: (typeof ENERGY_CLASSIFICATION_TAGS)[number];
    electricalDomain?: (typeof ENERGY_CLASSIFICATION_DOMAINS)[number] | null;
    directionHint?: EnergyDirectionHint | null;
}

// Single home for the point JSON keys the save/list SQL functions must read
// and emit. The coverage map is typed by `keyof EnergyLogicalMeterPoint`, so
// adding or renaming a field fails to compile until this list — and the
// SQL-key guard test that consumes it — are updated in lockstep.
const ENERGY_POINT_KEY_COVERAGE: Record<keyof EnergyLogicalMeterPoint, true> = {
    deviceId: true,
    componentKey: true,
    channel: true,
    phase: true,
    tag: true,
    electricalDomain: true,
    directionHint: true
};
export const ENERGY_LOGICAL_METER_POINT_KEYS = Object.keys(
    ENERGY_POINT_KEY_COVERAGE
) as Array<keyof EnergyLogicalMeterPoint>;

// One term of a calculated-meter formula — a signed, optionally-shared
// reference to another meter (tenant net, total solar, shared PV).
export interface EnergyVirtualFormulaTerm {
    meterId: number;
    /** +1 adds the term, -1 subtracts it. */
    sign: 1 | -1;
    /** Fraction of the term to apply, 0..1. Defaults to 1. */
    share?: number;
}

export interface EnergyVirtualFormula {
    kind: 'sum';
    terms: EnergyVirtualFormulaTerm[];
}

export interface EnergyLogicalMeter {
    id: number;
    name: string;
    utilityType: EnergyUtilityType;
    role: EnergyMeterRole;
    kindId?: string | null;
    phaseMode: EnergyPhaseMode;
    aggregationMode: EnergyAggregationMode;
    points: EnergyLogicalMeterPoint[];
    groupId?: number | null;
    locationId?: number | null;
    costCenter?: string | null;
    parentMeterId?: number | null;
    virtualFormula?: EnergyVirtualFormula | null;
}

export interface EnergyListLogicalMetersParams {
    scope?: {groupId?: number; locationId?: number};
}
export interface EnergyListLogicalMetersResponse {
    meters: EnergyLogicalMeter[];
}

export interface EnergySaveLogicalMeterParams {
    /** Omit to create; pass to update. */
    id?: number;
    name: string;
    utilityType: EnergyUtilityType;
    role: EnergyMeterRole;
    kindId?: string | null;
    phaseMode?: EnergyPhaseMode;
    aggregationMode: EnergyAggregationMode;
    points?: EnergyLogicalMeterPoint[];
    groupId?: number | null;
    locationId?: number | null;
    costCenter?: string | null;
    parentMeterId?: number | null;
    virtualFormula?: EnergyVirtualFormula | null;
}
export interface EnergySaveLogicalMeterResponse {
    meter: EnergyLogicalMeter;
}

export interface EnergyDeleteLogicalMeterParams {
    id: number;
}
export interface EnergyDeleteLogicalMeterResponse {
    deleted: boolean;
}

const ENERGY_LOGICAL_METER_POINT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deviceId', 'tag'],
    additionalProperties: false,
    properties: {
        deviceId: {type: 'number'},
        // Display metadata, not identity — null for a history-only point that
        // no live snapshot could label. Ownership is device|channel|tag.
        componentKey: {
            type: ['string', 'null'] as JsonSchemaType[],
            maxLength: 100
        },
        channel: {type: 'number', minimum: 0, maximum: 31},
        phase: {type: 'string', enum: [...ENERGY_POINT_PHASES]},
        tag: {type: 'string', enum: [...ENERGY_CLASSIFICATION_TAGS]},
        electricalDomain: {
            type: ['string', 'null'] as JsonSchemaType[],
            enum: [...ENERGY_CLASSIFICATION_DOMAINS, null]
        },
        directionHint: {
            type: ['string', 'null'] as JsonSchemaType[],
            enum: [...ENERGY_DIRECTION_HINTS, null]
        }
    }
};

const ENERGY_VIRTUAL_FORMULA_SCHEMA: JsonSchema = {
    type: ['object', 'null'] as JsonSchemaType[],
    required: ['kind', 'terms'],
    properties: {
        kind: {type: 'string', enum: ['sum']},
        terms: {
            type: 'array',
            maxItems: ENERGY_LIMITS.maxFormulaTerms,
            items: {
                type: 'object',
                required: ['meterId', 'sign'],
                properties: {
                    meterId: {type: 'number'},
                    sign: {type: 'number', enum: [1, -1]},
                    share: {type: 'number', minimum: 0, maximum: 1}
                }
            }
        }
    }
};

export const ENERGY_LIST_LOGICAL_METERS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        scope: {
            type: 'object',
            properties: {
                groupId: {type: 'number'},
                locationId: {type: 'number'}
            }
        }
    }
};

const ENERGY_LOGICAL_METER_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'name',
        'utilityType',
        'role',
        'phaseMode',
        'aggregationMode',
        'points'
    ],
    properties: {
        id: {type: 'number'},
        name: {type: 'string'},
        utilityType: {type: 'string', enum: [...ENERGY_UTILITY_TYPES]},
        role: {type: 'string', enum: [...ENERGY_ALL_ROLES]},
        kindId: {type: ['string', 'null'] as JsonSchemaType[]},
        phaseMode: {type: 'string', enum: [...ENERGY_PHASE_MODES]},
        aggregationMode: {
            type: 'string',
            enum: [...ENERGY_AGGREGATION_MODES]
        },
        points: {
            type: 'array',
            maxItems: ENERGY_LIMITS.maxPointsPerMeter,
            items: ENERGY_LOGICAL_METER_POINT_SCHEMA
        },
        groupId: {type: ['number', 'null'] as JsonSchemaType[]},
        locationId: {type: ['number', 'null'] as JsonSchemaType[]},
        costCenter: {type: ['string', 'null'] as JsonSchemaType[]},
        parentMeterId: {type: ['number', 'null'] as JsonSchemaType[]},
        virtualFormula: ENERGY_VIRTUAL_FORMULA_SCHEMA
    }
};

export const ENERGY_LIST_LOGICAL_METERS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['meters'],
    properties: {
        meters: {type: 'array', items: ENERGY_LOGICAL_METER_SCHEMA}
    }
};

export const ENERGY_SAVE_LOGICAL_METER_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name', 'utilityType', 'role', 'aggregationMode'],
    properties: {
        id: {type: 'number'},
        name: {type: 'string', minLength: 1, maxLength: 128},
        utilityType: {type: 'string', enum: [...ENERGY_UTILITY_TYPES]},
        role: {type: 'string', enum: [...ENERGY_ALL_ROLES]},
        kindId: {type: ['string', 'null'] as JsonSchemaType[], maxLength: 200},
        phaseMode: {type: 'string', enum: [...ENERGY_PHASE_MODES]},
        aggregationMode: {
            type: 'string',
            enum: [...ENERGY_AGGREGATION_MODES]
        },
        points: {
            type: 'array',
            maxItems: ENERGY_LIMITS.maxPointsPerMeter,
            items: ENERGY_LOGICAL_METER_POINT_SCHEMA
        },
        groupId: {type: ['number', 'null'] as JsonSchemaType[]},
        locationId: {type: ['number', 'null'] as JsonSchemaType[]},
        costCenter: {
            type: ['string', 'null'] as JsonSchemaType[],
            maxLength: 120
        },
        parentMeterId: {type: ['number', 'null'] as JsonSchemaType[]},
        virtualFormula: ENERGY_VIRTUAL_FORMULA_SCHEMA
    }
};

export const ENERGY_SAVE_LOGICAL_METER_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['meter'],
    properties: {meter: ENERGY_LOGICAL_METER_SCHEMA}
};

export const ENERGY_DELETE_LOGICAL_METER_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'number'}}
};

export const ENERGY_DELETE_LOGICAL_METER_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};

// --- Meter connections (topology edges) ---------------------------------

// Topology vocab — mirrors the fm.meter_connection CHECK (migration 6920).
export const METER_CONNECTION_NODES = [
    'grid',
    'ac_bus',
    'house_load',
    'pv_dc',
    'inverter',
    'battery_dc',
    'generator',
    'thermal_loop',
    'water_supply',
    'gas_supply'
] as const;
export type MeterConnectionNode = (typeof METER_CONNECTION_NODES)[number];

export const METER_CONNECTION_DIRECTIONS = [
    'from_to',
    'to_from',
    'bidirectional'
] as const;
export type MeterConnectionDirection =
    (typeof METER_CONNECTION_DIRECTIONS)[number];

// One topology edge: the meter sits between from_node and to_node, and
// positive_direction names which way a positive meter value flows.
export interface EnergyMeterConnection {
    id: number;
    meterId: number;
    fromNode: MeterConnectionNode;
    toNode: MeterConnectionNode;
    positiveDirection: MeterConnectionDirection;
}

export interface EnergyListMeterConnectionsParams {
    // No filters today; org scope is applied server-side from the sender.
    [key: string]: never;
}
export interface EnergyListMeterConnectionsResponse {
    connections: EnergyMeterConnection[];
}

export interface EnergySaveMeterConnectionParams {
    /** Omit to create; pass to update. */
    id?: number;
    meterId: number;
    fromNode: MeterConnectionNode;
    toNode: MeterConnectionNode;
    /** Defaults to from_to when omitted. */
    positiveDirection?: MeterConnectionDirection;
}
export interface EnergySaveMeterConnectionResponse {
    connection: EnergyMeterConnection;
}

export interface EnergyDeleteMeterConnectionParams {
    id: number;
}
export interface EnergyDeleteMeterConnectionResponse {
    deleted: boolean;
}

const ENERGY_METER_CONNECTION_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'meterId', 'fromNode', 'toNode', 'positiveDirection'],
    properties: {
        id: {type: 'number'},
        meterId: {type: 'number'},
        fromNode: {type: 'string', enum: [...METER_CONNECTION_NODES]},
        toNode: {type: 'string', enum: [...METER_CONNECTION_NODES]},
        positiveDirection: {
            type: 'string',
            enum: [...METER_CONNECTION_DIRECTIONS]
        }
    }
};

export const ENERGY_LIST_METER_CONNECTIONS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {}
};

export const ENERGY_LIST_METER_CONNECTIONS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['connections'],
    properties: {
        connections: {type: 'array', items: ENERGY_METER_CONNECTION_SCHEMA}
    }
};

export const ENERGY_SAVE_METER_CONNECTION_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['meterId', 'fromNode', 'toNode'],
    properties: {
        id: {type: 'number'},
        meterId: {type: 'number'},
        fromNode: {type: 'string', enum: [...METER_CONNECTION_NODES]},
        toNode: {type: 'string', enum: [...METER_CONNECTION_NODES]},
        positiveDirection: {
            type: 'string',
            enum: [...METER_CONNECTION_DIRECTIONS]
        }
    }
};

export const ENERGY_SAVE_METER_CONNECTION_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['connection'],
    properties: {connection: ENERGY_METER_CONNECTION_SCHEMA}
};

export const ENERGY_DELETE_METER_CONNECTION_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: {type: 'number'}}
};

export const ENERGY_DELETE_METER_CONNECTION_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};

// --- ListMeasurementPoints ----------------------------------------------

export const ENERGY_POINT_SOURCES = ['history', 'live', 'both'] as const;
export type EnergyPointSource = (typeof ENERGY_POINT_SOURCES)[number];

// One wireable measurement point for device Energy assignment. Identity is
// (deviceId, channel, phase, tag, electricalDomain). componentKey is null when
// the point is known only from stored history and no live snapshot resolves it.
export interface EnergyMeasurementPoint {
    deviceId: number;
    shellyID: string;
    componentKey: string | null;
    channel: number;
    phase: EnergyPointPhase;
    tag: (typeof ENERGY_CLASSIFICATION_TAGS)[number];
    electricalDomain: (typeof ENERGY_CLASSIFICATION_DOMAINS)[number];
    // history = stored only; live = present in the current snapshot only;
    // both = stored and live. Only history/both can query historical energy.
    source: EnergyPointSource;
    hasHistory: boolean;
    isLiveNow: boolean;
    assignedMeterId?: number;
    sampleValue?: number | null;
    sampleTs?: string | null;
}

export interface EnergyListMeasurementPointsParams {
    /** Single device by shellyID — mutually exclusive with scope. */
    shellyID?: string;
    /** Group / location scope — mutually exclusive with shellyID. */
    scope?: DashboardScope;
    /** Include points already assigned to a meter. Default true. */
    includeAssigned?: boolean;
}

export interface EnergyListMeasurementPointsResponse {
    points: EnergyMeasurementPoint[];
}

export const ENERGY_LIST_MEASUREMENT_POINTS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        shellyID: {
            type: 'string',
            minLength: 1,
            description: 'single device — mutually exclusive with scope'
        },
        scope: DASHBOARD_SCOPE_SCHEMA,
        includeAssigned: {
            type: 'boolean',
            description: 'include already-assigned points — default true'
        }
    }
};

export const ENERGY_LIST_MEASUREMENT_POINTS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['points'],
    properties: {
        points: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'deviceId',
                    'shellyID',
                    'componentKey',
                    'channel',
                    'phase',
                    'tag',
                    'electricalDomain',
                    'source',
                    'hasHistory',
                    'isLiveNow'
                ],
                properties: {
                    deviceId: {type: 'number'},
                    shellyID: {type: 'string'},
                    componentKey: {
                        type: ['string', 'null'] as JsonSchemaType[]
                    },
                    channel: {type: 'number'},
                    phase: {type: 'string', enum: [...ENERGY_POINT_PHASES]},
                    tag: {
                        type: 'string',
                        enum: [...ENERGY_CLASSIFICATION_TAGS]
                    },
                    electricalDomain: {
                        type: 'string',
                        enum: [...ENERGY_CLASSIFICATION_DOMAINS]
                    },
                    source: {type: 'string', enum: [...ENERGY_POINT_SOURCES]},
                    hasHistory: {type: 'boolean'},
                    isLiveNow: {type: 'boolean'},
                    assignedMeterId: {type: 'number'},
                    sampleValue: {
                        type: ['number', 'null'] as JsonSchemaType[]
                    },
                    sampleTs: {type: ['string', 'null'] as JsonSchemaType[]}
                }
            }
        }
    }
};

// --- Describe() output ---------------------------------------------------

/**
 * Energy.* surface: reads (Query / Current), the reset audit, the point
 * override, and logical-meter CRUD.
 *
 * The Describe limits reflect the enforced max range and max page size, so
 * generated UIs can render sensible defaults without guessing.
 */
export const ENERGY_DESCRIBE: DescribeOutput = new DescribeBuilder('energy', {
    kind: 'fleet-manager',
    description:
        'Read fleet energy for dashboards, define logical meters, and fix ' +
        'the rare unknown point.'
})
    .registerMethod('Query', {
        params: ENERGY_QUERY_PARAMS_SCHEMA,
        response: ENERGY_QUERY_RESPONSE_SCHEMA,
        permission: {
            note: 'Scope-dependent: groupId→groups:read, devices→devices:read per device, fleet→dashboards:read'
        },
        description:
            'Unified time-series read for energy (device_em.stats) and environmental (device.status) tags. ' +
            'Group / devices / fleet scope selected by params. Mixed tag sets fan out in parallel. ' +
            'Values are scaled to display units (kWh / V / A / W / °C / % / lux). ' +
            'Omit limit to return the full set (up to the server OOM ceiling); set limit to paginate. ' +
            'total is a lower bound, not exact — has_more is the authoritative "more data exists" signal.'
    })
    .registerMethod('Current', {
        params: ENERGY_CURRENT_PARAMS_SCHEMA,
        response: ENERGY_CURRENT_RESPONSE_SCHEMA,
        permission: {
            note: 'Scope-dependent: groupId→groups:read, devices→devices:read per device, fleet→dashboards:read'
        },
        description:
            'Live instantaneous active power (W) read from in-memory device status — no DB. ' +
            'Selector: scope (group / fleet), devices, or meterIds (one of). ' +
            'detail=total returns one signed sum; device returns per-device sums; ' +
            'channel adds a per-(component, phase) breakdown so a UI can show or pick ' +
            'individual switches or meter phases. components[] narrows to a chosen subset. ' +
            'With meterIds, detail=meter returns per-logical-meter watts (total/meter only, ' +
            'no components); formula meters are rejected — use Query for their energy. ' +
            'Pair with Query for history; poll this (~1–3s) for "now".'
    })
    .registerMethod('SetPointOverride', {
        params: ENERGY_SET_POINT_OVERRIDE_PARAMS_SCHEMA,
        response: ENERGY_SET_POINT_OVERRIDE_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Fix the one fact a device cannot state — the electrical domain or ' +
            'tag of an unknown point (e.g. a voltmeter that may be AC or DC). ' +
            'Writes the tier-1 operator override; the next NotifyStatus frame ' +
            'uses it immediately. All other facts are auto-derived.'
    })
    .registerMethod('GetResetAudit', {
        params: ENERGY_GET_RESET_AUDIT_PARAMS_SCHEMA,
        response: ENERGY_GET_RESET_AUDIT_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'Per-(device, channel, tag) reset history from ' +
            'device_em.lifetime_counters — surfaces devices that may have ' +
            'a firmware glitch or that an operator pressed ResetCounters on.'
    })
    .registerMethod('ListMeasurementPoints', {
        params: ENERGY_LIST_MEASUREMENT_POINTS_PARAMS_SCHEMA,
        response: ENERGY_LIST_MEASUREMENT_POINTS_RESPONSE_SCHEMA,
        permission: {
            note: 'Scope-dependent: shellyID→devices:read, scope→groups:read / locations:read'
        },
        description:
            'List a device or scope wireable measurement points for the ' +
            'device Energy assignment UI. Primary source is stored device_em history ' +
            '(hasHistory); the live snapshot adds the componentKey label and ' +
            'isLiveNow. source=history/both can query historical energy; ' +
            'source=live has no history yet. assignedMeterId marks wired points.'
    })
    .registerMethod('ListLogicalMeters', {
        params: ENERGY_LIST_LOGICAL_METERS_PARAMS_SCHEMA,
        response: ENERGY_LIST_LOGICAL_METERS_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'List the org logical meters with their meaning (utility / role / ' +
            'kind) and their assigned channel points. Optional group / location ' +
            'scope narrows the set. Reports and device Energy assignment read this.'
    })
    .registerMethod('SaveLogicalMeter', {
        params: ENERGY_SAVE_LOGICAL_METER_PARAMS_SCHEMA,
        response: ENERGY_SAVE_LOGICAL_METER_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Create (omit id) or update one logical meter — the meaning the ' +
            'user sets. role is scoped by utilityType; a physical meter carries ' +
            'points + aggregationMode=sum_points, a calculated meter carries a ' +
            'formula + aggregationMode=formula. Returns the saved meter.'
    })
    .registerMethod('DeleteLogicalMeter', {
        params: ENERGY_DELETE_LOGICAL_METER_PARAMS_SCHEMA,
        response: ENERGY_DELETE_LOGICAL_METER_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Delete one logical meter; its points revert to unassigned facts ' +
            'and any child meter is detached from it.'
    })
    .registerMethod('ListMeterConnections', {
        params: ENERGY_LIST_METER_CONNECTIONS_PARAMS_SCHEMA,
        response: ENERGY_LIST_METER_CONNECTIONS_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'List the org topology edges — which node each logical meter sits ' +
            'between and the direction a positive value flows. Powers rich ' +
            'energy/resource flow views.'
    })
    .registerMethod('SaveMeterConnection', {
        params: ENERGY_SAVE_METER_CONNECTION_PARAMS_SCHEMA,
        response: ENERGY_SAVE_METER_CONNECTION_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Create (omit id) or update one topology edge between two nodes ' +
            'for a logical meter. Re-saving the same edge updates its ' +
            'direction. Returns the saved connection.'
    })
    .registerMethod('DeleteMeterConnection', {
        params: ENERGY_DELETE_METER_CONNECTION_PARAMS_SCHEMA,
        response: ENERGY_DELETE_METER_CONNECTION_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description: 'Delete one topology edge by id.'
    })
    .setLimits({...ENERGY_LIMITS})
    .setTags([...ENERGY_QUERY_TAGS])
    .build();
