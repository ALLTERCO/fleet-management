// Public API types for the `Energy.*` namespace — reads, logical meters,
// and the point override.

import {
    BASELINE_TAGS,
    BASELINE_TEMP_BANDS,
    type BaselineTag,
    type BaselineTempBand
} from './_baselineTags';
import {DescribeBuilder, type DescribeOutput} from './_describe';
import {ENERGY_TABLE_TAGS_LIST, ENV_TABLE_TAGS_LIST} from './_energyTags';
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
 * Tags accepted by Energy.Query. Derived from the config routing lists (the
 * single source of truth): device_em tags, then device_sensor tags — so this
 * API enum and the classifier can never drift. Energy tags route to
 * `device_em.stats`, environmental tags to the device_sensor rollup
 * (EnergyRepository handles routing).
 */
export const ENERGY_QUERY_TAGS = [
    ...ENERGY_TABLE_TAGS_LIST,
    ...ENV_TABLE_TAGS_LIST
] as const;

export type EnergyQueryTag = (typeof ENERGY_QUERY_TAGS)[number];

/**
 * The raw classifier `domain` vocabulary — mirrors `EnergyDomain` in the runtime
 * classifier. commodity + electrical_source are DERIVED from this (fn_commodity_for
 * / fn_electrical_source_for); it is not a read filter anymore.
 */
export const ENERGY_DOMAINS = [
    'ac_mains',
    'dc_pv',
    'dc_battery',
    'dc_bus',
    'thermal',
    'gas',
    'unspecified'
] as const;

export type EnergyDomain = (typeof ENERGY_DOMAINS)[number];

/** Commodity axis — what is flowing. The primary identity of a reading. */
export const ENERGY_COMMODITIES = [
    'electricity',
    'water',
    'gas',
    'heat'
] as const;
export type EnergyCommodity = (typeof ENERGY_COMMODITIES)[number];

/** The commodity a tag can only ever measure, or null when the tag alone cannot
 *  say (power, voltage and current read the same in every commodity).
 *
 *  Mirrors the tag branch of device_em.fn_commodity_for; commodityRuleParity
 *  gates the two against drift. Volume cannot tell water from gas, so it answers
 *  water and an explicit 'gas' domain overrides it, exactly as the SQL does.
 *
 *  Lives in types/api because both tiers need it: this half of the contract is
 *  bundled into the browser. */
export function commodityForTag(tag: string): EnergyCommodity | null {
    if (ENERGY_VOLUME_TAGS.has(tag)) return 'water';
    if (tag === 'thermal_energy_kwh') return 'heat';
    if (ELECTRICAL_ENERGY_TAGS.has(tag)) return 'electricity';
    return null;
}

/** Canonical volume-tag family. Volume can represent water or gas; callers
 *  must use the classification domain to distinguish those commodities. */
export const ENERGY_VOLUME_TAGS: ReadonlySet<string> = new Set([
    'volume_l',
    'volume_m3',
    'volume_returned_m3',
    'volume_storage_l',
    'volume_flow_m3h'
]);

const ELECTRICAL_ENERGY_TAGS: ReadonlySet<string> = new Set([
    'total_act_energy',
    'total_act_ret_energy'
]);

/** Legacy conflated filter retained for wire compatibility. New logical-meter
 *  contracts expose currentType and energySource as separate axes. */
export const ELECTRICAL_SOURCES = [
    'ac_mains',
    'dc_pv',
    'dc_battery',
    'dc_bus'
] as const;
export type ElectricalSource = (typeof ELECTRICAL_SOURCES)[number];

/** Electrical characteristic, split from the legacy electricalSource field. */
export const ENERGY_CURRENT_TYPES = ['ac', 'dc'] as const;
export type EnergyCurrentType = (typeof ENERGY_CURRENT_TYPES)[number];

/** Built-in generation/storage-source registry entries. The wire type stays
 *  open so organization-owned registry entries remain forward-compatible. */
export const BUILT_IN_ENERGY_SOURCES = [
    'grid',
    'solar',
    'wind',
    'hydro',
    'natural_gas',
    'oil',
    'biomass',
    'battery',
    'unspecified'
] as const;
export type EnergySource = string;

export const ENERGY_BALANCE_POSITIONS = [
    'transformation_input',
    'transformation_output',
    'final_consumption'
] as const;
export type EnergyBalancePosition = (typeof ENERGY_BALANCE_POSITIONS)[number];

// --- Limits --------------------------------------------------------------

export const ENERGY_LIMITS = {
    maxDevicesPerQuery: 500,
    maxRowsPerPage: 50_000,
    maxRangeMsEnergy: 365 * 24 * 60 * 60 * 1000,
    maxRangeMsEnvironmental: 30 * 24 * 60 * 60 * 1000,
    maxRangeMsSummary: 30 * 24 * 60 * 60 * 1000,
    // Bound a single save payload — a meter aggregates channels, not fleets.
    maxPointsPerMeter: 512,
    maxFormulaTerms: 256,
    maxTariffId: 2_147_483_647
} as const;

// --- Query ---------------------------------------------------------------

export interface EnergyQueryParams {
    /** ISO-8601 inclusive start timestamp */
    from: string;
    /** ISO-8601 exclusive end timestamp */
    to: string;
    /** One or more metric tags */
    tags: EnergyQueryTag[];
    /**
     * Commodity filter (electricity / water / gas / heat). Omitted → all
     * commodities; each domain still comes back as its own row. Energy path.
     */
    commodity?: EnergyCommodity;
    /**
     * Electrical-source filter (ac_mains / …). Omitted → all sources. Pair
     * with commodity=electricity to isolate AC mains.
     */
    electricalSource?: ElectricalSource;
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
    /**
     * Ask Fleet to price the selected energy from authoritative stored tariffs.
     * Device/channel assignments are always considered. tariffId is an
     * explicit fallback. An empty object means assignments-only pricing.
     */
    pricing?: EnergyQueryPricingParams;
}

export interface EnergyQueryPricingParams {
    tariffId?: number;
    /** Optional feed-in/export tariff. Never inferred from the import tariff. */
    exportTariffId?: number;
}

export type EnergyQueryPricingStatus = 'priced' | 'partial' | 'unconfigured';

export type EnergyQueryTariffSource =
    | 'assignments'
    | 'explicit'
    | 'mixed'
    | 'none';

export type EnergyQueryExportTariffSource = 'assignments' | 'explicit' | 'none';

export interface EnergyQueryPricingSummary {
    status: EnergyQueryPricingStatus;
    /** ISO-4217-style tariff currency; null when no energy is priced. */
    currency: string | null;
    /** Unit of the quantity priced by the tariff (for example kWh or m3). */
    billedUnit: string;
    /** Explicit gas conversion revisions used by this priced response. */
    gasConversions?: Array<{
        profileId: number;
        profileRevision: number;
        billedUnit: string;
        calorificValueIds: number[];
        calorificValueRevisions: number[];
    }>;
    /**
     * Consumption-only charge. Null unless every consumed billed unit is
     * covered. Standing charge, demand charge and VAT are intentionally not
     * included.
     */
    energyCost: number | null;
    /** Cost of the covered portion; useful when status='partial'. */
    coveredEnergyCost: number;
    /** Canonical quantities expressed in billedUnit. */
    consumptionQuantity: number;
    returnedQuantity: number;
    coveredConsumptionQuantity: number;
    unpricedConsumptionQuantity: number;
    estimatedQuantity: number;
    /** @deprecated Use consumptionQuantity; retained for old electricity clients. */
    consumptionKWh: number;
    /** @deprecated Use returnedQuantity. */
    returnedKWh: number;
    /** @deprecated Use coveredConsumptionQuantity. */
    coveredConsumptionKWh: number;
    /** @deprecated Use unpricedConsumptionQuantity. */
    unpricedConsumptionKWh: number;
    dayEnergyCost: number;
    nightEnergyCost: number;
    /** @deprecated Use estimatedQuantity. */
    estimatedKWh: number;
    source: EnergyQueryTariffSource;
    /** Exact winning assignment/fallback levels present in the priced rows. */
    assignmentSources: string[];
    /** Every tariff that contributed to the priced portion. */
    tariffIds: number[];
    /** Currency of the export tariff, when configured. */
    exportCurrency: string | null;
    /** Credit for returned/exported energy; null without an explicit export tariff. */
    exportCredit: number | null;
    /** Import energyCost minus exportCredit, only when both sides are authoritative. */
    netEnergyCost: number | null;
    /** Explicit export tariff used for the credit. */
    exportTariffId: number | null;
    /** Every persisted or explicit export tariff that contributed. */
    exportTariffIds: number[];
    exportSource: EnergyQueryExportTariffSource;
    /** Exact winning export assignment/fallback levels present in priced rows. */
    exportAssignmentSources: string[];
}

