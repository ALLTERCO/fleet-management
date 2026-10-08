/**
 * Public API types for the `Tariff.*` namespace — Describe() contract.
 *
 * Covers the reusable org-level electricity-tariff library: flat / day-night /
 * TOU / seasonal / live / stepped-block kinds, and the assignment that
 * attaches a tariff to a metering point (dashboard / device / channel).
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import type {EnergyCommodity} from './energy';

// ---- Domain types -------------------------------------------------------

export type TariffKind = 'single' | 'day_night' | 'tou' | 'live' | 'block';
export type StandingChargePeriod = 'day' | 'month';
export type TariffDemandUnit = 'kW' | 'kVA';
/** kVA demand method: per meter phase or channel, the vector sum of active
 *  and net reactive energy over each record, averaged over the interval. */
export const APPARENT_POWER_METHOD = 'vectorial' as const;
export type ApparentPowerMethod = typeof APPARENT_POWER_METHOD;
export type TariffDemandChargePeriod = 'day' | 'month';
export type TariffTaxBasis = 'energy' | 'demand' | 'standing';
export type TariffTaxCalculation = 'exclusive' | 'inclusive';
export const TARIFF_BILLED_UNITS = [
    'kWh',
    'm3',
    'l',
    'therm',
    'MMBtu',
    'GJ'
] as const;
export type TariffBilledUnit = (typeof TARIFF_BILLED_UNITS)[number];
export const TARIFF_COMPONENT_CHARGE_TYPES = [
    'per_unit',
    'fixed_day',
    'fixed_month',
    'percentage',
    'minimum'
] as const;
export type TariffComponentChargeType =
    (typeof TARIFF_COMPONENT_CHARGE_TYPES)[number];
export const TARIFF_COMPONENT_BASES = [
    'consumption',
    'energy',
    'demand',
    'standing',
    'subtotal'
] as const;
export type TariffComponentBasis = (typeof TARIFF_COMPONENT_BASES)[number];

/** One independently disclosed, ordered bill line. The class is a registry
 * key in storage rather than a closed market-specific enum. */
export interface TariffPriceComponentSpec {
    code: string;
    name: string;
    sequence: number;
    chargeType: TariffComponentChargeType;
    chargeClass: string;
    basis: TariffComponentBasis;
    /** Currency per unit/day/month, percentage points, or minimum total. */
    rate: number;
    /** Earlier component or legacy line codes used by percentage/minimum. */
    appliesTo?: string[];
    /** Whether tax components may include this line when explicitly selected. */
    taxable?: boolean;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    sourceReference?: string | null;
}

/**
 * One jurisdiction-neutral percentage tax. Rules are evaluated in array order;
 * compoundOn may therefore name only earlier rules. The referenced tax amount,
 * never its underlying charge base, is added to this rule's base.
 */
export interface TariffTaxSpec {
    /** Stable machine identifier, independent of the display name. */
    code: string;
    /** Utility/customer-facing label such as "GST" or "State sales tax". */
    name: string;
    ratePct: number;
    calculation: TariffTaxCalculation;
    appliesTo: TariffTaxBasis[];
    /** Exempt rules remain visible but always calculate zero. Exempt rules
     * must use exclusive calculation; "included but exempt" is contradictory. */
    exempt?: boolean;
    /** Stable codes of earlier rules whose calculated tax amount is taxable.
     * Inclusive rules cannot compound because their tax is already embedded. */
    compoundOn?: string[];
}

export interface TariffDemandWindowSpec {
    daysMask: number;
    startTime: string;
    endTime: string;
}

export interface TariffDemandSeasonSpec {
    startMonthDay: string;
    endMonthDay: string;
    windows: TariffDemandWindowSpec[];
}

export interface TariffDemandSpec {
    rate: number;
    unit: TariffDemandUnit;
    /** Unit of the contracted rate. Both modes use the single highest
     * interval peak in each billing month. A day rate multiplies that peak by
     * the exact number of local calendar days in the billing period. */
    chargePeriod: TariffDemandChargePeriod;
    intervalMinutes: 15 | 30;
    /** Total billing-month lookback including the current month. 0 disables
     * ratcheting; 12 means current month plus the previous 11. */
    ratchetMonths: number;
    seasons: TariffDemandSeasonSpec[];
}

