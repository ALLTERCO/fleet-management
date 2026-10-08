import {DescribeBuilder, type DescribeOutput} from './_describe.js';
import type {JsonSchema, JsonSchemaType} from './_schema.js';
import type {EnergyCommodity} from './energy.js';
import {DASHBOARD_SCOPE_SCHEMA, type DashboardScope} from './fleet.js';

export const CARBON_ACCOUNTING_BASES = [
    'location_based',
    'market_based',
    'direct'
] as const;
export type CarbonAccountingBasis = (typeof CARBON_ACCOUNTING_BASES)[number];

export const CARBON_EMISSIONS_SCOPES = ['scope1', 'scope2', 'scope3'] as const;
export type CarbonEmissionsScope = (typeof CARBON_EMISSIONS_SCOPES)[number];

export const CARBON_PRICE_TYPES = [
    'shadow',
    'fee',
    'implicit',
    'regulated'
] as const;
export type CarbonPriceType = (typeof CARBON_PRICE_TYPES)[number];

export const CARBON_PRICE_SCOPES = [...CARBON_EMISSIONS_SCOPES, 'all'] as const;
export type CarbonPriceScope = (typeof CARBON_PRICE_SCOPES)[number];

export interface EmissionFactorSpec {
    id?: number;
    commodity: EnergyCommodity;
    billedUnit: string;
    region: string;
    accountingBasis: CarbonAccountingBasis;
    emissionsScope: CarbonEmissionsScope;
    factorKgPerUnit: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
    sourceReference: string;
    revision?: number;
}

export interface CarbonPriceSpec {
    id?: number;
    name: string;
    priceType: CarbonPriceType;
    appliesToScope: CarbonPriceScope;
    currency: string;
    amountPerTonne: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
    sourceReference: string;
    revision?: number;
}

export interface CarbonListParams {
    limit?: number;
    beforeId?: number;
}

export interface CarbonCalculateParams {
    quantity: number;
    commodity: EnergyCommodity;
    billedUnit: string;
    region: string;
    accountingBasis: CarbonAccountingBasis;
    emissionsScope?: CarbonEmissionsScope;
    from: string;
    to: string;
    dashboardId?: number;
    includeCarbonPrice?: boolean;
    carbonPriceType?: CarbonPriceType;
}

export interface CarbonCalculateResponse {
    quantity: number;
    projectImpactKgCO2e: number;
    scope2KgCO2e: number | null;
    factor: {
        id: number | null;
        factorKgPerUnit: number;
        source: 'dashboard_override' | 'factor_store' | 'deployment_default';
        sourceReference: string;
        revision: number | null;
        accountingBasis: CarbonAccountingBasis;
        emissionsScope: CarbonEmissionsScope;
    };
    carbonPriceStatus:
        | 'not_requested'
        | 'resolved'
        | 'unavailable_or_ambiguous';
    carbonValue: {
        amount: number;
        currency: string;
        priceId: number;
        priceType: CarbonPriceType;
        amountPerTonne: number;
    } | null;
}

export const CARBON_BREAKDOWN_GRANULARITIES = [
    '15 minutes',
    '1 hour',
    '1 day',
    '1 month'
] as const;
export type CarbonBreakdownGranularity =
    (typeof CARBON_BREAKDOWN_GRANULARITIES)[number];
export type CarbonBreakdownStatus = 'complete' | 'partial' | 'unconfigured';

export interface CarbonCalculateBreakdownParams {
    from: string;
    to: string;
    granularity: CarbonBreakdownGranularity;
    /** Group, location, tag, or fleet scope. Mutually exclusive with locationIds. */
    scope?: DashboardScope;
    /** Explicit location scopes. Mutually exclusive with scope. */
    locationIds?: number[];
    /** IANA timezone passed to Fleet energy bucketing. Defaults to UTC. */
    timezone?: string;
    /** Optional dashboard whose Fleet-owned carbon override applies. */
    dashboardId?: number;
}

export interface CarbonBreakdownValue {
    status: CarbonBreakdownStatus;
    quantityKWh: number;
    coveredQuantityKWh: number;
    uncoveredQuantityKWh: number;
    /** Null unless the whole quantity has authoritative factor coverage. */
    projectImpactKgCO2e: number | null;
    /** Impact for the covered quantity, also present for partial coverage. */
    coveredImpactKgCO2e: number;
    scope2KgCO2e: number | null;
    factorKeys: string[];
}