export interface EnergyQueryRow {
    /** Bucket timestamp (ISO-8601) */
    bucket: string;
    /** Logical-meter id — present only on meterIds-scoped rows */
    meterId?: number;
    /** Derived from the logical meter's topology edge for meter-scoped rows. */
    balancePosition?: EnergyBalancePosition;
    /** Internal device id when `perDevice=true`, else 0 */
    device: number;
    /** Device shellyID when `perDevice=true`, else null */
    shellyID: string | null;
    /** Metric tag */
    tag: EnergyQueryTag;
    /** Electrical domain this row was read from (ac_mains / dc_battery / …). */
    domain: string;
    /** Aggregated value in display units (kWh / V / A / W / °C / % / lux) */
    value: number;
    /** Bucket minimum — present for environmental tags */
    min?: number | null;
    /** Bucket maximum — present for environmental tags */
    max?: number | null;
    /** Phase letter when `perPhase=true` (energy tags only) */
    phase?: 'a' | 'b' | 'c';
    /**
     * Reading source — present for device_sensor tags. One of
     * internal/builtin/addon/blu/weather; separates a device's own chip
     * reading from a paired BLU/weather-station sensor.
     */
    source?: string;
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
    /** Present only when the request includes `pricing`. */
    pricing?: EnergyQueryPricingSummary;
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
        commodity: {
            type: 'string',
            enum: [...ENERGY_COMMODITIES],
            description:
                'Commodity filter (electricity / water / gas / heat). Omitted returns all.'
        },
        electricalSource: {
            type: 'string',
            enum: [...ELECTRICAL_SOURCES],
            description:
                'Electrical-source filter (ac_mains / dc_*). Omitted returns all.'
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
        totals: {type: 'boolean'},
        pricing: {
            type: 'object',
            additionalProperties: false,
            properties: {
                tariffId: {
                    type: 'integer',
                    minimum: 1,
                    maximum: ENERGY_LIMITS.maxTariffId
                },
                exportTariffId: {
                    type: 'integer',
                    minimum: 1,
                    maximum: ENERGY_LIMITS.maxTariffId
                }
            },
            description:
                'Server-side stored-tariff pricing. Device/channel assignments apply automatically; tariffId supplies an optional fallback.'
        }
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
                required: [
                    'bucket',
                    'device',
                    'shellyID',
                    'tag',
                    'domain',
                    'value'
                ],
                properties: {
                    bucket: {type: 'string'},
                    meterId: {type: 'number'},
                    balancePosition: {
                        type: 'string',
                        enum: [...ENERGY_BALANCE_POSITIONS]
                    },
                    device: {type: 'number'},
                    shellyID: {
                        type: ['string', 'null'] as JsonSchemaType[]
                    },
                    tag: {type: 'string'},
                    domain: {type: 'string'},
                    value: {type: 'number'},
                    min: {type: ['number', 'null'] as JsonSchemaType[]},
                    max: {type: ['number', 'null'] as JsonSchemaType[]},
                    phase: {type: 'string', enum: ['a', 'b', 'c']},
                    source: {type: 'string'}
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
        },
        pricing: {
            type: 'object',
            required: [
                'status',
                'currency',
                'billedUnit',
                'energyCost',
                'coveredEnergyCost',
                'consumptionQuantity',
                'returnedQuantity',
                'coveredConsumptionQuantity',
                'unpricedConsumptionQuantity',
                'estimatedQuantity',
                'consumptionKWh',
                'returnedKWh',
                'coveredConsumptionKWh',
                'unpricedConsumptionKWh',
                'dayEnergyCost',
                'nightEnergyCost',
                'estimatedKWh',
                'source',
                'assignmentSources',
                'tariffIds',
                'exportCurrency',
                'exportCredit',
                'netEnergyCost',
                'exportTariffId',
                'exportTariffIds',
                'exportSource',
                'exportAssignmentSources'
            ],
            properties: {
                status: {
                    type: 'string',
                    enum: ['priced', 'partial', 'unconfigured']
                },
                currency: {
                    type: ['string', 'null'] as JsonSchemaType[]
                },
                billedUnit: {type: 'string'},
                gasConversions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: [
                            'profileId',
                            'profileRevision',
                            'billedUnit',
                            'calorificValueIds',
                            'calorificValueRevisions'
                        ],
                        properties: {
                            profileId: {type: 'integer'},
                            profileRevision: {type: 'integer'},
                            billedUnit: {type: 'string'},
                            calorificValueIds: {
                                type: 'array',
                                items: {type: 'integer'}
                            },
                            calorificValueRevisions: {
                                type: 'array',
                                items: {type: 'integer'}
                            }
                        }
                    }
                },
                energyCost: {
                    type: ['number', 'null'] as JsonSchemaType[]
                },
                coveredEnergyCost: {type: 'number'},
                consumptionQuantity: {type: 'number'},
                returnedQuantity: {type: 'number'},
                coveredConsumptionQuantity: {type: 'number'},
                unpricedConsumptionQuantity: {type: 'number'},
                estimatedQuantity: {type: 'number'},
                consumptionKWh: {type: 'number'},
                returnedKWh: {type: 'number'},
                coveredConsumptionKWh: {type: 'number'},
                unpricedConsumptionKWh: {type: 'number'},
                dayEnergyCost: {type: 'number'},
                nightEnergyCost: {type: 'number'},
                estimatedKWh: {type: 'number'},
                source: {
                    type: 'string',
                    enum: ['assignments', 'explicit', 'mixed', 'none']
                },
                assignmentSources: {
                    type: 'array',
                    items: {type: 'string'}
                },
                tariffIds: {
                    type: 'array',
                    items: {type: 'integer'}
                },
                exportCurrency: {
                    type: ['string', 'null'] as JsonSchemaType[]
                },
                exportCredit: {
                    type: ['number', 'null'] as JsonSchemaType[]
                },
                netEnergyCost: {
                    type: ['number', 'null'] as JsonSchemaType[]
                },
                exportTariffId: {
                    type: ['integer', 'null'] as JsonSchemaType[]
                },
                exportTariffIds: {
                    type: 'array',
                    items: {type: 'integer'}
                },
                exportSource: {
                    type: 'string',
                    enum: ['assignments', 'explicit', 'none']
                },
                exportAssignmentSources: {
                    type: 'array',
                    items: {type: 'string'}
                }
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

// --- Projection ----------------------------------------------------------

// The end-of-period run rate. The maths has one home — `model/report/
// projection.ts` — and this is how a caller other than the report job reaches
// it, so no client has to grow a second rule.

export interface EnergyProjectionParams {
    /** ISO-8601 start of the period being projected. */
    from: string;
    /** ISO-8601 end of that period; may be in the future. */
    to: string;
    /** Scope: group / location / tag / fleet (mutually exclusive with `devices`) */
    scope?: DashboardScope;
    /** Scope: explicit device shellyIDs (mutually exclusive with `scope`) */
    devices?: string[];
    /** Commodity filter — same meaning as Energy.Query. */
    commodity?: EnergyCommodity;
    /** Electrical-source filter — same meaning as Energy.Query. */
    electricalSource?: ElectricalSource;
    /**
     * The caller's own priced total for the part of the period already
     * observed. Cost is projected by the same ratio as energy, so the caller
     * keeps whichever tariff it prices with. Omitted → 0.
     */
    costSoFar?: number;
    /** Flat always-on draw per day; it is added back, never scaled. */
    baselineKWhPerDay?: number;
}

export interface EnergyProjectionResponse {
    /** End-of-period energy at the observed pace. */
    projectedKWh: number;
    /** `costSoFar` scaled by the same ratio; 0 when no cost was supplied. */
    projectedCost: number;
    /**
     * Half-width of the expected range as a fraction of the projection.
     * Null means there was nothing to project from — the caller must say so
     * rather than print a number.
     */
    confidenceBand: number | null;
    /** The projection as a readable kWh range, e.g. "290 to 310"; null with no band. */
    range: string | null;
    /** True iff a partial period's remainder was extrapolated. */
    extrapolated: boolean;
    /** Calendar days of readings the projection was measured from. */
    observedDays: number;
    /** kWh observed so far in the period. */
    observedKWh: number;
}

export const ENERGY_PROJECTION_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['from', 'to'],
    properties: {
        from: {type: 'string', minLength: 1, description: 'ISO-8601 start'},
        to: {
            type: 'string',
            minLength: 1,
            description: 'ISO-8601 period end — may be in the future'
        },
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {
            type: 'array',
            minItems: 1,
            maxItems: ENERGY_LIMITS.maxDevicesPerQuery,
            items: {type: 'string', minLength: 1},
            description: 'shellyID allowlist — mutually exclusive with scope'
        },
        commodity: {type: 'string', enum: [...ENERGY_COMMODITIES]},
        electricalSource: {type: 'string', enum: [...ELECTRICAL_SOURCES]},
        costSoFar: {
            type: 'number',
            description:
                "The caller's priced total for the observed part of the period"
        },
        baselineKWhPerDay: {type: 'number', minimum: 0}
    }
};

export const ENERGY_PROJECTION_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'projectedKWh',
        'projectedCost',
        'confidenceBand',
        'range',
        'extrapolated',
        'observedDays',
        'observedKWh'
    ],
    properties: {
        projectedKWh: {type: 'number'},
        projectedCost: {type: 'number'},
        confidenceBand: {type: ['number', 'null'] as JsonSchemaType[]},
        range: {type: ['string', 'null'] as JsonSchemaType[]},
        extrapolated: {type: 'boolean'},
        observedDays: {type: 'number'},
        observedKWh: {type: 'number'}
    }
};

