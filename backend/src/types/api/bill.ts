// bill.* — record and read actual utility-bill amounts per billing period, for
// report-vs-bill reconciliation (the energy report compares its computed cost
// to the recorded actual).

import {CURRENCIES} from './_currency';
import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {DELETED_RESPONSE_SCHEMA} from './_shared';
import {
    ENERGY_BUCKETS,
    ENERGY_COMMODITIES,
    ENERGY_INCOMPLETE_RANGE_SCHEMA,
    type EnergyBucket,
    type EnergyCommodity,
    type EnergyIncompleteRange
} from './energy';
import {DASHBOARD_SCOPE_SCHEMA, type DashboardScope} from './fleet';
import {
    APPARENT_POWER_METHOD,
    type ApparentPowerMethod,
    TARIFF_BANDS,
    TARIFF_BILLED_UNITS,
    type TariffBand,
    type TariffBilledUnit,
    type TariffDemandChargePeriod,
    type TariffDemandUnit
} from './tariff';

const PERM_READ = {component: 'reports', operation: 'read' as const};
const PERM_WRITE = {component: 'reports', operation: 'update' as const};

const DATE_SCHEMA: JsonSchema = {
    type: 'string',
    pattern: '^\\d{4}-\\d{2}-\\d{2}$'
};
const CURRENCY_SCHEMA: JsonSchema = {type: 'string', pattern: '^[A-Z]{3}$'};
const BILL_IDENTITY_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120,
    pattern: '^\\S(?:.{0,118}\\S)?$'
};

export interface BillIdentity {
    utilityAccountId?: string;
    meterIdentifier?: string;
    servicePointIdentifier?: string;
}

/** Report-only selector. billId is an exact organization-scoped key; any
 * identity fields supplied beside it are evidence that must match that row.
 * Bill.List deliberately continues to accept only wildcard identity filters. */
export interface BillReconciliationSelector extends BillIdentity {
    billId?: number;
}

export const BILL_RECONCILIATION_SELECTOR_SCHEMA: JsonSchema = {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
        billId: {type: 'integer', minimum: 1},
        utilityAccountId: BILL_IDENTITY_SCHEMA,
        meterIdentifier: BILL_IDENTITY_SCHEMA,
        servicePointIdentifier: BILL_IDENTITY_SCHEMA
    }
};

const BILL_ENTRY_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'id',
        'periodStart',
        'periodEnd',
        'actualCost',
        'currency',
        'utilityAccountId',
        'meterIdentifier',
        'servicePointIdentifier'
    ],
    additionalProperties: false,
    properties: {
        id: {type: 'integer'},
        periodStart: {type: 'string'},
        periodEnd: {type: 'string'},
        actualCost: {type: 'number'},
        currency: {type: 'string'},
        utilityAccountId: {type: ['string', 'null']},
        meterIdentifier: {type: ['string', 'null']},
        servicePointIdentifier: {type: ['string', 'null']}
    }
};

const BILL_BATCH_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['bills'],
    additionalProperties: false,
    properties: {
        bills: {type: 'array', maxItems: 500, items: BILL_ENTRY_RESPONSE}
    }
};

const BILL_LIST_CURSOR_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['periodStart', 'id'],
    additionalProperties: false,
    properties: {
        periodStart: DATE_SCHEMA,
        id: {type: 'integer', minimum: 1}
    }
};

export interface BillSetParams extends BillIdentity {
    periodStart: string;
    periodEnd: string;
    actualCost: number;
    currency: string;
}
export const BILL_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['periodStart', 'periodEnd', 'actualCost', 'currency'],
    additionalProperties: false,
    properties: {
        periodStart: DATE_SCHEMA,
        periodEnd: DATE_SCHEMA,
        actualCost: {type: 'number', minimum: 0},
        currency: CURRENCY_SCHEMA,
        utilityAccountId: BILL_IDENTITY_SCHEMA,
        meterIdentifier: BILL_IDENTITY_SCHEMA,
        servicePointIdentifier: BILL_IDENTITY_SCHEMA
    }
};