export interface CarbonBreakdownPoint extends CarbonBreakdownValue {
    bucketStart: string;
    bucketEnd: string;
}

export interface CarbonBreakdownFactorRef {
    key: string;
    id: number | null;
    region: string;
    factorKgPerUnit: number;
    source: 'dashboard_override' | 'factor_store' | 'deployment_default';
    sourceReference: string;
    revision: number | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    accountingBasis: 'location_based';
    emissionsScope: 'scope2';
}

export interface CarbonLocationBreakdown extends CarbonBreakdownValue {
    locationId: number | null;
    locationName: string;
    region: string;
    series: CarbonBreakdownPoint[];
}

export interface CarbonBreakdownDataCoverage {
    basis: 'recorded_quantity_interval';
    status: 'complete' | 'partial';
    requestedFrom: string;
    requestedTo: string;
    coveredFrom: string;
    coveredTo: string;
    fraction: number;
}

export interface CarbonCalculateBreakdownWarning {
    code: 'partial_data_coverage';
    message: string;
}

export interface CarbonCalculateBreakdownResponse extends CarbonBreakdownValue {
    from: string;
    to: string;
    granularity: CarbonBreakdownGranularity;
    locationsAdditive: true;
    /** Factor coverage for the recorded quantity, independent of history coverage. */
    factorCoverageStatus: CarbonBreakdownStatus;
    dataCoverage: CarbonBreakdownDataCoverage;
    warnings: CarbonCalculateBreakdownWarning[];
    factors: CarbonBreakdownFactorRef[];
    series: CarbonBreakdownPoint[];
    locations: CarbonLocationBreakdown[];
}

const ISO_DATE_TIME: JsonSchema = {type: 'string', format: 'date-time'};
const NULLABLE_ISO_DATE_TIME: JsonSchema = {
    type: ['string', 'null'] as JsonSchemaType[],
    format: 'date-time'
};

export const EMISSION_FACTOR_SPEC_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'commodity',
        'billedUnit',
        'region',
        'accountingBasis',
        'emissionsScope',
        'factorKgPerUnit',
        'effectiveFrom',
        'sourceReference'
    ],
    additionalProperties: false,
    properties: {
        id: {type: 'integer', minimum: 1},
        commodity: {
            type: 'string',
            enum: ['electricity', 'water', 'gas', 'heat']
        },
        billedUnit: {type: 'string', minLength: 1, maxLength: 24},
        region: {type: 'string', minLength: 1, maxLength: 120},
        accountingBasis: {
            type: 'string',
            enum: [...CARBON_ACCOUNTING_BASES]
        },
        emissionsScope: {
            type: 'string',
            enum: [...CARBON_EMISSIONS_SCOPES]
        },
        factorKgPerUnit: {type: 'number', minimum: 0},
        effectiveFrom: ISO_DATE_TIME,
        effectiveTo: NULLABLE_ISO_DATE_TIME,
        sourceReference: {type: 'string', minLength: 1, maxLength: 1000},
        revision: {type: 'integer', minimum: 1}
    }
};

export const CARBON_PRICE_SPEC_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'name',
        'priceType',
        'appliesToScope',
        'currency',
        'amountPerTonne',
        'effectiveFrom',
        'sourceReference'
    ],
    additionalProperties: false,
    properties: {
        id: {type: 'integer', minimum: 1},
        name: {type: 'string', minLength: 1, maxLength: 128},
        priceType: {type: 'string', enum: [...CARBON_PRICE_TYPES]},
        appliesToScope: {type: 'string', enum: [...CARBON_PRICE_SCOPES]},
        currency: {type: 'string', pattern: '^[A-Z]{3}$'},
        amountPerTonne: {type: 'number', minimum: 0},
        effectiveFrom: ISO_DATE_TIME,
        effectiveTo: NULLABLE_ISO_DATE_TIME,
        sourceReference: {type: 'string', minLength: 1, maxLength: 1000},
        revision: {type: 'integer', minimum: 1}
    }
};

export const CARBON_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        limit: {type: 'integer', minimum: 1, maximum: 100},
        beforeId: {type: 'integer', minimum: 1}
    }
};