/**
 * Time-of-use band names, most expensive first. Three is the whole vocabulary:
 * a network with two bands reports no shoulder rather than a shoulder of zero,
 * and one with four cannot be named at all.
 */
export const TARIFF_BANDS = ['peak', 'shoulder', 'off_peak'] as const;
export type TariffBand = (typeof TARIFF_BANDS)[number];

/** Display names for the bands. One home, so an editor and a report agree. */
export const TARIFF_BAND_LABELS: Record<TariffBand, string> = {
    peak: 'Peak',
    shoulder: 'Shoulder',
    off_peak: 'Off-peak'
};

export interface TariffWindowSpec {
    daysMask: number; // bit0=Mon ... bit6=Sun
    startTime: string; // 'HH:MM'
    endTime: string; // 'HH:MM', exclusive
    price: number; // >= 0 for manual kinds
    /** What the network calls this window. Absent means Fleet ranks the
     * season's distinct prices instead — right for most tariffs, wrong for any
     * whose named peak is not its dearest window. */
    band?: TariffBand;
}

/** One consumption block of a stepped tariff, in the tariff's billed unit. */
export interface TariffBlockStepSpec {
    /** Upper bound of this block. null on the last block (unbounded). */
    upTo: number | null;
    /** Price per unit for the part of the period's use inside this block. */
    rate: number;
}

/**
 * Stepped (block) pricing: the period's consumption is split across ordered
 * blocks and each part is priced at the block it falls in. Marginal, never
 * flat-rate-by-bracket — crossing a block line does not reprice the units
 * below it. Blocks accumulate over the tariff's billing period and reset on
 * its local anchor (`timezone` + `billingDay`).
 */
export interface TariffBlockSpec {
    /** Must equal the parent tariff's billedUnit. */
    unit: TariffBilledUnit;
    /** Ordered low to high. Exactly one unbounded block, and it must be last. */
    steps: TariffBlockStepSpec[];
    /**
     * Per-unit charge riding on every unit whatever the block. Utilities reset
     * it per period (DEWA's monthly fuel surcharge), so it is stored data that
     * an operator edits — never a constant in code.
     */
    surcharge: number;
}

export interface TariffSeasonSpec {
    startMonthDay: string; // 'MM-DD'
    endMonthDay: string; // 'MM-DD'
    windows: TariffWindowSpec[];
}

export interface TariffSpec {
    id?: number;
    name: string;
    currency: string;
    timezone: string; // IANA
    billingDay: number; // 1-28
    kind: TariffKind;
    /** Defaults to electricity for clients created before commodity tariffs. */
    commodity?: EnergyCommodity;
    /** Defaults to kWh for clients created before commodity tariffs. */
    billedUnit?: TariffBilledUnit;
    standingCharge: number; // >= 0
    standingChargePeriod: StandingChargePeriod;
    /** Optional at the boundary: TARIFF_SPEC_SCHEMA does not require it, and
     *  the schema is what actually validates. The type said otherwise. */
    vatPct?: number | null;
    /** Ordered global tax rules. null/absent preserves the legacy vatPct rule;
     *  an explicit empty array means that the tariff has no tax. */
    taxes?: TariffTaxSpec[] | null;
    /** Legacy currency-per-kW-month field. New writes should use demand. */
    demandRate?: number | null;
    demand?: TariffDemandSpec | null;
    /** Required for kind='block', rejected on every other kind. */
    blocks?: TariffBlockSpec | null;
    /** Tariff-wide contract validity and provenance, shared by energy and
     * demand charges. Dates are inclusive local calendar dates. */
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    sourceReference?: string | null;
    /** Optional composable catalogue. Legacy clients may omit it; their
     * existing tariff facade and calculations remain unchanged. */
    components?: TariffPriceComponentSpec[] | null;
    // 'single'/'day_night'/'tou' use one season ('01-01'..'12-31').
    // 'live' and 'block' carry no windows: price comes from the feed or the
    // consumption blocks, not from the clock.
    seasons: TariffSeasonSpec[];
}