export interface BillListParams extends BillIdentity {
    from?: string;
    to?: string;
    limit?: number;
    cursor?: BillListCursor;
}
export interface BillListCursor {
    periodStart: string;
    id: number;
}
export interface BillListResponse {
    bills: Array<{
        id: number;
        periodStart: string;
        periodEnd: string;
        actualCost: number;
        currency: string;
        utilityAccountId: string | null;
        meterIdentifier: string | null;
        servicePointIdentifier: string | null;
    }>;
    nextCursor: BillListCursor | null;
}
export const BILL_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        from: DATE_SCHEMA,
        to: DATE_SCHEMA,
        limit: {type: 'integer', minimum: 1, maximum: 200},
        cursor: BILL_LIST_CURSOR_SCHEMA,
        utilityAccountId: BILL_IDENTITY_SCHEMA,
        meterIdentifier: BILL_IDENTITY_SCHEMA,
        servicePointIdentifier: BILL_IDENTITY_SCHEMA
    }
};

const BILL_LIST_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['bills', 'nextCursor'],
    additionalProperties: false,
    properties: {
        bills: {type: 'array', maxItems: 200, items: BILL_ENTRY_RESPONSE},
        nextCursor: {
            anyOf: [BILL_LIST_CURSOR_SCHEMA, {type: 'null'}]
        }
    }
};

export interface BillImportParams {
    bills: BillSetParams[];
}
export const BILL_IMPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['bills'],
    additionalProperties: false,
    properties: {
        bills: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            items: BILL_SET_PARAMS_SCHEMA
        }
    }
};

export interface BillDeleteParams {
    id: number;
}

export interface BillQuoteChannel {
    device: string;
    channel: number;
}

/**
 * Series granularities Bill.Quote can price. Deliberately Energy.Query's
 * `bucket` vocabulary, minus the two intervals finer than the 15-minute
 * billing row: Fleet resolves a price per 15-minute interval, so a finer bar
 * would be interpolation rather than measurement.
 */
export type BillQuoteSeriesBucket = Exclude<
    EnergyBucket,
    '1 minute' | '5 minutes'
>;

export const BILL_QUOTE_SERIES_BUCKETS: readonly BillQuoteSeriesBucket[] =
    ENERGY_BUCKETS.filter(
        (bucket): bucket is BillQuoteSeriesBucket =>
            bucket !== '1 minute' && bucket !== '5 minutes'
    );

/**
 * Hard cap on entries in one synchronous quote's series. A fine bucket over a
 * long range is rejected outright — never truncated, never downsampled into a
 * chart that silently means something else.
 */
export const BILL_QUOTE_MAX_SERIES_BUCKETS = 5000;

/** Canonical utility-bill calculation. Organization comes from the sender;
 * callers select only an authorized Fleet scope. `channels` is an optional
 * narrowing of the selected devices, never a separate authorization path. */
export interface BillQuoteParams {
    from: string;
    to: string;
    commodity: EnergyCommodity;
    billedUnit?: TariffBilledUnit;
    scope?: DashboardScope;
    devices?: string[];
    channels?: BillQuoteChannel[];
    /**
     * Bill the connection these logical meters measure. Fleet takes the
     * devices and channels from the meters, so a store metered by two mains is
     * one billing service point rather than an ambiguous multi-device scope.
     */
    meterIds?: number[];
    /**
     * Return a measured-usage series at this granularity. Omit for no series:
     * a quote without it is byte-for-byte the response it has always been.
     */
    seriesBucket?: BillQuoteSeriesBucket;
    /**
     * Also estimate the import cost avoided by consuming on-site generation.
     * Explicitly a counterfactual, never a bill line — see
     * `BillQuoteAvoidedImportCost`.
     */
    avoidedImportCost?: boolean;
}

export type BillQuoteStatus = 'priced' | 'partial' | 'unconfigured';

export interface BillQuoteWarning {
    code: string;
    message: string;
}

/** Requested window and Fleet-supported quantity interval. */
export interface BillQuoteDataCoverage {
    basis: 'recorded_quantity_interval';
    status: 'complete' | 'partial';
    requestedFrom: string;
    requestedTo: string;
    coveredFrom: string;
    coveredTo: string;
    fraction: number;
}