export const CARBON_CALCULATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'quantity',
        'commodity',
        'billedUnit',
        'region',
        'accountingBasis',
        'from',
        'to'
    ],
    additionalProperties: false,
    properties: {
        quantity: {type: 'number', minimum: 0},
        commodity: {
            type: 'string',
            enum: ['electricity', 'water', 'gas', 'heat']
        },
        billedUnit: {type: 'string', minLength: 1, maxLength: 24},
        region: {type: 'string', minLength: 1, maxLength: 120},
        accountingBasis: {
            type: 'string',
            enum: [...CARBON_ACCOUNTING_BASES]
        },
        emissionsScope: {
            type: 'string',
            enum: [...CARBON_EMISSIONS_SCOPES]
        },
        from: ISO_DATE_TIME,
        to: ISO_DATE_TIME,
        dashboardId: {type: 'integer', minimum: 1},
        includeCarbonPrice: {type: 'boolean'},
        carbonPriceType: {type: 'string', enum: [...CARBON_PRICE_TYPES]}
    }
};

export const CARBON_CALCULATE_BREAKDOWN_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['from', 'to', 'granularity'],
    additionalProperties: false,
    properties: {
        from: ISO_DATE_TIME,
        to: ISO_DATE_TIME,
        granularity: {
            type: 'string',
            enum: [...CARBON_BREAKDOWN_GRANULARITIES]
        },
        scope: DASHBOARD_SCOPE_SCHEMA,
        locationIds: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            uniqueItems: true,
            items: {type: 'integer', minimum: 1}
        },
        timezone: {type: 'string', minLength: 1, maxLength: 64},
        dashboardId: {type: 'integer', minimum: 1}
    }
};

const FACTOR_RESPONSE_SCHEMA: JsonSchema = {
    ...EMISSION_FACTOR_SPEC_SCHEMA,
    required: [
        ...(EMISSION_FACTOR_SPEC_SCHEMA.required ?? []),
        'id',
        'revision'
    ]
};
const PRICE_RESPONSE_SCHEMA: JsonSchema = {
    ...CARBON_PRICE_SPEC_SCHEMA,
    required: [...(CARBON_PRICE_SPEC_SCHEMA.required ?? []), 'id', 'revision']
};

const BREAKDOWN_FACTOR_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'key',
        'id',
        'region',
        'factorKgPerUnit',
        'source',
        'sourceReference',
        'revision',
        'effectiveFrom',
        'effectiveTo',
        'accountingBasis',
        'emissionsScope'
    ],
    properties: {
        key: {type: 'string'},
        id: {type: ['integer', 'null'] as JsonSchemaType[]},
        region: {type: 'string'},
        factorKgPerUnit: {type: 'number'},
        source: {
            type: 'string',
            enum: ['dashboard_override', 'factor_store', 'deployment_default']
        },
        sourceReference: {type: 'string'},
        revision: {type: ['integer', 'null'] as JsonSchemaType[]},
        effectiveFrom: {
            type: ['string', 'null'] as JsonSchemaType[],
            format: 'date-time'
        },
        effectiveTo: {
            type: ['string', 'null'] as JsonSchemaType[],
            format: 'date-time'
        },
        accountingBasis: {type: 'string', enum: ['location_based']},
        emissionsScope: {type: 'string', enum: ['scope2']}
    }
};

const BREAKDOWN_POINT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'bucketStart',
        'bucketEnd',
        'status',
        'quantityKWh',
        'coveredQuantityKWh',
        'uncoveredQuantityKWh',
        'projectImpactKgCO2e',
        'coveredImpactKgCO2e',
        'scope2KgCO2e',
        'factorKeys'
    ],
    properties: {
        bucketStart: {type: 'string', format: 'date-time'},
        bucketEnd: {type: 'string', format: 'date-time'},
        status: {
            type: 'string',
            enum: ['complete', 'partial', 'unconfigured']
        },
        quantityKWh: {type: 'number'},
        coveredQuantityKWh: {type: 'number'},
        uncoveredQuantityKWh: {type: 'number'},
        projectImpactKgCO2e: {
            type: ['number', 'null'] as JsonSchemaType[]
        },
        coveredImpactKgCO2e: {type: 'number'},
        scope2KgCO2e: {type: ['number', 'null'] as JsonSchemaType[]},
        factorKeys: {type: 'array', items: {type: 'string'}}
    }
};