export type TariffScopeLevel =
    | 'organization'
    | 'location'
    | 'dashboard'
    | 'device'
    | 'channel';

export const TARIFF_ASSIGNMENT_DIRECTIONS = ['import', 'export'] as const;
export type TariffAssignmentDirection =
    (typeof TARIFF_ASSIGNMENT_DIRECTIONS)[number];

export interface TariffAssignmentSpec {
    tariffId: number;
    scopeLevel: TariffScopeLevel;
    dashboardId: number | null;
    locationId: number | null;
    deviceExternalId: string | null;
    channel: number | null;
    /** Defaults to import for clients created before feed-in assignments. */
    direction?: TariffAssignmentDirection;
    /** Remove this exact assignment instead of upserting it. */
    delete?: boolean;
}

export interface TariffResolutionPoint {
    deviceExternalId: string;
    channel: number | null;
    /** Defaults to electricity for clients created before commodity tariffs. */
    commodity?: EnergyCommodity;
    /** Defaults to import for clients created before feed-in assignments. */
    direction?: TariffAssignmentDirection;
}

export interface TariffResolvedAssignment extends TariffResolutionPoint {
    commodity: EnergyCommodity;
    direction: TariffAssignmentDirection;
    tariffId: number | null;
    scopeLevel: Exclude<TariffScopeLevel, 'dashboard'> | null;
    locationId: number | null;
    ambiguous: boolean;
}

export type TariffPricingUnavailableReason =
    | 'no_tariff_assignment'
    | 'ambiguous_assignment'
    | 'tariff_not_found'
    | 'outside_effective_dates'
    | 'no_matching_window'
    | 'live_price_requires_feed'
    | 'block_requires_period_usage';

export interface TariffPricingPoint extends TariffResolutionPoint {
    at: string;
}

export interface TariffCurrentPricing {
    at: string;
    deviceExternalId: string;
    channel: number | null;
    commodity: EnergyCommodity;
    direction: TariffAssignmentDirection;
    tariffId: number | null;
    scopeLevel: Exclude<TariffScopeLevel, 'dashboard'> | null;
    locationId: number | null;
    ambiguous: boolean;
    tariff: {
        kind: TariffKind;
        currency: string;
        billedUnit: TariffBilledUnit;
        timezone: string;
    } | null;
    pricing: {
        price: number;
        band: TariffBand | null;
    } | null;
    unavailableReason: TariffPricingUnavailableReason | null;
}

// ---- JSON schemas -------------------------------------------------------

const TARIFF_WINDOW_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['daysMask', 'startTime', 'endTime', 'price'],
    properties: {
        daysMask: {type: 'integer', minimum: 1, maximum: 127},
        startTime: {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'},
        endTime: {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'},
        // Manual prices are non-negative; live tariffs carry no windows.
        price: {type: 'number', minimum: 0},
        band: {type: 'string', enum: [...TARIFF_BANDS]}
    }
};

const TARIFF_SEASON_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['startMonthDay', 'endMonthDay', 'windows'],
    properties: {
        startMonthDay: {type: 'string', pattern: '^\\d{2}-\\d{2}$'},
        endMonthDay: {type: 'string', pattern: '^\\d{2}-\\d{2}$'},
        windows: {type: 'array', items: TARIFF_WINDOW_SCHEMA}
    }
};

const TARIFF_DEMAND_WINDOW_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['daysMask', 'startTime', 'endTime'],
    properties: {
        daysMask: {type: 'integer', minimum: 1, maximum: 127},
        startTime: {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'},
        endTime: {type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$'}
    }
};

const TARIFF_DEMAND_SEASON_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['startMonthDay', 'endMonthDay', 'windows'],
    properties: {
        startMonthDay: {type: 'string', pattern: '^\\d{2}-\\d{2}$'},
        endMonthDay: {type: 'string', pattern: '^\\d{2}-\\d{2}$'},
        windows: {type: 'array', items: TARIFF_DEMAND_WINDOW_SCHEMA}
    }
};