/** Directly attributable metered usage only. Contract-level standing,
 * demand, component, and tax amounts are intentionally never apportioned. */
export interface BillQuoteDeviceUsage {
    device: string;
    status: BillQuoteStatus;
    currency: string | null;
    billedUnit: string;
    quantity: number;
    pricedQuantity: number;
    unpricedQuantity: number;
    returnedQuantity: number;
    usageCharge: number | null;
    coveredUsageCharge: number;
    exportCredit: number | null;
    netUsageCharge: number | null;
    estimatedQuantity: number;
    tariffIds: number[];
    exportTariffIds: number[];
    assignmentSources: string[];
    exportAssignmentSources: string[];
    warnings: BillQuoteWarning[];
    missingConfigurationReasons: string[];
}

/**
 * One bar of the measured-usage series. Directly attributable metered usage
 * only: standing, demand, component and tax amounts belong to the contract and
 * are never apportioned across buckets, so a bucket is not a small bill.
 * Nulls mean "not priced" and are never softened to zero.
 */
export interface BillQuoteUsageBucket {
    /** Bucket start, ISO-8601 UTC. */
    bucketStart: string;
    /** Exclusive bucket end, ISO-8601 UTC. */
    bucketEnd: string;
    status: BillQuoteStatus;
    currency: string | null;
    billedUnit: string;
    quantity: number;
    pricedQuantity: number;
    unpricedQuantity: number;
    returnedQuantity: number;
    usageCharge: number | null;
    coveredUsageCharge: number;
    exportCredit: number | null;
    netUsageCharge: number | null;
    estimatedQuantity: number;
    tariffIds: number[];
    exportTariffIds: number[];
    assignmentSources: string[];
    exportAssignmentSources: string[];
    warnings: BillQuoteWarning[];
    missingConfigurationReasons: string[];
}

/**
 * NOT a bill line. An estimate of the import cost avoided by consuming on-site
 * generation instead of importing it, priced at the same effective import
 * tariff Fleet resolves for each 15-minute interval (so time-of-use, day/night
 * and live prices are respected). Fleet never bills this amount and never
 * folds it into `usageCharge`, `exportCredit` or `netCost`.
 *
 * Self-consumption is measured, not modelled: generation metered by
 * logical meters with a generation role, minus energy exported at the billed
 * metering points, floored at zero per interval. When any of that is missing
 * the amounts are null — never zero.
 */
export interface BillQuoteAvoidedImportCost {
    /** Always `counterfactual_estimate`: this did not happen and was not billed. */
    basis: 'counterfactual_estimate';
    /** Always `measured_generation_minus_export`. */
    method: 'measured_generation_minus_export';
    status: 'estimated' | 'unavailable';
    currency: string | null;
    billedUnit: string;
    generationQuantity: number | null;
    exportedQuantity: number | null;
    selfConsumedQuantity: number | null;
    /** Import cost avoided, at the resolved import tariff. Null when unknown. */
    avoidedCost: number | null;
    tariffIds: number[];
    warnings: BillQuoteWarning[];
    missingConfigurationReasons: string[];
}

/**
 * One billing period of the demand determinant. Bounds are the tariff's own
 * local billing anchor, not calendar months, so they can be compared against
 * a paper bill.
 */
export interface BillQuoteDemandPeriod {
    /** Calendar month the period opens in, 'YYYY-MM'. */
    periodKey: string;
    /** Period open, ISO-8601 UTC. */
    periodStart: string;
    /** Exclusive period end, ISO-8601 UTC. */
    periodEnd: string;
    billingDays: number;
    /** Highest complete interval average measured, in `unit`. */
    measuredPeak: number;
    /** Peak actually billed, in `unit`: the ratchet floor when one applies. */
    billedPeak: number;
    /** Instant the winning interval began. Null when nothing qualified. */
    peakAt: string | null;
    ratchetApplied: boolean;
    charge: number;
}

/**
 * The demand determinant behind `demandCharge`. Null unless the resolved
 * tariff carries a structured demand contract — a legacy per-kW-month rate has
 * no interval, no season and no ratchet to report.
 */