// --- Sync status ---------------------------------------------------------

export interface EnergySyncStatusParams {
    scope?: DashboardScope;
    devices?: string[];
}

export interface EnergySyncDeviceStatus {
    device: number;
    shellyID: string;
    channel: number;
    syncedThrough: string | null;
    lagSeconds: number;
    progressPct: number;
    rollupPendingBuckets: number;
    /** Buckets waiting for their period to close; their energy is provisional. */
    rollupScheduledBuckets: number;
}

/**
 * A stretch of meter history Fleet knows is incomplete: minutes with no record
 * and no device gap, or a lifetime counter change the stored energy does not
 * match. Reports and bills that overlap it say so instead of showing zero.
 */
export interface EnergyIncompleteRange {
    device: string;
    channel: number;
    kind: 'missing_records' | 'counter_mismatch';
    tag: string;
    from: string;
    to: string;
    /** Counter change in Wh for `counter_mismatch`, else null. */
    expectedWh: number | null;
    /** Stored energy in Wh for `counter_mismatch`, else null. */
    storedWh: number | null;
}

export const ENERGY_INCOMPLETE_RANGE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'device',
        'channel',
        'kind',
        'tag',
        'from',
        'to',
        'expectedWh',
        'storedWh'
    ],
    properties: {
        device: {type: 'string'},
        channel: {type: 'integer'},
        kind: {type: 'string', enum: ['missing_records', 'counter_mismatch']},
        tag: {type: 'string'},
        from: {type: 'string'},
        to: {type: 'string'},
        expectedWh: {type: ['number', 'null']},
        storedWh: {type: ['number', 'null']}
    }
};

export interface EnergySyncStatusResponse {
    asOf: string;
    complete: boolean;
    progressPct: number;
    devicesTotal: number;
    devicesCatchingUp: number;
    channelsCatchingUp: number;
    historyRemainingSeconds: number;
    rollupPendingBuckets: number;
    /** Buckets waiting for their period to close; not pending work. */
    rollupScheduledBuckets: number;
    /** True while a covered period is still open: values may still grow. */
    provisional: boolean;
    oldestRollupAgeSeconds: number;
    devices: EnergySyncDeviceStatus[];
}

export const ENERGY_SYNC_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {
            type: 'array',
            maxItems: ENERGY_LIMITS.maxDevicesPerQuery,
            items: {type: 'string', minLength: 1}
        }
    }
};

export const ENERGY_SYNC_STATUS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'asOf',
        'complete',
        'progressPct',
        'devicesTotal',
        'devicesCatchingUp',
        'channelsCatchingUp',
        'historyRemainingSeconds',
        'rollupPendingBuckets',
        'rollupScheduledBuckets',
        'provisional',
        'oldestRollupAgeSeconds',
        'devices'
    ],
    properties: {
        asOf: {type: 'string'},
        complete: {type: 'boolean'},
        progressPct: {type: 'number'},
        devicesTotal: {type: 'number'},
        devicesCatchingUp: {type: 'number'},
        channelsCatchingUp: {type: 'number'},
        historyRemainingSeconds: {type: 'number'},
        rollupPendingBuckets: {type: 'number'},
        rollupScheduledBuckets: {type: 'number'},
        provisional: {type: 'boolean'},
        oldestRollupAgeSeconds: {type: 'number'},
        devices: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'device',
                    'shellyID',
                    'channel',
                    'syncedThrough',
                    'lagSeconds',
                    'progressPct',
                    'rollupPendingBuckets',
                    'rollupScheduledBuckets'
                ],
                properties: {
                    device: {type: 'number'},
                    shellyID: {type: 'string'},
                    channel: {type: 'number'},
                    syncedThrough: {
                        type: ['string', 'null'] as JsonSchemaType[]
                    },
                    lagSeconds: {type: 'number'},
                    progressPct: {type: 'number'},
                    rollupPendingBuckets: {type: 'number'},
                    rollupScheduledBuckets: {type: 'number'}
                }
            }
        }
    }
};

export interface EnergyRejectedSyncBlocksParams {
    scope?: DashboardScope;
    devices?: string[];
    openOnly?: boolean;
    limit?: number;
}

export interface EnergyRejectedSyncBlock {
    id: number;
    device: number;
    shellyID: string;
    channel: number;
    cursorCreated: number;
    rowCount: number;
    firstTs: number | null;
    lastTs: number | null;
    sqlstate: string | null;
    message: string;
    rejectedAt: string;
    requeuedAt: string | null;
    requeuedBy: string | null;
}

export interface EnergyRejectedSyncBlocksResponse {
    openCount: number;
    blocks: EnergyRejectedSyncBlock[];
}

export interface EnergyRequeueRejectedSyncBlockParams {
    id: number;
}

export interface EnergyRequeueRejectedSyncBlockResponse {
    id: number;
    queued: boolean;
}

export const ENERGY_REJECTED_SYNC_BLOCKS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {
            type: 'array',
            maxItems: ENERGY_LIMITS.maxDevicesPerQuery,
            items: {type: 'string', minLength: 1}
        },
        openOnly: {type: 'boolean'},
        limit: {type: 'integer', minimum: 1, maximum: 1000}
    }
};

export const ENERGY_REJECTED_SYNC_BLOCKS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['openCount', 'blocks'],
    properties: {
        openCount: {type: 'number'},
        blocks: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'device',
                    'shellyID',
                    'channel',
                    'cursorCreated',
                    'rowCount',
                    'firstTs',
                    'lastTs',
                    'sqlstate',
                    'message',
                    'rejectedAt',
                    'requeuedAt',
                    'requeuedBy'
                ],
                properties: {
                    id: {type: 'number'},
                    device: {type: 'number'},
                    shellyID: {type: 'string'},
                    channel: {type: 'number'},
                    cursorCreated: {type: 'number'},
                    rowCount: {type: 'number'},
                    firstTs: {type: ['number', 'null'] as JsonSchemaType[]},
                    lastTs: {type: ['number', 'null'] as JsonSchemaType[]},
                    sqlstate: {type: ['string', 'null'] as JsonSchemaType[]},
                    message: {type: 'string'},
                    rejectedAt: {type: 'string'},
                    requeuedAt: {
                        type: ['string', 'null'] as JsonSchemaType[]
                    },
                    requeuedBy: {
                        type: ['string', 'null'] as JsonSchemaType[]
                    }
                }
            }
        }
    }
};

export const ENERGY_REQUEUE_REJECTED_SYNC_BLOCK_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: {type: 'integer', minimum: 1}
    }
};

export const ENERGY_REQUEUE_REJECTED_SYNC_BLOCK_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'queued'],
    properties: {
        id: {type: 'number'},
        queued: {type: 'boolean'}
    }
};

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
    'volume_returned_m3',
    'volume_storage_l',
    'volume_flow_m3h',
    'thermal_energy_kwh',
    // Battery-monitor (bm) telemetry — the classifier produces these for
    // dc_battery points, so they stay in lockstep with the runtime EnergyTag.
    'soc',
    'soh',
    'cycles',
    'charge_ah',
    'discharge_ah'
] as const;

// One home for the electrical-domain vocabulary — see ENERGY_DOMAINS above.
const ENERGY_CLASSIFICATION_DOMAINS = ENERGY_DOMAINS;

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

export const ENERGY_COMMODITY_REPAIR_TAGS = [
    'total_act_energy',
    'total_act_ret_energy',
    'volume_l',
    'volume_m3'
] as const;