export const TARIFF_DEMAND_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: [
        'rate',
        'unit',
        'chargePeriod',
        'intervalMinutes',
        'ratchetMonths',
        'seasons'
    ],
    properties: {
        rate: {type: 'number', minimum: 0},
        unit: {type: 'string', enum: ['kW', 'kVA']},
        chargePeriod: {type: 'string', enum: ['day', 'month']},
        intervalMinutes: {type: 'integer', enum: [15, 30]},
        ratchetMonths: {type: 'integer', minimum: 0, maximum: 36},
        seasons: {type: 'array', items: TARIFF_DEMAND_SEASON_SCHEMA}
    }
};

const TARIFF_BLOCK_STEP_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['upTo', 'rate'],
    properties: {
        // Ordering, strict growth and the single unbounded block are
        // cross-field rules the schema cannot state; tariffCoverage owns them.
        upTo: {type: ['number', 'null'], minimum: 0},
        rate: {type: 'number', minimum: 0}
    }
};

export const TARIFF_BLOCKS_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['unit', 'steps', 'surcharge'],
    properties: {
        unit: {
            type: 'string',
            enum: [...TARIFF_BILLED_UNITS]
        },
        steps: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            items: TARIFF_BLOCK_STEP_SCHEMA
        },
        surcharge: {type: 'number', minimum: 0}
    }
};

const TARIFF_TAX_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'name', 'ratePct', 'calculation', 'appliesTo'],
    properties: {
        code: {
            type: 'string',
            pattern: '^[a-z][a-z0-9_-]{0,63}$',
            maxLength: 64
        },
        name: {type: 'string', minLength: 1, maxLength: 100},
        ratePct: {type: 'number', minimum: 0, maximum: 100},
        calculation: {type: 'string', enum: ['exclusive', 'inclusive']},
        appliesTo: {
            type: 'array',
            maxItems: 3,
            uniqueItems: true,
            items: {type: 'string', enum: ['energy', 'demand', 'standing']}
        },
        exempt: {type: 'boolean'},
        compoundOn: {
            type: 'array',
            maxItems: 20,
            uniqueItems: true,
            items: {
                type: 'string',
                pattern: '^[a-z][a-z0-9_-]{0,63}$',
                maxLength: 64
            }
        }
    }
};

const TARIFF_COMPONENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'code',
        'name',
        'sequence',
        'chargeType',
        'chargeClass',
        'basis',
        'rate'
    ],
    properties: {
        code: {
            type: 'string',
            pattern: '^[a-z][a-z0-9_-]{0,63}$',
            maxLength: 64
        },
        name: {type: 'string', minLength: 1, maxLength: 120},
        sequence: {type: 'integer', minimum: 1, maximum: 10000},
        chargeType: {
            type: 'string',
            enum: [...TARIFF_COMPONENT_CHARGE_TYPES]
        },
        chargeClass: {
            type: 'string',
            pattern: '^[a-z][a-z0-9_-]{0,63}$',
            maxLength: 64
        },
        basis: {type: 'string', enum: [...TARIFF_COMPONENT_BASES]},
        rate: {type: 'number'},
        appliesTo: {
            type: 'array',
            maxItems: 100,
            uniqueItems: true,
            items: {
                type: 'string',
                pattern: '^[a-z][a-z0-9_-]{0,63}$',
                maxLength: 64
            }
        },
        taxable: {type: 'boolean'},
        effectiveFrom: {
            type: ['string', 'null'],
            pattern: '^\\d{4}-\\d{2}-\\d{2}$'
        },
        effectiveTo: {
            type: ['string', 'null'],
            pattern: '^\\d{4}-\\d{2}-\\d{2}$'
        },
        sourceReference: {type: ['string', 'null'], maxLength: 500}
    }
};