export interface BillQuoteDemand {
    /** Metered unit. kVA is never converted to kW. */
    unit: TariffDemandUnit;
    /** How a kVA peak was measured ('vectorial': per meter phase or channel,
     * the vector sum of active and net reactive energy). Null for kW. */
    apparentPowerMethod: ApparentPowerMethod | null;
    /** Interval the peak is averaged over: 30 minutes on most networks, 15 in
     * Victoria. */
    intervalMinutes: 15 | 30;
    chargePeriod: TariffDemandChargePeriod;
    /** False when a ratchet period is unproven; `demandCharge` is then null. */
    complete: boolean;
    reason: string | null;
    periods: BillQuoteDemandPeriod[];
}

/** Measured usage priced inside one named time-of-use band. */
export interface BillQuoteBand {
    band: TariffBand;
    /** In `billedUnit`. */
    quantity: number;
    usageCharge: number;
    /** Money over quantity. Null when the band measured nothing. */
    averagePrice: number | null;
}

export interface BillQuoteResponse {
    status: BillQuoteStatus;
    complete: boolean;
    from: string;
    to: string;
    currency: string | null;
    billedUnit: string;
    quantity: number;
    pricedQuantity: number;
    unpricedQuantity: number;
    returnedQuantity: number;
    usageCharge: number | null;
    coveredUsageCharge: number;
    /** Net cost of priced measured usage in the covered interval. */
    coveredNetCost: number | null;
    coveredNetCostBasis: 'priced_measured_usage_only';
    dataCoverage: BillQuoteDataCoverage;
    /**
     * Open incomplete meter-history ranges inside the billed period. Any entry
     * makes the quote partial: the gap is never priced as zero.
     */
    incompleteRanges: EnergyIncompleteRange[];
    standingCharge: number | null;
    demandCharge: number | null;
    /** How `demandCharge` was determined. Null when the tariff has no
     * structured demand contract. */
    demand: BillQuoteDemand | null;
    /**
     * Energy and money per named time-of-use band, most expensive first. Null
     * when the tariff has no clock structure to name — a flat, live or block
     * tariff, or a season with more distinct prices than there are band names.
     * A band nothing was measured in is absent, never present as a zero.
     */
    bands: BillQuoteBand[] | null;
    /** Where the band names came from. Null when `bands` is null. */
    bandBasis: 'declared' | 'price_rank' | null;
    components: Array<{
        code: string;
        name: string;
        chargeClass: string;
        amount: number;
        taxable: boolean;
    }>;
    taxes: Array<{
        code: string;
        name: string;
        ratePct: number;
        calculation: 'exclusive' | 'inclusive';
        exempt: boolean;
        base: number;
        amount: number;
    }>;
    exportCredit: number | null;
    netCost: number | null;
    tariffIds: number[];
    exportTariffIds: number[];
    appliedTariffs: BillQuoteAppliedTariff[];
    appliedExportTariffs: BillQuoteAppliedTariff[];
    tariffSnapshotHash: string | null;
    assignmentSources: string[];
    exportAssignmentSources: string[];
    /** Always `measured_usage_only`: contract charges remain aggregate. */
    deviceBreakdownBasis: 'measured_usage_only';
    deviceBreakdown: BillQuoteDeviceUsage[];
    /** Echo of the requested granularity. Present only with `series`. */
    seriesBucket?: BillQuoteSeriesBucket;
    /** Always `measured_usage_only`: contract charges stay aggregate. */
    seriesBasis?: 'measured_usage_only';
    /** Present only when `seriesBucket` was requested. */
    series?: BillQuoteUsageBucket[];
    /** Present only when `avoidedImportCost` was requested. */
    avoidedImportCost?: BillQuoteAvoidedImportCost;
    gasConversions?: Array<Record<string, unknown>>;
    warnings: BillQuoteWarning[];
    missingConfigurationReasons: string[];
}

export interface BillQuoteAppliedTariff {
    id: number;
    name: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    sourceReference: string | null;
    snapshotHash: string;
}

const BILL_QUOTE_CHANNEL_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['device', 'channel'],
    additionalProperties: false,
    properties: {
        device: {type: 'string', minLength: 1},
        channel: {type: 'integer', minimum: 0, maximum: 65535}
    }
};