const CARBON_CALCULATE_BREAKDOWN_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'from',
        'to',
        'granularity',
        'status',
        'quantityKWh',
        'coveredQuantityKWh',
        'uncoveredQuantityKWh',
        'projectImpactKgCO2e',
        'coveredImpactKgCO2e',
        'scope2KgCO2e',
        'factorKeys',
        'locationsAdditive',
        'factorCoverageStatus',
        'dataCoverage',
        'warnings',
        'factors',
        'series',
        'locations'
    ],
    properties: {
        from: ISO_DATE_TIME,
        to: ISO_DATE_TIME,
        granularity: {
            type: 'string',
            enum: [...CARBON_BREAKDOWN_GRANULARITIES]
        },
        status: {
            type: 'string',
            enum: ['complete', 'partial', 'unconfigured']
        },
        quantityKWh: {type: 'number'},
        coveredQuantityKWh: {type: 'number'},
        uncoveredQuantityKWh: {type: 'number'},
        projectImpactKgCO2e: {
            type: ['number', 'null'] as JsonSchemaType[]
        },
        coveredImpactKgCO2e: {type: 'number'},
        scope2KgCO2e: {type: ['number', 'null'] as JsonSchemaType[]},
        factorKeys: {type: 'array', items: {type: 'string'}},
        locationsAdditive: {type: 'boolean', enum: [true]},
        factorCoverageStatus: {
            type: 'string',
            enum: ['complete', 'partial', 'unconfigured']
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
                requestedFrom: ISO_DATE_TIME,
                requestedTo: ISO_DATE_TIME,
                coveredFrom: ISO_DATE_TIME,
                coveredTo: ISO_DATE_TIME,
                fraction: {type: 'number', minimum: 0, maximum: 1}
            }
        },
        warnings: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['code', 'message'],
                properties: {
                    code: {
                        type: 'string',
                        enum: ['partial_data_coverage']
                    },
                    message: {type: 'string'}
                }
            }
        },
        factors: {type: 'array', items: BREAKDOWN_FACTOR_SCHEMA},
        series: {type: 'array', items: BREAKDOWN_POINT_SCHEMA},
        locations: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'locationId',
                    'locationName',
                    'region',
                    'status',
                    'quantityKWh',
                    'coveredQuantityKWh',
                    'uncoveredQuantityKWh',
                    'projectImpactKgCO2e',
                    'coveredImpactKgCO2e',
                    'scope2KgCO2e',
                    'factorKeys',
                    'series'
                ],
                properties: {
                    locationId: {
                        type: ['integer', 'null'] as JsonSchemaType[]
                    },
                    locationName: {type: 'string'},
                    region: {type: 'string'},
                    status: {
                        type: 'string',
                        enum: ['complete', 'partial', 'unconfigured']
                    },
                    quantityKWh: {type: 'number'},
                    coveredQuantityKWh: {type: 'number'},
                    uncoveredQuantityKWh: {type: 'number'},
                    projectImpactKgCO2e: {
                        type: ['number', 'null'] as JsonSchemaType[]
                    },
                    coveredImpactKgCO2e: {type: 'number'},
                    scope2KgCO2e: {
                        type: ['number', 'null'] as JsonSchemaType[]
                    },
                    factorKeys: {
                        type: 'array',
                        items: {type: 'string'}
                    },
                    series: {type: 'array', items: BREAKDOWN_POINT_SCHEMA}
                }
            }
        }
    }
};