export const TARIFF_WRITE_COMPONENTS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['tariffId', 'components'],
    properties: {
        tariffId: {type: 'integer', minimum: 1},
        components: {
            type: 'array',
            maxItems: 100,
            items: TARIFF_COMPONENT_SCHEMA
        }
    }
};

export const TARIFF_EMPTY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false
};

/** The five tariff kinds, declared once — TariffKind is the type of this. */
const TARIFF_KIND_SCHEMA: JsonSchema = {
    type: 'string',
    enum: ['single', 'day_night', 'tou', 'live', 'block']
};

// These seven declared `response: {type: 'object'}`, which generates as
// Record<string, unknown> — so the typed SDK had to keep its own hand-written
// tariff types to stay useful, and the contract stopped being the source of
// truth for this namespace. Shapes below are read off the handlers in
// model/tariff/tariffHandlers.ts.
const TARIFF_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'id',
                    'name',
                    'kind',
                    'currency',
                    'commodity',
                    'billedUnit',
                    'effectiveFrom',
                    'effectiveTo',
                    'sourceReference'
                ],
                properties: {
                    id: {type: 'integer'},
                    name: {type: 'string'},
                    kind: TARIFF_KIND_SCHEMA,
                    currency: {type: 'string'},
                    commodity: {
                        type: 'string',
                        enum: ['electricity', 'water', 'gas', 'heat']
                    },
                    billedUnit: {
                        type: 'string',
                        enum: [...TARIFF_BILLED_UNITS]
                    },
                    effectiveFrom: {anyOf: [{type: 'string'}, {type: 'null'}]},
                    effectiveTo: {anyOf: [{type: 'string'}, {type: 'null'}]},
                    sourceReference: {
                        anyOf: [{type: 'string'}, {type: 'null'}]
                    }
                }
            }
        }
    },
    description: 'Header rows only — Get returns the full tariff.'
};

/** Add and Update both upsert and answer with the row id. */
const TARIFF_ID_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {id: {type: 'integer'}}
};

const TARIFF_DELETED_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};

const TARIFF_OK_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};

/** Push mode mints a token; the token is shown once, like an enrollment one. */
const TARIFF_LIVE_SOURCE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
        token: {type: 'string'},
        url: {type: 'string'}
    }
};

const TARIFF_ASSIGNMENT_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'tariffId',
                    'scopeLevel',
                    'dashboardId',
                    'locationId',
                    'deviceExternalId',
                    'channel',
                    'commodity',
                    'billedUnit',
                    'direction'
                ],
                properties: {
                    tariffId: {type: 'integer'},
                    scopeLevel: {
                        type: 'string',
                        enum: [
                            'organization',
                            'location',
                            'dashboard',
                            'device',
                            'channel'
                        ]
                    },
                    dashboardId: {type: ['integer', 'null']},
                    locationId: {type: ['integer', 'null']},
                    deviceExternalId: {type: ['string', 'null']},
                    channel: {type: ['integer', 'null']},
                    commodity: {
                        type: 'string',
                        enum: ['electricity', 'water', 'gas', 'heat']
                    },
                    billedUnit: {
                        type: 'string',
                        enum: [...TARIFF_BILLED_UNITS]
                    },
                    direction: {
                        type: 'string',
                        enum: [...TARIFF_ASSIGNMENT_DIRECTIONS]
                    }
                }
            }
        }
    }
};