export const BILL_QUOTE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['from', 'to', 'commodity'],
    additionalProperties: false,
    properties: {
        from: {type: 'string', minLength: 1},
        to: {type: 'string', minLength: 1},
        commodity: {type: 'string', enum: [...ENERGY_COMMODITIES]},
        billedUnit: {type: 'string', enum: [...TARIFF_BILLED_UNITS]},
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {
            type: 'array',
            maxItems: 500,
            items: {type: 'string', minLength: 1}
        },
        channels: {
            type: 'array',
            maxItems: 2000,
            items: BILL_QUOTE_CHANNEL_SCHEMA
        },
        meterIds: {
            type: 'array',
            minItems: 1,
            maxItems: 50,
            items: {type: 'integer', minimum: 1},
            description:
                'Bill the connection these logical meters measure. Mutually exclusive with scope, devices and channels. One meter is one billing service point, so its contract charges apply; several are treated as an ambiguous scope.'
        },
        seriesBucket: {
            type: 'string',
            enum: [...BILL_QUOTE_SERIES_BUCKETS],
            description:
                'Return a measured-usage series at this granularity (Energy.Query bucket vocabulary, 15 minutes and coarser). Omitted returns no series.'
        },
        avoidedImportCost: {
            type: 'boolean',
            description:
                'Also estimate the import cost avoided by self-consumed on-site generation. A labelled counterfactual, never a bill line.'
        }
    }
};

const NULLABLE_MONEY_SCHEMA: JsonSchema = {type: ['number', 'null']};
const BILL_QUOTE_DEMAND_SCHEMA: JsonSchema = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: [
        'unit',
        'apparentPowerMethod',
        'intervalMinutes',
        'chargePeriod',
        'complete',
        'reason',
        'periods'
    ],
    properties: {
        unit: {type: 'string', enum: ['kW', 'kVA']},
        apparentPowerMethod: {
            type: ['string', 'null'],
            enum: [APPARENT_POWER_METHOD, null],
            description:
                'How a kVA peak was measured. vectorial: per meter phase or channel, the vector sum of active and net reactive energy over each record. Null for kW.'
        },
        intervalMinutes: {type: 'integer', enum: [15, 30]},
        chargePeriod: {type: 'string', enum: ['day', 'month']},
        complete: {type: 'boolean'},
        reason: {type: ['string', 'null']},
        periods: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'periodKey',
                    'periodStart',
                    'periodEnd',
                    'billingDays',
                    'measuredPeak',
                    'billedPeak',
                    'peakAt',
                    'ratchetApplied',
                    'charge'
                ],
                properties: {
                    periodKey: {type: 'string'},
                    periodStart: {type: 'string'},
                    periodEnd: {type: 'string'},
                    billingDays: {type: 'integer'},
                    measuredPeak: {type: 'number'},
                    billedPeak: {type: 'number'},
                    peakAt: {type: ['string', 'null']},
                    ratchetApplied: {type: 'boolean'},
                    charge: {type: 'number'}
                }
            }
        }
    }
};