export const ENERGY_COMMODITY_REPAIR_INELIGIBILITY_REASONS = [
    'no_source_rows',
    'rollup_conflict',
    'raw_conflict',
    'pending_rollup'
] as const;

export interface EnergyPreviewCommodityRepairParams {
    deviceId: number;
    channel: number;
    tag: (typeof ENERGY_COMMODITY_REPAIR_TAGS)[number];
    from: string;
    to: string;
    expectedCommodity: EnergyCommodity;
    expectedElectricalSource: ElectricalSource | null;
    targetCommodity: EnergyCommodity;
    targetElectricalSource: ElectricalSource | null;
    sourceReference: string;
}

export interface EnergyPreviewCommodityRepairResponse {
    previewId: number;
    eligible: boolean;
    rowCount: number;
    rawRowCount: number;
    quantity: number;
    conflictCount: number;
    rollupConflictCount: number;
    rawConflictCount: number;
    dirtyCount: number;
    ineligibilityReasons: Array<
        (typeof ENERGY_COMMODITY_REPAIR_INELIGIBILITY_REASONS)[number]
    >;
    firstBucket: string | null;
    lastBucket: string | null;
}

export interface EnergyApplyCommodityRepairParams {
    previewId: number;
    deviceId: number;
}

export interface EnergyApplyCommodityRepairResponse {
    previewId: number;
    status: 'applied';
    appliedRows: number;
    rawRowsReclassified: number;
    coverageStart: string;
    appliedAt: string;
}

const NULLABLE_ELECTRICAL_SOURCE_SCHEMA: JsonSchema = {
    type: ['string', 'null'] as JsonSchemaType[],
    enum: [...ELECTRICAL_SOURCES, null]
};

export const ENERGY_PREVIEW_COMMODITY_REPAIR_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'deviceId',
        'channel',
        'tag',
        'from',
        'to',
        'expectedCommodity',
        'expectedElectricalSource',
        'targetCommodity',
        'targetElectricalSource',
        'sourceReference'
    ],
    additionalProperties: false,
    properties: {
        deviceId: {type: 'integer', minimum: 1},
        channel: {type: 'integer', minimum: 0, maximum: 32767},
        tag: {type: 'string', enum: [...ENERGY_COMMODITY_REPAIR_TAGS]},
        from: {type: 'string', format: 'date-time'},
        to: {type: 'string', format: 'date-time'},
        expectedCommodity: {
            type: 'string',
            enum: ['electricity', 'water', 'gas', 'heat']
        },
        expectedElectricalSource: NULLABLE_ELECTRICAL_SOURCE_SCHEMA,
        targetCommodity: {
            type: 'string',
            enum: ['electricity', 'water', 'gas', 'heat']
        },
        targetElectricalSource: NULLABLE_ELECTRICAL_SOURCE_SCHEMA,
        sourceReference: {type: 'string', minLength: 1, maxLength: 500}
    }
};

export const ENERGY_PREVIEW_COMMODITY_REPAIR_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'previewId',
        'eligible',
        'rowCount',
        'rawRowCount',
        'quantity',
        'conflictCount',
        'rollupConflictCount',
        'rawConflictCount',
        'dirtyCount',
        'ineligibilityReasons',
        'firstBucket',
        'lastBucket'
    ],
    additionalProperties: false,
    properties: {
        previewId: {type: 'integer', minimum: 1},
        eligible: {type: 'boolean'},
        rowCount: {type: 'integer', minimum: 0},
        rawRowCount: {type: 'integer', minimum: 0},
        quantity: {type: 'number'},
        conflictCount: {type: 'integer', minimum: 0},
        rollupConflictCount: {type: 'integer', minimum: 0},
        rawConflictCount: {type: 'integer', minimum: 0},
        dirtyCount: {type: 'integer', minimum: 0},
        ineligibilityReasons: {
            type: 'array',
            items: {
                type: 'string',
                enum: [...ENERGY_COMMODITY_REPAIR_INELIGIBILITY_REASONS]
            }
        },
        firstBucket: {type: ['string', 'null'] as JsonSchemaType[]},
        lastBucket: {type: ['string', 'null'] as JsonSchemaType[]}
    }
};

export const ENERGY_APPLY_COMMODITY_REPAIR_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['previewId', 'deviceId'],
    additionalProperties: false,
    properties: {
        previewId: {type: 'integer', minimum: 1},
        deviceId: {type: 'integer', minimum: 1}
    }
};

export const ENERGY_APPLY_COMMODITY_REPAIR_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'previewId',
        'status',
        'appliedRows',
        'rawRowsReclassified',
        'coverageStart',
        'appliedAt'
    ],
    additionalProperties: false,
    properties: {
        previewId: {type: 'integer', minimum: 1},
        status: {type: 'string', enum: ['applied']},
        appliedRows: {type: 'integer', minimum: 1},
        rawRowsReclassified: {type: 'integer', minimum: 0},
        coverageStart: {type: 'string'},
        appliedAt: {type: 'string'}
    }
};

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

// The two vocabularies name the same four utilities and differ on one word, so
// the bridge lives here beside both rather than being re-guessed per caller.
const UTILITY_TYPE_BY_COMMODITY: Readonly<
    Record<EnergyCommodity, EnergyUtilityType>
> = {
    electricity: 'electric',
    gas: 'gas',
    water: 'water',
    heat: 'heat'
};

export function utilityTypeForCommodity(
    commodity: EnergyCommodity
): EnergyUtilityType {
    return UTILITY_TYPE_BY_COMMODITY[commodity];
}

/** Additive measurement tags that can back one logical-meter utility. */
export const ENERGY_METER_TAGS_BY_UTILITY: Readonly<
    Record<EnergyUtilityType, readonly string[]>
> = {
    electric: ['total_act_energy'],
    gas: ['volume_m3', 'volume_returned_m3', 'volume_l'],
    water: ['volume_m3', 'volume_l'],
    heat: ['thermal_energy_kwh', 'total_act_energy']
};

export function meterTagsForUtility(
    utilityType: EnergyUtilityType
): readonly string[] {
    return ENERGY_METER_TAGS_BY_UTILITY[utilityType];
}

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
    /** AC/DC physics, independent of generation source and storage role. */
    currentType?: EnergyCurrentType | null;
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
    currentType: true,
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
    /** Open per-organization end-use axis (space heating, cooking, etc.). */
    kindId?: string | null;
    /** Revision of the effective-dated role/end-use interpretation. */
    meaningRevision?: number;
    /** UTC interval start; null denotes the migrated beginning of history. */
    meaningEffectiveFrom?: string | null;
    /** Open registry id describing how produced energy originated. */
    energySource?: EnergySource | null;
    /** Derived from fm.meter_connection; boiler own-use remains final. */
    balancePosition?: EnergyBalancePosition;
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
    /** Open built-in/per-organization energy-source registry id. */
    energySource?: EnergySource | null;
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

export interface EnergyLogicalMeterMeaning {
    meterId: number;
    revision: number;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    role: EnergyMeterRole;
    kindId: string | null;
}

export const ENERGY_MEANING_EVIDENCE_CODES = [
    'declared_role',
    'missing_end_use',
    'generic_aux_role',
    'energy_source',
    'topology_connection',
    'point_domain',
    'point_tag',
    'name_keyword'
] as const;
export const ENERGY_MEANING_REASON_CODES = [
    'end_use_unclassified',
    'role_requires_review',
    'role_supported_by_topology',
    'role_supported_by_source',
    'role_supported_by_measurement',
    'weak_name_only_evidence'
] as const;
export const ENERGY_MEANING_INELIGIBILITY_REASONS = [
    'meter_not_found',
    'revision_changed',
    'meaning_unchanged',
    'effective_from_not_in_history',
    'effective_from_on_existing_boundary',
    'effective_from_not_aligned',
    'kind_not_available'
] as const;

export interface EnergyLogicalMeterMeaningEvidence {
    code: (typeof ENERGY_MEANING_EVIDENCE_CODES)[number];
    detail: string;
}

export interface EnergyLogicalMeterMeaningReviewItem {
    meterId: number;
    name: string;
    utilityType: EnergyUtilityType;
    current: EnergyLogicalMeterMeaning;
    suggestion: {
        role: EnergyMeterRole;
        kindId: string | null;
        confidence: number;
        evidence: EnergyLogicalMeterMeaningEvidence[];
        reasonCodes: Array<(typeof ENERGY_MEANING_REASON_CODES)[number]>;
    };
}

export interface EnergyListLogicalMeterMeaningReviewQueueParams {
    limit?: number;
    cursor?: {confidence: number; meterId: number};
}
export interface EnergyListLogicalMeterMeaningReviewQueueResponse {
    items: EnergyLogicalMeterMeaningReviewItem[];
    nextCursor: {confidence: number; meterId: number} | null;
}