export const TARIFF_SPEC_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'name',
        'currency',
        'timezone',
        'billingDay',
        'kind',
        'standingCharge',
        'standingChargePeriod',
        'seasons'
    ],
    properties: {
        name: {type: 'string'},
        currency: {type: 'string'},
        timezone: {type: 'string', maxLength: 64},
        billingDay: {type: 'integer', minimum: 1, maximum: 28},
        kind: TARIFF_KIND_SCHEMA,
        commodity: {
            type: 'string',
            enum: ['electricity', 'water', 'gas', 'heat']
        },
        billedUnit: {
            type: 'string',
            enum: [...TARIFF_BILLED_UNITS]
        },
        standingCharge: {type: 'number', minimum: 0},
        standingChargePeriod: {type: 'string', enum: ['day', 'month']},
        vatPct: {type: ['number', 'null'], minimum: 0, maximum: 100},
        taxes: {
            type: ['array', 'null'],
            maxItems: 20,
            items: TARIFF_TAX_SCHEMA
        },
        demandRate: {type: ['number', 'null']},
        demand: TARIFF_DEMAND_SCHEMA,
        blocks: TARIFF_BLOCKS_SCHEMA,
        effectiveFrom: {
            type: ['string', 'null'],
            pattern: '^\\d{4}-\\d{2}-\\d{2}$'
        },
        effectiveTo: {
            type: ['string', 'null'],
            pattern: '^\\d{4}-\\d{2}-\\d{2}$'
        },
        sourceReference: {type: ['string', 'null'], maxLength: 500},
        components: {
            type: ['array', 'null'],
            maxItems: 100,
            items: TARIFF_COMPONENT_SCHEMA
        },
        seasons: {type: 'array', items: TARIFF_SEASON_SCHEMA}
    }
};

export const TARIFF_ASSIGNMENT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['tariffId', 'scopeLevel'],
    properties: {
        tariffId: {type: 'integer'},
        scopeLevel: {
            type: 'string',
            enum: ['organization', 'location', 'device', 'channel']
        },
        dashboardId: {type: ['integer', 'null']},
        locationId: {type: ['integer', 'null']},
        deviceExternalId: {type: ['string', 'null']},
        channel: {type: ['integer', 'null']},
        direction: {
            type: 'string',
            enum: [...TARIFF_ASSIGNMENT_DIRECTIONS]
        },
        delete: {type: 'boolean'}
    }
};

const TARIFF_RESOLUTION_POINT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deviceExternalId', 'channel'],
    properties: {
        deviceExternalId: {type: 'string', minLength: 1, maxLength: 255},
        channel: {type: ['integer', 'null'], minimum: 0, maximum: 32767},
        commodity: {
            type: 'string',
            enum: ['electricity', 'water', 'gas', 'heat']
        },
        direction: {
            type: 'string',
            enum: [...TARIFF_ASSIGNMENT_DIRECTIONS]
        }
    }
};

export const TARIFF_RESOLVE_ASSIGNMENTS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['points'],
    properties: {
        points: {
            type: 'array',
            minItems: 1,
            maxItems: 1000,
            items: TARIFF_RESOLUTION_POINT_SCHEMA
        }
    }
};

const TARIFF_RESOLVE_ASSIGNMENTS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'deviceExternalId',
                    'channel',
                    'tariffId',
                    'scopeLevel',
                    'locationId',
                    'ambiguous',
                    'commodity',
                    'direction'
                ],
                properties: {
                    deviceExternalId: {type: 'string'},
                    channel: {type: ['integer', 'null']},
                    tariffId: {type: ['integer', 'null']},
                    scopeLevel: {
                        type: ['string', 'null'],
                        enum: [
                            'organization',
                            'location',
                            'device',
                            'channel',
                            null
                        ]
                    },
                    locationId: {type: ['integer', 'null']},
                    ambiguous: {type: 'boolean'},
                    commodity: {
                        type: 'string',
                        enum: ['electricity', 'water', 'gas', 'heat']
                    },
                    direction: {
                        type: 'string',
                        enum: [...TARIFF_ASSIGNMENT_DIRECTIONS]
                    }
                }
            }
        }
    }
};

export const TARIFF_RESOLVE_PRICING_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deviceExternalId', 'channel', 'at'],
    properties: {
        ...TARIFF_RESOLUTION_POINT_SCHEMA.properties,
        at: {type: 'string', format: 'date-time'}
    }
};