const BILL_QUOTE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'status',
        'complete',
        'from',
        'to',
        'currency',
        'billedUnit',
        'quantity',
        'pricedQuantity',
        'unpricedQuantity',
        'returnedQuantity',
        'usageCharge',
        'coveredUsageCharge',
        'coveredNetCost',
        'coveredNetCostBasis',
        'dataCoverage',
        'incompleteRanges',
        'standingCharge',
        'demandCharge',
        'demand',
        'bands',
        'bandBasis',
        'components',
        'taxes',
        'exportCredit',
        'netCost',
        'tariffIds',
        'exportTariffIds',
        'appliedTariffs',
        'appliedExportTariffs',
        'tariffSnapshotHash',
        'assignmentSources',
        'exportAssignmentSources',
        'deviceBreakdownBasis',
        'deviceBreakdown',
        'warnings',
        'missingConfigurationReasons'
    ],
    properties: {
        status: {type: 'string', enum: ['priced', 'partial', 'unconfigured']},
        complete: {type: 'boolean'},
        from: {type: 'string'},
        to: {type: 'string'},
        currency: {type: ['string', 'null'], enum: [...CURRENCIES, null]},
        billedUnit: {type: 'string'},
        quantity: {type: 'number'},
        pricedQuantity: {type: 'number'},
        unpricedQuantity: {type: 'number'},
        returnedQuantity: {type: 'number'},
        usageCharge: NULLABLE_MONEY_SCHEMA,
        coveredUsageCharge: {type: 'number'},
        coveredNetCost: NULLABLE_MONEY_SCHEMA,
        coveredNetCostBasis: {
            type: 'string',
            enum: ['priced_measured_usage_only']
        },
        dataCoverage: {
            type: 'object',
            additionalProperties: false,
            required: [
                'basis',
                'status',
                'requestedFrom',
                'requestedTo',
                'coveredFrom',
                'coveredTo',
                'fraction'
            ],
            properties: {
                basis: {
                    type: 'string',
                    enum: ['recorded_quantity_interval']
                },
                status: {type: 'string', enum: ['complete', 'partial']},
                requestedFrom: {type: 'string'},
                requestedTo: {type: 'string'},
                coveredFrom: {type: 'string'},
                coveredTo: {type: 'string'},
                fraction: {type: 'number', minimum: 0, maximum: 1}
            }
        },
        incompleteRanges: {
            type: 'array',
            items: ENERGY_INCOMPLETE_RANGE_SCHEMA
        },
        standingCharge: NULLABLE_MONEY_SCHEMA,
        demandCharge: NULLABLE_MONEY_SCHEMA,
        demand: BILL_QUOTE_DEMAND_SCHEMA,
        bands: {
            type: ['array', 'null'],
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['band', 'quantity', 'usageCharge', 'averagePrice'],
                properties: {
                    band: {type: 'string', enum: [...TARIFF_BANDS]},
                    quantity: {type: 'number'},
                    usageCharge: {type: 'number'},
                    averagePrice: {type: ['number', 'null']}
                }
            }
        },
        bandBasis: {
            type: ['string', 'null'],
            enum: ['declared', 'price_rank', null]
        },
        components: {
            type: 'array',
            items: {
                type: 'object',
                required: ['code', 'name', 'chargeClass', 'amount', 'taxable'],
                additionalProperties: false,
                properties: {
                    code: {type: 'string'},
                    name: {type: 'string'},
                    chargeClass: {type: 'string'},
                    amount: {type: 'number'},
                    taxable: {type: 'boolean'}
                }
            }
        },
        taxes: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'code',
                    'name',
                    'ratePct',
                    'calculation',
                    'exempt',
                    'base',
                    'amount'
                ],
                additionalProperties: false,
                properties: {
                    code: {type: 'string'},
                    name: {type: 'string'},
                    ratePct: {type: 'number'},
                    calculation: {
                        type: 'string',
                        enum: ['exclusive', 'inclusive']
                    },
                    exempt: {type: 'boolean'},
                    base: {type: 'number'},
                    amount: {type: 'number'}
                }
            }
        },
        exportCredit: NULLABLE_MONEY_SCHEMA,
        netCost: NULLABLE_MONEY_SCHEMA,
        tariffIds: {type: 'array', items: {type: 'integer'}},
        exportTariffIds: {type: 'array', items: {type: 'integer'}},
        appliedTariffs: {
            type: 'array',
            items: appliedTariffSchema()
        },
        appliedExportTariffs: {
            type: 'array',
            items: appliedTariffSchema()
        },
        tariffSnapshotHash: {type: ['string', 'null']},
        assignmentSources: {type: 'array', items: {type: 'string'}},
        exportAssignmentSources: {type: 'array', items: {type: 'string'}},
        deviceBreakdownBasis: {
            type: 'string',
            enum: ['measured_usage_only']
        },
        deviceBreakdown: {
            type: 'array',
            maxItems: 500,
            items: billQuoteDeviceUsageSchema()
        },
        seriesBucket: {
            type: 'string',
            enum: [...BILL_QUOTE_SERIES_BUCKETS]
        },
        seriesBasis: {
            type: 'string',
            enum: ['measured_usage_only']
        },
        series: {
            type: 'array',
            maxItems: BILL_QUOTE_MAX_SERIES_BUCKETS,
            items: billQuoteUsageBucketSchema()
        },
        avoidedImportCost: billQuoteAvoidedImportCostSchema(),
        gasConversions: {type: 'array', items: {type: 'object'}},
        warnings: {
            type: 'array',
            items: {
                type: 'object',
                required: ['code', 'message'],
                additionalProperties: false,
                properties: {
                    code: {type: 'string'},
                    message: {type: 'string'}
                }
            }
        },
        missingConfigurationReasons: {
            type: 'array',
            items: {type: 'string'}
        }
    }
};