export interface EnergyListLogicalMeterMeaningHistoryParams {
    meterId: number;
    limit?: number;
    beforeRevision?: number;
}
export interface EnergyListLogicalMeterMeaningHistoryResponse {
    versions: EnergyLogicalMeterMeaning[];
    nextBeforeRevision: number | null;
}

export interface EnergyMeaningAffectedRecords {
    count: number;
    ids: number[];
    truncated: boolean;
}

export interface EnergyLogicalMeterMeaningChangeImpact {
    dashboards: EnergyMeaningAffectedRecords;
    alerts: EnergyMeaningAffectedRecords;
    tariffAssignments: EnergyMeaningAffectedRecords;
    reportInterpretation: {from: string; to: string | null};
}

export interface EnergyPreviewLogicalMeterMeaningChangeParams {
    meterId: number;
    expectedRevision: number;
    effectiveFrom: string;
    role: EnergyMeterRole;
    kindId: string | null;
    sourceReference: string;
}
export interface EnergyPreviewLogicalMeterMeaningChangeResponse {
    previewId: number;
    eligible: boolean;
    ineligibilityReasons: Array<
        (typeof ENERGY_MEANING_INELIGIBILITY_REASONS)[number]
    >;
    current: EnergyLogicalMeterMeaning;
    proposed: EnergyLogicalMeterMeaning;
    affected: EnergyLogicalMeterMeaningChangeImpact;
}

export interface EnergyApplyLogicalMeterMeaningChangeParams {
    previewId: number;
    meterId: number;
    expectedRevision: number;
}
export interface EnergyApplyLogicalMeterMeaningChangeResponse {
    previewId: number;
    status: 'applied';
    meterId: number;
    revision: number;
    effectiveFrom: string;
    appliedAt: string;
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
        currentType: {
            type: ['string', 'null'] as JsonSchemaType[],
            enum: [...ENERGY_CURRENT_TYPES, null]
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
        meaningRevision: {type: 'integer', minimum: 1},
        meaningEffectiveFrom: {
            type: ['string', 'null'] as JsonSchemaType[]
        },
        energySource: {type: ['string', 'null'] as JsonSchemaType[]},
        balancePosition: {
            type: 'string',
            enum: [...ENERGY_BALANCE_POSITIONS]
        },
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
        energySource: {
            type: ['string', 'null'] as JsonSchemaType[],
            minLength: 1,
            maxLength: 120
        },
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

const ENERGY_LOGICAL_METER_MEANING_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'meterId',
        'revision',
        'effectiveFrom',
        'effectiveTo',
        'role',
        'kindId'
    ],
    additionalProperties: false,
    properties: {
        meterId: {type: 'integer', minimum: 1},
        revision: {type: 'integer', minimum: 1},
        effectiveFrom: {type: ['string', 'null'] as JsonSchemaType[]},
        effectiveTo: {type: ['string', 'null'] as JsonSchemaType[]},
        role: {type: 'string', enum: [...ENERGY_ALL_ROLES]},
        kindId: {type: ['string', 'null'] as JsonSchemaType[]}
    }
};

const ENERGY_MEANING_CURSOR_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['confidence', 'meterId'],
    additionalProperties: false,
    properties: {
        confidence: {type: 'number', minimum: 0, maximum: 1},
        meterId: {type: 'integer', minimum: 1}
    }
};

export const ENERGY_LIST_LOGICAL_METER_MEANING_REVIEW_QUEUE_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        additionalProperties: false,
        properties: {
            limit: {type: 'integer', minimum: 1, maximum: 100},
            cursor: ENERGY_MEANING_CURSOR_SCHEMA
        }
    };

const ENERGY_MEANING_EVIDENCE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['code', 'detail'],
    additionalProperties: false,
    properties: {
        code: {type: 'string', enum: [...ENERGY_MEANING_EVIDENCE_CODES]},
        detail: {type: 'string'}
    }
};

const ENERGY_MEANING_REVIEW_ITEM_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['meterId', 'name', 'utilityType', 'current', 'suggestion'],
    additionalProperties: false,
    properties: {
        meterId: {type: 'integer', minimum: 1},
        name: {type: 'string'},
        utilityType: {type: 'string', enum: [...ENERGY_UTILITY_TYPES]},
        current: ENERGY_LOGICAL_METER_MEANING_SCHEMA,
        suggestion: {
            type: 'object',
            required: [
                'role',
                'kindId',
                'confidence',
                'evidence',
                'reasonCodes'
            ],
            additionalProperties: false,
            properties: {
                role: {type: 'string', enum: [...ENERGY_ALL_ROLES]},
                kindId: {type: ['string', 'null'] as JsonSchemaType[]},
                confidence: {type: 'number', minimum: 0, maximum: 1},
                evidence: {
                    type: 'array',
                    maxItems: 12,
                    items: ENERGY_MEANING_EVIDENCE_SCHEMA
                },
                reasonCodes: {
                    type: 'array',
                    maxItems: 6,
                    items: {
                        type: 'string',
                        enum: [...ENERGY_MEANING_REASON_CODES]
                    }
                }
            }
        }
    }
};

export const ENERGY_LIST_LOGICAL_METER_MEANING_REVIEW_QUEUE_RESPONSE_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['items', 'nextCursor'],
        additionalProperties: false,
        properties: {
            items: {
                type: 'array',
                maxItems: 100,
                items: ENERGY_MEANING_REVIEW_ITEM_SCHEMA
            },
            nextCursor: {
                ...ENERGY_MEANING_CURSOR_SCHEMA,
                type: ['object', 'null'] as JsonSchemaType[]
            }
        }
    };

export const ENERGY_LIST_LOGICAL_METER_MEANING_HISTORY_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['meterId'],
        additionalProperties: false,
        properties: {
            meterId: {type: 'integer', minimum: 1},
            limit: {type: 'integer', minimum: 1, maximum: 100},
            beforeRevision: {type: 'integer', minimum: 1}
        }
    };

export const ENERGY_LIST_LOGICAL_METER_MEANING_HISTORY_RESPONSE_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['versions', 'nextBeforeRevision'],
        additionalProperties: false,
        properties: {
            versions: {
                type: 'array',
                maxItems: 100,
                items: ENERGY_LOGICAL_METER_MEANING_SCHEMA
            },
            nextBeforeRevision: {
                type: ['integer', 'null'] as JsonSchemaType[],
                minimum: 1
            }
        }
    };

const ENERGY_MEANING_AFFECTED_RECORDS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['count', 'ids', 'truncated'],
    additionalProperties: false,
    properties: {
        count: {type: 'integer', minimum: 0},
        ids: {
            type: 'array',
            maxItems: 50,
            items: {type: 'integer', minimum: 1}
        },
        truncated: {type: 'boolean'}
    }
};

const ENERGY_MEANING_IMPACT_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'dashboards',
        'alerts',
        'tariffAssignments',
        'reportInterpretation'
    ],
    additionalProperties: false,
    properties: {
        dashboards: ENERGY_MEANING_AFFECTED_RECORDS_SCHEMA,
        alerts: ENERGY_MEANING_AFFECTED_RECORDS_SCHEMA,
        tariffAssignments: ENERGY_MEANING_AFFECTED_RECORDS_SCHEMA,
        reportInterpretation: {
            type: 'object',
            required: ['from', 'to'],
            additionalProperties: false,
            properties: {
                from: {type: 'string'},
                to: {type: ['string', 'null'] as JsonSchemaType[]}
            }
        }
    }
};

export const ENERGY_PREVIEW_LOGICAL_METER_MEANING_CHANGE_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: [
            'meterId',
            'expectedRevision',
            'effectiveFrom',
            'role',
            'kindId',
            'sourceReference'
        ],
        additionalProperties: false,
        properties: {
            meterId: {type: 'integer', minimum: 1},
            expectedRevision: {type: 'integer', minimum: 1},
            effectiveFrom: {type: 'string', format: 'date-time'},
            role: {type: 'string', enum: [...ENERGY_ALL_ROLES]},
            kindId: {
                type: ['string', 'null'] as JsonSchemaType[],
                maxLength: 200
            },
            sourceReference: {type: 'string', minLength: 1, maxLength: 500}
        }
    };