const TARIFF_RESOLVE_PRICING_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'at',
        'deviceExternalId',
        'channel',
        'commodity',
        'direction',
        'tariffId',
        'scopeLevel',
        'locationId',
        'ambiguous',
        'tariff',
        'pricing',
        'unavailableReason'
    ],
    properties: {
        at: {type: 'string', format: 'date-time'},
        deviceExternalId: {type: 'string'},
        channel: {type: ['integer', 'null']},
        commodity: {
            type: 'string',
            enum: ['electricity', 'water', 'gas', 'heat']
        },
        direction: {
            type: 'string',
            enum: [...TARIFF_ASSIGNMENT_DIRECTIONS]
        },
        tariffId: {type: ['integer', 'null']},
        scopeLevel: {
            type: ['string', 'null'],
            enum: ['organization', 'location', 'device', 'channel', null]
        },
        locationId: {type: ['integer', 'null']},
        ambiguous: {type: 'boolean'},
        tariff: {
            anyOf: [
                {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'currency', 'billedUnit', 'timezone'],
                    properties: {
                        kind: TARIFF_KIND_SCHEMA,
                        currency: {type: 'string'},
                        billedUnit: {
                            type: 'string',
                            enum: [...TARIFF_BILLED_UNITS]
                        },
                        timezone: {type: 'string'}
                    }
                },
                {type: 'null'}
            ]
        },
        pricing: {
            anyOf: [
                {
                    type: 'object',
                    additionalProperties: false,
                    required: ['price', 'band'],
                    properties: {
                        price: {type: 'number'},
                        band: {
                            type: ['string', 'null'],
                            enum: [...TARIFF_BANDS, null]
                        }
                    }
                },
                {type: 'null'}
            ]
        },
        unavailableReason: {
            type: ['string', 'null'],
            enum: [
                'no_tariff_assignment',
                'ambiguous_assignment',
                'tariff_not_found',
                'outside_effective_dates',
                'no_matching_window',
                'live_price_requires_feed',
                'block_requires_period_usage',
                null
            ]
        }
    }
};

export const TARIFF_SET_LIVE_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['tariffId', 'mode'],
    additionalProperties: false,
    properties: {
        tariffId: {type: 'integer', minimum: 1},
        mode: {type: 'string', enum: ['push', 'pull']},
        provider: {type: 'string'},
        providerConfig: {type: 'object'}
    }
};

// ---- Describe -----------------------------------------------------------

const TARIFF_GET_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['tariff'],
    properties: {
        tariff: {
            ...TARIFF_SPEC_SCHEMA,
            // A stored tariff always has its id; the spec alone does not.
            required: [...(TARIFF_SPEC_SCHEMA.required ?? []), 'id'],
            properties: {
                ...(TARIFF_SPEC_SCHEMA.properties ?? {}),
                id: {type: 'integer'}
            }
        }
    },
    description: 'The full tariff, seasons and windows included.'
};

/** Ten years of periods is 120 rows — far more than a picker shows, and small
 * enough that the answer stays a single cheap response. */
export const TARIFF_BILLING_PERIODS_MAX_RANGE_MS =
    10 * 366 * 24 * 60 * 60 * 1000;

export const TARIFF_BILLING_PERIODS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['tariffId', 'from', 'to'],
    additionalProperties: false,
    properties: {
        tariffId: {type: 'integer', minimum: 1},
        from: {type: 'string', minLength: 1},
        to: {type: 'string', minLength: 1}
    }
};

export const TARIFF_BILLING_PERIOD_AT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['tariffId', 'at'],
    additionalProperties: false,
    properties: {
        tariffId: {type: 'integer', minimum: 1},
        at: {type: 'string', minLength: 1}
    }
};

const TARIFF_BILLING_PERIOD_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['key', 'from', 'to', 'days'],
    additionalProperties: false,
    properties: {
        key: {
            type: 'string',
            description: "Calendar month the period opens in, 'YYYY-MM'."
        },
        from: {
            type: 'string',
            description: 'Period open, ISO-8601 UTC, at the local billingDay.'
        },
        to: {
            type: 'string',
            description: 'Exclusive period end, ISO-8601 UTC.'
        },
        days: {
            type: 'integer',
            description:
                'Whole local days in the period. Counted on the calendar, so a period crossing a daylight-saving change still bills every day.'
        }
    }
};