function billQuoteDeviceUsageSchema(): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        required: [
            'device',
            'status',
            'currency',
            'billedUnit',
            'quantity',
            'pricedQuantity',
            'unpricedQuantity',
            'returnedQuantity',
            'usageCharge',
            'coveredUsageCharge',
            'exportCredit',
            'netUsageCharge',
            'estimatedQuantity',
            'tariffIds',
            'exportTariffIds',
            'assignmentSources',
            'exportAssignmentSources',
            'warnings',
            'missingConfigurationReasons'
        ],
        properties: {
            device: {type: 'string'},
            status: {
                type: 'string',
                enum: ['priced', 'partial', 'unconfigured']
            },
            currency: {type: ['string', 'null'], enum: [...CURRENCIES, null]},
            billedUnit: {type: 'string'},
            quantity: {type: 'number'},
            pricedQuantity: {type: 'number'},
            unpricedQuantity: {type: 'number'},
            returnedQuantity: {type: 'number'},
            usageCharge: NULLABLE_MONEY_SCHEMA,
            coveredUsageCharge: {type: 'number'},
            exportCredit: NULLABLE_MONEY_SCHEMA,
            netUsageCharge: NULLABLE_MONEY_SCHEMA,
            estimatedQuantity: {type: 'number'},
            tariffIds: {type: 'array', items: {type: 'integer'}},
            exportTariffIds: {type: 'array', items: {type: 'integer'}},
            assignmentSources: {type: 'array', items: {type: 'string'}},
            exportAssignmentSources: {
                type: 'array',
                items: {type: 'string'}
            },
            warnings: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['code', 'message'],
                    additionalProperties: false,
                    properties: {
                        code: {type: 'string'},
                        message: {type: 'string'}
                    }
                }
            },
            missingConfigurationReasons: {
                type: 'array',
                items: {type: 'string'}
            }
        }
    };
}

function billQuoteWarningsSchema(): JsonSchema {
    return {
        type: 'array',
        items: {
            type: 'object',
            required: ['code', 'message'],
            additionalProperties: false,
            properties: {
                code: {type: 'string'},
                message: {type: 'string'}
            }
        }
    };
}

function billQuoteUsageBucketSchema(): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        required: [
            'bucketStart',
            'bucketEnd',
            'status',
            'currency',
            'billedUnit',
            'quantity',
            'pricedQuantity',
            'unpricedQuantity',
            'returnedQuantity',
            'usageCharge',
            'coveredUsageCharge',
            'exportCredit',
            'netUsageCharge',
            'estimatedQuantity',
            'tariffIds',
            'exportTariffIds',
            'assignmentSources',
            'exportAssignmentSources',
            'warnings',
            'missingConfigurationReasons'
        ],
        properties: {
            bucketStart: {type: 'string'},
            bucketEnd: {type: 'string'},
            status: {
                type: 'string',
                enum: ['priced', 'partial', 'unconfigured']
            },
            currency: {type: ['string', 'null'], enum: [...CURRENCIES, null]},
            billedUnit: {type: 'string'},
            quantity: {type: 'number'},
            pricedQuantity: {type: 'number'},
            unpricedQuantity: {type: 'number'},
            returnedQuantity: {type: 'number'},
            usageCharge: NULLABLE_MONEY_SCHEMA,
            coveredUsageCharge: {type: 'number'},
            exportCredit: NULLABLE_MONEY_SCHEMA,
            netUsageCharge: NULLABLE_MONEY_SCHEMA,
            estimatedQuantity: {type: 'number'},
            tariffIds: {type: 'array', items: {type: 'integer'}},
            exportTariffIds: {type: 'array', items: {type: 'integer'}},
            assignmentSources: {type: 'array', items: {type: 'string'}},
            exportAssignmentSources: {type: 'array', items: {type: 'string'}},
            warnings: billQuoteWarningsSchema(),
            missingConfigurationReasons: {
                type: 'array',
                items: {type: 'string'}
            }
        }
    };
}