export const ENERGY_PREVIEW_LOGICAL_METER_MEANING_CHANGE_RESPONSE_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: [
            'previewId',
            'eligible',
            'ineligibilityReasons',
            'current',
            'proposed',
            'affected'
        ],
        additionalProperties: false,
        properties: {
            previewId: {type: 'integer', minimum: 1},
            eligible: {type: 'boolean'},
            ineligibilityReasons: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: [...ENERGY_MEANING_INELIGIBILITY_REASONS]
                }
            },
            current: ENERGY_LOGICAL_METER_MEANING_SCHEMA,
            proposed: ENERGY_LOGICAL_METER_MEANING_SCHEMA,
            affected: ENERGY_MEANING_IMPACT_SCHEMA
        }
    };

export const ENERGY_APPLY_LOGICAL_METER_MEANING_CHANGE_PARAMS_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: ['previewId', 'meterId', 'expectedRevision'],
        additionalProperties: false,
        properties: {
            previewId: {type: 'integer', minimum: 1},
            meterId: {type: 'integer', minimum: 1},
            expectedRevision: {type: 'integer', minimum: 1}
        }
    };

export const ENERGY_APPLY_LOGICAL_METER_MEANING_CHANGE_RESPONSE_SCHEMA: JsonSchema =
    {
        type: 'object',
        required: [
            'previewId',
            'status',
            'meterId',
            'revision',
            'effectiveFrom',
            'appliedAt'
        ],
        additionalProperties: false,
        properties: {
            previewId: {type: 'integer', minimum: 1},
            status: {type: 'string', enum: ['applied']},
            meterId: {type: 'integer', minimum: 1},
            revision: {type: 'integer', minimum: 1},
            effectiveFrom: {type: 'string'},
            appliedAt: {type: 'string'}
        }
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

// --- Baseline -----------------------------------------------------------

export const ENERGY_BASELINE_STATUSES = [
    'ready',
    'insufficient_weeks',
    'no_data'
] as const;
export type EnergyBaselineStatus = (typeof ENERGY_BASELINE_STATUSES)[number];

export interface EnergyBaselineCell {
    hourOfWeek: number;
    median: number | null;
    p25: number | null;
    p75: number | null;
    sampleCount: number;
    weeksObserved: number;
    status: EnergyBaselineStatus;
}

export interface EnergyBaselineTempBand {
    band: BaselineTempBand;
    /** Cut points in the sensor's native unit; the rollup has no unit column. */
    minValue: number;
    maxValue: number;
    sourceDeviceId: number;
    /** Indoor temperature can partly be an effect of the load being modelled. */
    sourceKind: 'weather_station' | 'ambient_sensor';
    readyCells: number;
}

export const ENERGY_BASELINE_CHANGE_STATES = [
    'ok',
    'warning',
    'alarm'
] as const;
export type EnergyBaselineChangeState =
    (typeof ENERGY_BASELINE_CHANGE_STATES)[number];

export interface EnergyBaselineParams {
    organizationId?: string;
    shellyID: string;
    /** Ignored for device-grain tags such as power. Default 0. */
    channel?: number;
    tag: BaselineTag;
    /** Distinct local weeks a cell needs to be usable. Server default 3. */
    minWeeks?: number;
    /** Missing bands fall back to the plain profile with temperatureAdjusted false. */
    temperatureBand?: BaselineTempBand;
}

export interface EnergyBaselineResponse {
    shellyID: string;
    deviceId: number;
    scopeType: 'device' | 'device_channel';
    channel: number;
    tag: BaselineTag;
    /** Cold-start day_type_hour pools working days into 48 bins; hour_of_week is 168. */
    binScheme: 'day_type_hour' | 'hour_of_week' | null;
    timezone: string | null;
    firstSeenDay: string | null;
    windowFromDay: string | null;
    excludedDays: number;
    computedAt: string | null;
    readyCells: number;
    /** Always 168 entries, ordered 0 through 167. */
    cells: EnergyBaselineCell[];
    /** True only when cells came from the temperature-banded profile. */
    temperatureAdjusted: boolean;
    /** Empty when no temperature series is linked, which is normal. */
    temperatureBands: EnergyBaselineTempBand[];
    /** Alarm shortens the window; warning is informational only. */
    changeState: EnergyBaselineChangeState;
    changeDetectedOn: string | null;
    changeDirection: 'up' | 'down' | null;
}

export const ENERGY_BASELINE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyID', 'tag'],
    properties: {
        organizationId: {type: 'string', minLength: 1},
        shellyID: {type: 'string', minLength: 1},
        channel: {type: 'number', minimum: 0, maximum: 31},
        tag: {type: 'string', enum: [...BASELINE_TAGS]},
        minWeeks: {
            type: 'number',
            minimum: 2,
            maximum: 26,
            description: 'distinct local weeks a cell needs; server default 3'
        },
        temperatureBand: {
            type: 'string',
            enum: [...BASELINE_TEMP_BANDS],
            description:
                'return the temperature-banded profile for this band instead ' +
                'of the plain one; bands are terciles of the window own ' +
                'temperature series, so they carry no absolute meaning'
        }
    }
};

export const ENERGY_BASELINE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'shellyID',
        'deviceId',
        'scopeType',
        'channel',
        'tag',
        'binScheme',
        'timezone',
        'firstSeenDay',
        'windowFromDay',
        'excludedDays',
        'computedAt',
        'readyCells',
        'cells',
        'temperatureAdjusted',
        'temperatureBands',
        'changeState',
        'changeDetectedOn',
        'changeDirection'
    ],
    properties: {
        shellyID: {type: 'string'},
        deviceId: {type: 'number'},
        scopeType: {type: 'string', enum: ['device', 'device_channel']},
        channel: {type: 'number'},
        tag: {type: 'string', enum: [...BASELINE_TAGS]},
        binScheme: {
            type: ['string', 'null'] as JsonSchemaType[],
            enum: ['day_type_hour', 'hour_of_week', null],
            description:
                'day_type_hour pools working days into 48 bins until the ' +
                'series has enough weeks for the full 168'
        },
        timezone: {type: ['string', 'null'] as JsonSchemaType[]},
        firstSeenDay: {type: ['string', 'null'] as JsonSchemaType[]},
        windowFromDay: {type: ['string', 'null'] as JsonSchemaType[]},
        excludedDays: {type: 'number'},
        computedAt: {type: ['string', 'null'] as JsonSchemaType[]},
        readyCells: {type: 'number'},
        cells: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'hourOfWeek',
                    'median',
                    'p25',
                    'p75',
                    'sampleCount',
                    'weeksObserved',
                    'status'
                ],
                properties: {
                    hourOfWeek: {type: 'number'},
                    median: {type: ['number', 'null'] as JsonSchemaType[]},
                    p25: {type: ['number', 'null'] as JsonSchemaType[]},
                    p75: {type: ['number', 'null'] as JsonSchemaType[]},
                    sampleCount: {type: 'number'},
                    weeksObserved: {type: 'number'},
                    status: {
                        type: 'string',
                        enum: [...ENERGY_BASELINE_STATUSES]
                    }
                }
            }
        },
        temperatureAdjusted: {
            type: 'boolean',
            description:
                'true only when cells came from the temperature-banded ' +
                'profile; it reports which profile answered, not what was asked'
        },
        temperatureBands: {
            type: 'array',
            description:
                'empty when no temperature series is linked to this scope, ' +
                'which is normal and not an error',
            items: {
                type: 'object',
                required: [
                    'band',
                    'minValue',
                    'maxValue',
                    'sourceDeviceId',
                    'sourceKind',
                    'readyCells'
                ],
                properties: {
                    band: {type: 'string', enum: [...BASELINE_TEMP_BANDS]},
                    minValue: {type: 'number'},
                    maxValue: {type: 'number'},
                    sourceDeviceId: {type: 'number'},
                    sourceKind: {
                        type: 'string',
                        enum: ['weather_station', 'ambient_sensor'],
                        description:
                            'ambient_sensor is indoors, so it is partly an ' +
                            'effect of the load being modelled'
                    },
                    readyCells: {type: 'number'}
                }
            }
        },
        changeState: {
            type: 'string',
            enum: [...ENERGY_BASELINE_CHANGE_STATES],
            description:
                'alarm means a level shift was detected and the window was ' +
                'shortened to the new regime; warning is information only'
        },
        changeDetectedOn: {type: ['string', 'null'] as JsonSchemaType[]},
        changeDirection: {
            type: ['string', 'null'] as JsonSchemaType[],
            enum: ['up', 'down', null]
        }
    }
};

// --- Overnight baseline -------------------------------------------------

export const ENERGY_OVERNIGHT_BASELINE_STATUSES = [
    'ready',
    'learning',
    'no_meters'
] as const;
export type EnergyOvernightBaselineStatus =
    (typeof ENERGY_OVERNIGHT_BASELINE_STATUSES)[number];