const TARIFF_BILLING_PERIODS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['items'],
    additionalProperties: false,
    properties: {
        items: {
            type: 'array',
            items: TARIFF_BILLING_PERIOD_SCHEMA
        }
    },
    description: 'Billing periods the requested window touches.'
};

const TARIFF_BILLING_PERIOD_AT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['current', 'previous'],
    additionalProperties: false,
    properties: {
        current: TARIFF_BILLING_PERIOD_SCHEMA,
        previous: TARIFF_BILLING_PERIOD_SCHEMA
    },
    description:
        "The tariff's billing period containing the requested instant and the immediately preceding period."
};

export const TARIFF_DESCRIBE: DescribeOutput = new DescribeBuilder('tariff', {
    kind: 'fleet-manager',
    description: 'Manage reusable electricity tariffs.'
})
    .registerMethod('List', {
        params: {type: 'object', properties: {}},
        response: TARIFF_LIST_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description: 'List all tariffs in the caller org (header rows only).'
    })
    .registerMethod('Get', {
        params: {type: 'object', properties: {}},
        response: TARIFF_GET_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description: 'Fetch one tariff with nested seasons and windows.'
    })
    .registerMethod('BillingPeriods', {
        params: TARIFF_BILLING_PERIODS_SCHEMA,
        response: TARIFF_BILLING_PERIODS_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description:
            "Billing periods a window touches, anchored on the tariff's own billingDay and timezone. A billing period is not a calendar month and its anchor is not a fixed UTC offset."
    })
    .registerMethod('BillingPeriodAt', {
        params: TARIFF_BILLING_PERIOD_AT_SCHEMA,
        response: TARIFF_BILLING_PERIOD_AT_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description:
            "The billing period containing an instant and its predecessor, anchored on the tariff's own billingDay and timezone."
    })
    .registerMethod('ListAssignments', {
        params: TARIFF_EMPTY_PARAMS_SCHEMA,
        response: TARIFF_ASSIGNMENT_LIST_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description: 'List tariff assignments in the caller org.'
    })
    .registerMethod('ResolveAssignments', {
        params: TARIFF_RESOLVE_ASSIGNMENTS_SCHEMA,
        response: TARIFF_RESOLVE_ASSIGNMENTS_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description:
            'Resolve the effective canonical tariff for device/channel points.'
    })
    .registerMethod('ResolvePricing', {
        params: TARIFF_RESOLVE_PRICING_SCHEMA,
        response: TARIFF_RESOLVE_PRICING_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description:
            'Resolve one assigned tariff and its effective clock price at an explicit timestamp. Live and block tariffs return an unavailable reason because a timestamp alone cannot determine their rate.'
    })
    .registerMethod('Add', {
        params: TARIFF_SPEC_SCHEMA,
        response: TARIFF_ID_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'create'},
        description: 'Create a new tariff in the caller org.'
    })
    .registerMethod('Update', {
        params: TARIFF_SPEC_SCHEMA,
        response: TARIFF_ID_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Replace a tariff definition including its seasons and windows.'
    })
    .registerMethod('Delete', {
        params: {
            type: 'object',
            required: ['id'],
            additionalProperties: false,
            properties: {id: {type: 'integer', minimum: 1}}
        },
        response: TARIFF_DELETED_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'delete'},
        description: 'Delete a tariff by id within the caller org.'
    })
    .registerMethod('Assign', {
        params: TARIFF_ASSIGNMENT_SCHEMA,
        response: TARIFF_OK_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Attach or remove a tariff assignment for a metering point.'
    })
    .registerMethod('SetLiveSource', {
        params: TARIFF_SET_LIVE_SOURCE_SCHEMA,
        response: TARIFF_LIVE_SOURCE_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Configure a live tariff source. mode=push returns a one-time token for the price-push URL.'
    })
    .registerMethod('WriteComponents', {
        params: TARIFF_WRITE_COMPONENTS_SCHEMA,
        response: TARIFF_OK_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Replace the ordered named price-component catalogue for a tariff.'
    })
    .build();