function billQuoteAvoidedImportCostSchema(): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        required: [
            'basis',
            'method',
            'status',
            'currency',
            'billedUnit',
            'generationQuantity',
            'exportedQuantity',
            'selfConsumedQuantity',
            'avoidedCost',
            'tariffIds',
            'warnings',
            'missingConfigurationReasons'
        ],
        properties: {
            basis: {type: 'string', enum: ['counterfactual_estimate']},
            method: {
                type: 'string',
                enum: ['measured_generation_minus_export']
            },
            status: {type: 'string', enum: ['estimated', 'unavailable']},
            currency: {type: ['string', 'null'], enum: [...CURRENCIES, null]},
            billedUnit: {type: 'string'},
            generationQuantity: {type: ['number', 'null']},
            exportedQuantity: {type: ['number', 'null']},
            selfConsumedQuantity: {type: ['number', 'null']},
            avoidedCost: NULLABLE_MONEY_SCHEMA,
            tariffIds: {type: 'array', items: {type: 'integer'}},
            warnings: billQuoteWarningsSchema(),
            missingConfigurationReasons: {
                type: 'array',
                items: {type: 'string'}
            }
        }
    };
}

function appliedTariffSchema(): JsonSchema {
    return {
        type: 'object',
        required: [
            'id',
            'name',
            'effectiveFrom',
            'effectiveTo',
            'sourceReference',
            'snapshotHash'
        ],
        additionalProperties: false,
        properties: {
            id: {type: 'integer'},
            name: {type: 'string'},
            effectiveFrom: {type: ['string', 'null']},
            effectiveTo: {type: ['string', 'null']},
            sourceReference: {type: ['string', 'null']},
            snapshotHash: {type: 'string'}
        }
    };
}
export const BILL_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: {type: 'number'}}
};

const b = new DescribeBuilder('bill', {
    kind: 'fleet-manager',
    description:
        'Record and read actual utility-bill amounts for report reconciliation.'
});

b.registerMethod('Set', {
    params: BILL_SET_PARAMS_SCHEMA,
    response: BILL_ENTRY_RESPONSE,
    permission: PERM_WRITE,
    description: 'Record (upsert) the actual bill for a billing period.'
});
b.registerMethod('List', {
    params: BILL_LIST_PARAMS_SCHEMA,
    response: BILL_LIST_RESPONSE,
    permission: PERM_READ,
    description: 'List recorded bills, optionally within a date range.'
});
b.registerMethod('Import', {
    params: BILL_IMPORT_PARAMS_SCHEMA,
    response: BILL_BATCH_RESPONSE,
    permission: PERM_WRITE,
    description:
        'Atomically import up to 500 recorded bills; duplicate identities in one batch are rejected and repeated stored identities update in place.'
});
b.registerMethod('Delete', {
    params: BILL_DELETE_PARAMS_SCHEMA,
    response: DELETED_RESPONSE_SCHEMA,
    permission: PERM_WRITE,
    description: 'Delete a recorded bill.'
});
b.registerMethod('Quote', {
    params: BILL_QUOTE_PARAMS_SCHEMA,
    response: BILL_QUOTE_RESPONSE_SCHEMA,
    permission: PERM_READ,
    description:
        'Calculate an assignment-aware utility bill without caller-supplied rates. Full totals fail closed when fixed, demand, tax, conversion, currency, or coverage inputs are incomplete. A leading pre-enrollment gap returns partial dataCoverage plus coveredNetCost for priced measured usage only; a range with no recorded overlap still fails. Per-device rows and the optional seriesBucket series contain measured usage and export charges only; contract charges are never apportioned. avoidedImportCost returns a labelled self-consumption counterfactual that is never part of any billed total.'
});

export const BILL_DESCRIBE: DescribeOutput = b.build();