export const CARBON_DESCRIBE: DescribeOutput = new DescribeBuilder('carbon', {
    kind: 'fleet-manager',
    description:
        'Versioned emission factors and separate carbon valuations. Carbon prices never modify utility bills.'
})
    .registerMethod('ListEmissionFactors', {
        safety: {operation: 'read'},
        params: CARBON_LIST_PARAMS_SCHEMA,
        response: {
            type: 'object',
            required: ['items', 'nextBeforeId'],
            properties: {
                items: {type: 'array', items: FACTOR_RESPONSE_SCHEMA},
                nextBeforeId: {
                    type: ['integer', 'null'] as JsonSchemaType[],
                    minimum: 1
                }
            }
        },
        permission: {component: 'reports', operation: 'read'}
    })
    .registerMethod('AddEmissionFactor', {
        params: EMISSION_FACTOR_SPEC_SCHEMA,
        response: {
            type: 'object',
            required: ['factor'],
            properties: {factor: FACTOR_RESPONSE_SCHEMA}
        },
        permission: {component: 'reports', operation: 'create'}
    })
    .registerMethod('ListPrices', {
        safety: {operation: 'read'},
        params: CARBON_LIST_PARAMS_SCHEMA,
        response: {
            type: 'object',
            required: ['items', 'nextBeforeId'],
            properties: {
                items: {type: 'array', items: PRICE_RESPONSE_SCHEMA},
                nextBeforeId: {
                    type: ['integer', 'null'] as JsonSchemaType[],
                    minimum: 1
                }
            }
        },
        permission: {component: 'reports', operation: 'read'}
    })
    .registerMethod('AddPrice', {
        params: CARBON_PRICE_SPEC_SCHEMA,
        response: {
            type: 'object',
            required: ['price'],
            properties: {price: PRICE_RESPONSE_SCHEMA}
        },
        permission: {component: 'reports', operation: 'create'}
    })
    .registerMethod('Calculate', {
        safety: {operation: 'read'},
        params: CARBON_CALCULATE_PARAMS_SCHEMA,
        response: {
            type: 'object',
            required: [
                'quantity',
                'projectImpactKgCO2e',
                'scope2KgCO2e',
                'factor',
                'carbonPriceStatus',
                'carbonValue'
            ],
            properties: {
                quantity: {type: 'number'},
                projectImpactKgCO2e: {type: 'number'},
                scope2KgCO2e: {
                    type: ['number', 'null'] as JsonSchemaType[]
                },
                factor: {
                    type: 'object',
                    required: [
                        'id',
                        'factorKgPerUnit',
                        'source',
                        'sourceReference',
                        'revision',
                        'accountingBasis',
                        'emissionsScope'
                    ],
                    properties: {
                        id: {type: ['integer', 'null'] as JsonSchemaType[]},
                        factorKgPerUnit: {type: 'number'},
                        source: {
                            type: 'string',
                            enum: [
                                'dashboard_override',
                                'factor_store',
                                'deployment_default'
                            ]
                        },
                        sourceReference: {type: 'string'},
                        revision: {
                            type: ['integer', 'null'] as JsonSchemaType[]
                        },
                        accountingBasis: {
                            type: 'string',
                            enum: [...CARBON_ACCOUNTING_BASES]
                        },
                        emissionsScope: {
                            type: 'string',
                            enum: [...CARBON_EMISSIONS_SCOPES]
                        }
                    }
                },
                carbonPriceStatus: {
                    type: 'string',
                    enum: [
                        'not_requested',
                        'resolved',
                        'unavailable_or_ambiguous'
                    ]
                },
                carbonValue: {
                    type: ['object', 'null'] as JsonSchemaType[],
                    required: [
                        'amount',
                        'currency',
                        'priceId',
                        'priceType',
                        'amountPerTonne'
                    ],
                    properties: {
                        amount: {type: 'number'},
                        currency: {type: 'string'},
                        priceId: {type: 'integer'},
                        priceType: {
                            type: 'string',
                            enum: [...CARBON_PRICE_TYPES]
                        },
                        amountPerTonne: {type: 'number'}
                    }
                }
            }
        },
        permission: {component: 'reports', operation: 'read'},
        description:
            'Resolve dashboard override > factor store > deployment default, compute physical impact, and optionally disclose one explicitly selected or unambiguous carbon valuation.'
    })
    .registerMethod('CalculateBreakdown', {
        safety: {operation: 'read'},
        params: CARBON_CALCULATE_BREAKDOWN_PARAMS_SCHEMA,
        response: CARBON_CALCULATE_BREAKDOWN_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description:
            'Calculate location-based Scope 2 electricity emissions from Fleet energy history. Fleet resolves scope, recorded-data coverage, location regions, factor coverage, aggregate totals, per-location totals, and interval series. Leading pre-enrollment history gaps return an explicit partial dataCoverage and never a complete aggregate.'
    })
    .build();