export const ENERGY_OVERNIGHT_BASELINE_DEFAULT_START = '00:00';
export const ENERGY_OVERNIGHT_BASELINE_DEFAULT_END = '05:00';

export interface EnergyOvernightBaselineParams {
    organizationId?: string;
    /** A location and every place under it. Omitted means the caller's reach. */
    locationId?: number;
    /** Local 'HH:MM'. Server default 00:00. */
    nightStart?: string;
    /** Local 'HH:MM', exclusive. Server default 05:00. May cross midnight. */
    nightEnd?: string;
    /** Distinct local weeks a meter needs to count as ready. Server default 3. */
    minWeeks?: number;
}

/** The effective local night window, echoed so a caller sees the defaults. */
export interface EnergyOvernightBaselineWindow {
    start: string;
    end: string;
}

export interface EnergyOvernightBaselineResponse {
    status: EnergyOvernightBaselineStatus;
    /** The organization's resolved zone. Never the server clock. */
    timeZone: string;
    window: EnergyOvernightBaselineWindow;
    metersConsidered: number;
    metersReady: number;
    /** Fewest distinct local weeks behind any ready meter; 0 when none is. */
    weeksObserved: number;
    /** Null until every considered meter is ready — a partial sum is not one. */
    baselineKw: number | null;
    /** Measured mean draw over the most recent completed night window. */
    lastNightKw: number | null;
    deviationPct: number | null;
}

export const ENERGY_OVERNIGHT_BASELINE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        organizationId: {type: 'string', minLength: 1},
        locationId: {
            type: 'integer',
            minimum: 1,
            description:
                'a location and every place under it; omitted reads the ' +
                "caller's whole reach"
        },
        nightStart: {
            type: 'string',
            pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
            description: 'local start of the night window; server default 00:00'
        },
        nightEnd: {
            type: 'string',
            pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
            description:
                'local end of the night window, exclusive; server default ' +
                '05:00. An end before the start crosses midnight'
        },
        minWeeks: {
            type: 'number',
            minimum: 2,
            maximum: 26,
            description: 'distinct local weeks a meter needs; server default 3'
        }
    }
};

export const ENERGY_OVERNIGHT_BASELINE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'status',
        'timeZone',
        'window',
        'metersConsidered',
        'metersReady',
        'weeksObserved',
        'baselineKw',
        'lastNightKw',
        'deviationPct'
    ],
    properties: {
        status: {
            type: 'string',
            enum: [...ENERGY_OVERNIGHT_BASELINE_STATUSES],
            description:
                'no_meters when nothing readable in scope meters AC-mains ' +
                'power, learning while any considered meter is short of ' +
                'minWeeks, ready when every one of them has it'
        },
        timeZone: {
            type: 'string',
            description:
                "the organization's resolved zone; the night window is read " +
                'in it, never in the server zone'
        },
        window: {
            type: 'object',
            required: ['start', 'end'],
            description:
                'the effective local window the numbers describe, so a caller ' +
                'sees which defaults applied',
            properties: {
                start: {type: 'string'},
                end: {type: 'string'}
            }
        },
        metersConsidered: {type: 'number'},
        metersReady: {type: 'number'},
        weeksObserved: {
            type: 'number',
            description:
                'fewest distinct local weeks behind any ready meter; 0 when ' +
                'no meter is ready'
        },
        baselineKw: {
            type: ['number', 'null'] as JsonSchemaType[],
            description:
                'summed learned night draw in kW: per ready meter the mean of ' +
                'its night-hour medians. Null unless status is ready, because ' +
                'a sum missing a meter reads as a smaller estate, not as a ' +
                'partial answer'
        },
        lastNightKw: {
            type: ['number', 'null'] as JsonSchemaType[],
            description:
                'measured mean draw over the most recent completed night ' +
                'window across the same meters; null when nothing was measured'
        },
        deviationPct: {
            type: ['number', 'null'] as JsonSchemaType[],
            description:
                'lastNightKw against baselineKw as a percentage; null unless ' +
                'both exist and the baseline is non-zero'
        }
    }
};

// --- Baseline exclusions ------------------------------------------------

export interface EnergyBaselineExclusion {
    id: number;
    /** Inclusive local date in the organization's resolved timezone. */
    fromDay: string;
    /** Inclusive local date in the organization's resolved timezone. */
    toDay: string;
    reason: string;
    createdBy: string | null;
    createdAt: string;
}

export type EnergyListBaselineExclusionsParams = Record<string, never>;

export interface EnergyListBaselineExclusionsResponse {
    exclusions: EnergyBaselineExclusion[];
}

export interface EnergySaveBaselineExclusionParams {
    /** Omit to create; pass to update an exclusion owned by this organization. */
    id?: number;
    fromDay: string;
    toDay: string;
    reason: string;
}

export interface EnergySaveBaselineExclusionResponse {
    exclusion: EnergyBaselineExclusion;
}

export interface EnergyDeleteBaselineExclusionParams {
    id: number;
}

export interface EnergyDeleteBaselineExclusionResponse {
    deleted: true;
    removed: EnergyBaselineExclusion;
}

const ISO_LOCAL_DAY_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

const ENERGY_BASELINE_EXCLUSION_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id', 'fromDay', 'toDay', 'reason', 'createdBy', 'createdAt'],
    additionalProperties: false,
    properties: {
        id: {type: 'number', minimum: 1},
        fromDay: {type: 'string', pattern: ISO_LOCAL_DAY_PATTERN},
        toDay: {type: 'string', pattern: ISO_LOCAL_DAY_PATTERN},
        reason: {type: 'string'},
        createdBy: {type: ['string', 'null'] as JsonSchemaType[]},
        createdAt: {type: 'string'}
    }
};

export const ENERGY_LIST_BASELINE_EXCLUSIONS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const ENERGY_LIST_BASELINE_EXCLUSIONS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['exclusions'],
    additionalProperties: false,
    properties: {
        exclusions: {type: 'array', items: ENERGY_BASELINE_EXCLUSION_SCHEMA}
    }
};

export const ENERGY_SAVE_BASELINE_EXCLUSION_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['fromDay', 'toDay', 'reason'],
    additionalProperties: false,
    properties: {
        id: {type: 'number', minimum: 1},
        fromDay: {type: 'string', pattern: ISO_LOCAL_DAY_PATTERN},
        toDay: {type: 'string', pattern: ISO_LOCAL_DAY_PATTERN},
        reason: {type: 'string', minLength: 1, maxLength: 200}
    }
};

export const ENERGY_SAVE_BASELINE_EXCLUSION_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['exclusion'],
    additionalProperties: false,
    properties: {exclusion: ENERGY_BASELINE_EXCLUSION_SCHEMA}
};

export const ENERGY_DELETE_BASELINE_EXCLUSION_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: {type: 'number', minimum: 1}}
};

export const ENERGY_DELETE_BASELINE_EXCLUSION_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['deleted', 'removed'],
    additionalProperties: false,
    properties: {
        deleted: {type: 'boolean', enum: [true]},
        removed: ENERGY_BASELINE_EXCLUSION_SCHEMA
    }
};

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
        safety: {operation: 'read'},
        params: ENERGY_QUERY_PARAMS_SCHEMA,
        response: ENERGY_QUERY_RESPONSE_SCHEMA,
        permission: {
            note: 'Scope-dependent: groupId→groups:read, devices→devices:read per device, fleet→dashboards:read. pricing additionally requires reports:read.'
        },
        description:
            'Unified time-series read for energy (device_em.stats) and sensor (device_sensor) tags. ' +
            'Group / devices / fleet scope selected by params. Mixed tag sets fan out in parallel. ' +
            'Values are scaled to display units (kWh / kvarh / V / A / W / VA / °C / % / lux). ' +
            'Optional pricing uses stored tariffs and device/channel assignments over the same commodity/electricalSource slice; ' +
            'it is limited to 30 days and reports partial/unconfigured coverage explicitly. ' +
            'Omit limit to return the full set (up to the server OOM ceiling); set limit to paginate. ' +
            'total is a lower bound, not exact — has_more is the authoritative "more data exists" signal.'
    })
    .registerMethod('Current', {
        safety: {operation: 'read'},
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
    .registerMethod('Projection', {
        safety: {operation: 'read'},
        params: ENERGY_PROJECTION_PARAMS_SCHEMA,
        response: ENERGY_PROJECTION_RESPONSE_SCHEMA,
        permission: {
            note: 'Scope-dependent: groupId→groups:read, devices→devices:read per device, fleet→dashboards:read'
        },
        description:
            'End-of-period run rate for the selected scope, measured from whole ' +
            'observed days. This is a pace, not a forecast: it models no weather, ' +
            'seasonality or occupancy. confidenceBand is the measured spread of ' +
            'those days, and is null when there was nothing to project from — a ' +
            'caller must then say what it is waiting for instead of printing a ' +
            'number. Pass costSoFar to have money projected by the same ratio as ' +
            'energy, so the caller keeps its own tariff.'
    })
    .registerMethod('SyncStatus', {
        safety: {operation: 'read'},
        params: ENERGY_SYNC_STATUS_PARAMS_SCHEMA,
        response: ENERGY_SYNC_STATUS_RESPONSE_SCHEMA,
        permission: {
            note: 'Scope-dependent: groupId→groups:read, devices→devices:read per device, fleet→dashboards:read'
        },
        description:
            'Show EM history catch-up and report-rollup progress for the selected devices. ' +
            'Progress is derived from device bookmarks and the durable rollup queue.'
    })
    .registerMethod('RejectedSyncBlocks', {
        safety: {operation: 'read'},
        params: ENERGY_REJECTED_SYNC_BLOCKS_PARAMS_SCHEMA,
        response: ENERGY_REJECTED_SYNC_BLOCKS_RESPONSE_SCHEMA,
        permission: {
            note: 'Scope-dependent: groupId→groups:read, devices→devices:read per device, fleet→dashboards:read'
        },
        description:
            'List meter history blocks the database rejected. Each row is one ' +
            'device channel gap with the reason. Nothing is dropped; a block ' +
            'stays here until it is queued again.'
    })
    .registerMethod('RequeueRejectedSyncBlock', {
        params: ENERGY_REQUEUE_REJECTED_SYNC_BLOCK_PARAMS_SCHEMA,
        response: ENERGY_REQUEUE_REJECTED_SYNC_BLOCK_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Queue one rejected meter history block for writing again, after ' +
            'the cause is fixed. Marks the row as requeued; a second call does nothing.'
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
    .registerMethod('PreviewCommodityRepair', {
        safety: {operation: 'read'},
        params: ENERGY_PREVIEW_COMMODITY_REPAIR_PARAMS_SCHEMA,
        response: ENERGY_PREVIEW_COMMODITY_REPAIR_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Preview one bounded historical meter-point commodity repair. Persists the exact eligible snapshot; never changes readings.'
    })
    .registerMethod('ApplyCommodityRepair', {
        params: ENERGY_APPLY_COMMODITY_REPAIR_PARAMS_SCHEMA,
        response: ENERGY_APPLY_COMMODITY_REPAIR_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Apply a previously persisted preview exactly once. Fails if eligible rows changed or the target identity conflicts; briefly pauses metering writes under a bounded maintenance lock.'
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
    .registerMethod('Baseline', {
        safety: {operation: 'read'},
        params: ENERGY_BASELINE_PARAMS_SCHEMA,
        response: ENERGY_BASELINE_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'The learned normal for one device or channel and one tag: the ' +
            'median value and its 25th-75th percentile band in each of the 168 ' +
            'hours of the local week, computed nightly from the 15-minute ' +
            'rollups. Always 168 cells. A cell returns median and band null ' +
            'with status insufficient_weeks until enough distinct weeks stand ' +
            'behind it, so a comparison the data does not support cannot be ' +
            'drawn. Operational signal only: this is not a measurement ' +
            'and verification baseline and must not be used for savings, ' +
            'verification or settlement claims. Operator-excluded days ' +
            '(holidays, outages) are removed; excludedDays reports how many. ' +
            'Pass temperatureBand for a profile split by on-site temperature; ' +
            'bands are terciles of the window own temperature series, so they ' +
            'carry no absolute meaning, and the banded profile is always the ' +
            'coarse 48-bin one. This is band separation, not weather ' +
            'normalisation and not a weather regression. When no temperature ' +
            'series is linked to the scope, or none is asked for, the plain ' +
            'profile is returned and temperatureAdjusted is false; a plain ' +
            'profile whose window crosses a shoulder season shows seasonal ' +
            'drift as a difference from normal. changeState reports whether a ' +
            'level shift was detected: on alarm the window was shortened to ' +
            'the new regime, so most cells read insufficient_weeks until three ' +
            'weeks of it exist.'
    })
    .registerMethod('OvernightBaseline', {
        safety: {operation: 'read'},
        params: ENERGY_OVERNIGHT_BASELINE_PARAMS_SCHEMA,
        response: ENERGY_OVERNIGHT_BASELINE_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'The estate baseline draw at night, as one number, so a caller ' +
            'does not sum 168-cell profiles itself. A meter here is a ' +
            'readable device that meters AC-mains power; the scope is a ' +
            'location and everything under it, or the whole reach when no ' +
            'location is named. baselineKw sums, over those meters, the mean ' +
            'of the learned medians of the hours the night window covers, ' +
            'read in the organization timezone. It stays null while any ' +
            'meter is short of minWeeks: a sum missing a meter reads as a ' +
            'smaller estate rather than as a partial answer, and status says ' +
            'learning with metersReady counting the ones that do have it. ' +
            'lastNightKw is measured, not learned: the mean draw over the ' +
            'most recent completed night window across the same meters, from ' +
            'the 15-minute rollup. deviationPct compares the two and is null ' +
            'unless both exist and the baseline is non-zero. Same standing as ' +
            'Energy.Baseline: operational signal only, not a measurement and ' +
            'verification baseline, so it must not carry a savings or ' +
            'settlement claim.'
    })
    .registerMethod('ListBaselineExclusions', {
        safety: {operation: 'read'},
        params: ENERGY_LIST_BASELINE_EXCLUSIONS_PARAMS_SCHEMA,
        response: ENERGY_LIST_BASELINE_EXCLUSIONS_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'List the inclusive local date ranges this organization has ' +
            'declared must not shape its learned normal.'
    })
    .registerMethod('SaveBaselineExclusion', {
        safety: {operation: 'update', idempotent: false},
        params: ENERGY_SAVE_BASELINE_EXCLUSION_PARAMS_SCHEMA,
        response: ENERGY_SAVE_BASELINE_EXCLUSION_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Create or update one inclusive local date range that must not ' +
            'shape this organization baseline. The authenticated caller is ' +
            'recorded as author. The change takes effect at the next rebuild.'
    })
    .registerMethod('DeleteBaselineExclusion', {
        safety: {operation: 'delete', destructive: true},
        params: ENERGY_DELETE_BASELINE_EXCLUSION_PARAMS_SCHEMA,
        response: ENERGY_DELETE_BASELINE_EXCLUSION_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Delete one organization baseline exclusion and return the range ' +
            'that stopped being excluded. The change takes effect at the next rebuild.'
    })
    .registerMethod('ListMeasurementPoints', {
        safety: {operation: 'read'},
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
    .registerMethod('ListLogicalMeterMeaningReviewQueue', {
        safety: {operation: 'read'},
        params: ENERGY_LIST_LOGICAL_METER_MEANING_REVIEW_QUEUE_PARAMS_SCHEMA,
        response:
            ENERGY_LIST_LOGICAL_METER_MEANING_REVIEW_QUEUE_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'List a bounded review queue for logical meters whose end use is unset ' +
            'or whose role is generic aux. Suggestions disclose confidence, evidence ' +
            'and reason codes; they never apply automatically.'
    })
    .registerMethod('ListLogicalMeterMeaningHistory', {
        safety: {operation: 'read'},
        params: ENERGY_LIST_LOGICAL_METER_MEANING_HISTORY_PARAMS_SCHEMA,
        response: ENERGY_LIST_LOGICAL_METER_MEANING_HISTORY_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'read'},
        description:
            'List one tenant-owned logical meter role/end-use history in bounded ' +
            'revision order. Intervals are half-open UTC instants.'
    })
    .registerMethod('PreviewLogicalMeterMeaningChange', {
        safety: {operation: 'read'},
        params: ENERGY_PREVIEW_LOGICAL_METER_MEANING_CHANGE_PARAMS_SCHEMA,
        response: ENERGY_PREVIEW_LOGICAL_METER_MEANING_CHANGE_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Persist an audited preview of a role/end-use change, including affected ' +
            'dashboards, alerts, tariff assignments and report interpretation.'
    })
    .registerMethod('ApplyLogicalMeterMeaningChange', {
        params: ENERGY_APPLY_LOGICAL_METER_MEANING_CHANGE_PARAMS_SCHEMA,
        response: ENERGY_APPLY_LOGICAL_METER_MEANING_CHANGE_RESPONSE_SCHEMA,
        permission: {component: 'devices', operation: 'update'},
        description:
            'Apply one eligible meaning preview exactly once. Revision and impact ' +
            'checks fail closed when state changed after preview.'
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
