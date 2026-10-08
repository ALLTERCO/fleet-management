/**
 * Public API types for the `Report.*` namespace — Describe() contract.
 *
 * Covers ad-hoc report generation (async job front door) and retention.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    BILL_RECONCILIATION_SELECTOR_SCHEMA,
    type BillReconciliationSelector
} from './bill';
import {
    ELECTRICAL_SOURCES,
    type ElectricalSource,
    type EnergyCommodity
} from './energy';
import {DASHBOARD_SCOPE_SCHEMA, type DashboardScope} from './fleet';
import {REPORT_SECTION_IDS, type ReportSectionId} from './reporttemplate';
import {SENSOR_SOURCES, type SensorSource} from './sensor';
import type {TariffBilledUnit} from './tariff';

// Named relative ranges; resolved to {from,to} at run time (see reportPeriod).
export type ReportPeriod =
    | 'last_7_days'
    | 'last_month'
    | 'mtd'
    | 'last_year'
    | 'ytd'
    | 'billing_period';
export const REPORT_PERIODS: readonly ReportPeriod[] = [
    'last_7_days',
    'last_month',
    'mtd',
    'last_year',
    'ytd',
    'billing_period'
];
export type ReportOutputFormat = 'csv' | 'html' | 'xlsx' | 'pdf';

export interface ReportCoverageInterval {
    status: 'complete' | 'partial';
    requestedFrom: string;
    requestedTo: string;
    coveredFrom: string;
    coveredTo: string;
    fraction: number;
}

export interface ReportMeasuredUsageCost {
    /** Computed measured-usage charge before currency minor-unit rounding. */
    amount: number;
    /** The same charge rounded to the currency's minor unit. */
    roundedAmount: number;
    currency: string;
    fractionDigits: number;
    /** True only when a non-zero amount would otherwise be presented as zero. */
    roundsToZeroAtMinorUnit: boolean;
}

/** Hard cap for an explicit report location selection. Keeps one report job
 * bounded while still covering a portfolio-sized parking or retail estate. */
export const REPORT_LOCATION_SELECTION_MAX_ITEMS = 100;

export interface ReportGenerateParams {
    scope?: DashboardScope;
    devices?: string[];
    /** Metrics to export side by side (consumption, voltage, current, power…). */
    metrics: string[];
    from: string;
    to: string;
    granularity: string;
    per_device?: boolean;
    /** Keep the three phases as separate columns (a/b/c act/ret energy) instead
     *  of summing them into one device total. Energy metrics only. */
    per_phase?: boolean;
    /** Named relative range resolved server-side in the org tz; pass this OR
     *  from/to, not both. */
    period?: ReportPeriod;
    /** Billing-cycle reset day (1-28) for period='billing_period'. */
    billing_day?: number;
}

export interface ReportGenerateEnergyParams {
    scope?: DashboardScope;
    /**
     * Fleet-owned multi-location report scope. Mutually exclusive with `scope`.
     * Fleet resolves the selected location subtrees, authorization and device
     * union at execution time, so a template never computes report rows itself.
     */
    locationIds?: number[];
    from: string;
    to: string;
    /** Named relative range resolved server-side in the org tz; pass this OR
     *  from/to, not both. */
    period?: ReportPeriod;
    /** Billing-cycle reset day (1-28) for period='billing_period'. */
    billing_day?: number;
    granularity?: 'fifteen_minutes' | 'hour' | 'day' | 'month';
    /** XLSX/PDF are bounded server artifacts; HTML and CSV remain compatible. */
    format?: ReportOutputFormat;
    tariff?: number;
    tariff_mode?: 'single' | 'day_night' | 'tou';
    day_rate?: number;
    night_rate?: number;
    day_start?: string;
    day_end?: string;
    currency?: string;
    /** Stored tariff from the org library; overrides the inline rate fields. */
    tariff_id?: number;
    /** Quantity axis. Defaults to the stored tariff, then electricity/kWh. */
    commodity?: EnergyCommodity;
    billedUnit?: TariffBilledUnit;
    /** Meaningful for electricity; defaults to ac_mains. */
    electricalSource?: ElectricalSource;
    /** Optional region key for effective-dated carbon factor resolution. */
    carbonRegion?: string;
    /** IANA tz name (e.g. 'Europe/Sofia') anchoring bill-period matching;
     *  falls back to the org timezone_default, then UTC. */
    timezone?: string;
    /** Exact recorded-bill selector for multi-account organizations. billId
     * is org-scoped; accompanying identity fields are verified evidence. */
    billIdentity?: BillReconciliationSelector;
    main_meter_ids?: string[];
    /** Report domain selector — reserves the seam for future environmental
     *  (temperature/humidity) reports. Only 'energy' is valid today; omitted
     *  is treated as 'energy'. */
    category?: 'energy';
    /** Explicit peak-demand devices (shellyIDs). Used instead of the
     *  dashboard's peak devices when present; falls back to the dashboard
     *  (then all devices) when omitted. */
    peak_device_ids?: string[];
    /** PV display switch override. Matches the dashboard's pv_mode setting —
     *  the only PV input a report supplies (grid/generation meters come from
     *  logical-meter roles). Falls back to the dashboard's mode when omitted. */
    pv_mode?: 'parallel' | 'backup' | 'balcony';
    /** Optional: when the report belongs to a specific dashboard, the
     *  dashboard's saved emission factor (and other forthcoming settings)
     *  override env defaults. Falls back to env tunable when omitted. */
    dashboardId?: number;
    /** Allowlist for the role-gated sections (demand/solar/battery/ev/tenant).
     *  Empty/omitted = all triggered sections; core sections always render. */
    sections_enabled?: ReportSectionId[];
    /** Power-quality nominal voltage (V) / frequency (Hz) for the EN-50160
     *  band. Region/site-specific (EU 230/50, US 120/60, …); overrides the
     *  deployment default when set. */
    nominalVoltage?: number;
    nominalHz?: number;
    /** Wait for report-range rollups and reject when device history is behind. */
    require_complete_data?: boolean;
}

// --- SuggestTimeShift ----------------------------------------------------

export interface ReportSuggestTimeShiftParams {
    scope?: DashboardScope;
    devices?: string[];
    from: string;
    to: string;
    dashboardId?: number;
    maxShiftableKWh?: number;
}

export interface ReportSuggestTimeShiftResponse {
    plan: null | {
        fromHour: number;
        toHour: number;
        shiftedKWh: number;
        avoidedKgCO2: number;
        worstGPerKWh: number;
        bestGPerKWh: number;
    };
}

export const REPORT_SUGGEST_TIME_SHIFT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['from', 'to'],
    properties: {
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {type: 'array', items: {type: 'string', minLength: 1}},
        from: {type: 'string'},
        to: {type: 'string'},
        dashboardId: {type: 'integer', minimum: 1},
        maxShiftableKWh: {type: 'number', minimum: 0}
    }
};

export const REPORT_SUGGEST_TIME_SHIFT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['plan'],
    properties: {
        plan: {
            oneOf: [
                {type: 'null'},
                {
                    type: 'object',
                    required: [
                        'fromHour',
                        'toHour',
                        'shiftedKWh',
                        'avoidedKgCO2',
                        'worstGPerKWh',
                        'bestGPerKWh'
                    ],
                    properties: {
                        fromHour: {type: 'integer', minimum: 0, maximum: 23},
                        toHour: {type: 'integer', minimum: 0, maximum: 23},
                        shiftedKWh: {type: 'number'},
                        avoidedKgCO2: {type: 'number'},
                        worstGPerKWh: {type: 'number'},
                        bestGPerKWh: {type: 'number'}
                    }
                }
            ]
        }
    }
};

// --- GenerateReport ------------------------------------------------------

// from/to are intentionally NOT required: a caller may pass `period` instead.
// validateReportRequest enforces exactly one of {period} or {from + to}.
export const REPORT_GENERATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['metrics', 'granularity'],
    properties: {
        scope: DASHBOARD_SCOPE_SCHEMA,
        devices: {
            type: 'array',
            items: {type: 'string', minLength: 1}
        },
        metrics: {
            type: 'array',
            items: {type: 'string', minLength: 1},
            minItems: 1
        },
        from: {type: 'string'},
        to: {type: 'string'},
        period: {type: 'string', enum: [...REPORT_PERIODS]},
        billing_day: {type: 'integer', minimum: 1, maximum: 28},
        granularity: {type: 'string'},
        per_device: {type: 'boolean'},
        per_phase: {type: 'boolean'}
    }
};

// --- GenerateEnergyReport ------------------------------------------------

// from/to are intentionally NOT required: a caller may pass `period` instead.
// validateReportRequest enforces exactly one of {period} or {from + to}.
export const REPORT_GENERATE_ENERGY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: [],
    properties: {
        scope: DASHBOARD_SCOPE_SCHEMA,
        locationIds: {
            type: 'array',
            items: {type: 'integer', minimum: 1},
            minItems: 1,
            maxItems: REPORT_LOCATION_SELECTION_MAX_ITEMS,
            uniqueItems: true,
            description:
                'Fleet-owned multi-location selector. Mutually exclusive with scope; every selected location must resolve to a fully authorized non-empty device scope.'
        },
        from: {type: 'string'},
        to: {type: 'string'},
        period: {type: 'string', enum: [...REPORT_PERIODS]},
        billing_day: {type: 'integer', minimum: 1, maximum: 28},
        granularity: {
            type: 'string',
            enum: ['fifteen_minutes', 'hour', 'day', 'month']
        },
        format: {type: 'string', enum: ['csv', 'html', 'xlsx', 'pdf']},
        tariff: {type: 'number', minimum: 0},
        tariff_mode: {type: 'string', enum: ['single', 'day_night', 'tou']},
        day_rate: {type: 'number', minimum: 0},
        night_rate: {type: 'number', minimum: 0},
        day_start: {type: 'string'},
        day_end: {type: 'string'},
        currency: {type: 'string'},
        tariff_id: {type: 'integer', minimum: 1},
        commodity: {
            type: 'string',
            enum: ['electricity', 'water', 'gas', 'heat']
        },
        billedUnit: {
            type: 'string',
            enum: ['kWh', 'm3', 'l', 'therm', 'MMBtu', 'GJ']
        },
        electricalSource: {
            type: 'string',
            enum: [...ELECTRICAL_SOURCES]
        },
        carbonRegion: {type: 'string', minLength: 1, maxLength: 120},
        timezone: {type: 'string', maxLength: 64},
        billIdentity: BILL_RECONCILIATION_SELECTOR_SCHEMA,
        main_meter_ids: {type: 'array', items: {type: 'string'}},
        // Report domain selector — only 'energy' today; environment later.
        category: {type: 'string', enum: ['energy']},
        peak_device_ids: {type: 'array', items: {type: 'string'}},
        pv_mode: {type: 'string', enum: ['parallel', 'backup', 'balcony']},
        dashboardId: {type: 'integer', minimum: 1},
        sections_enabled: {
            type: 'array',
            items: {type: 'string', enum: [...REPORT_SECTION_IDS]},
            uniqueItems: true
        },
        nominalVoltage: {type: 'number', minimum: 1},
        nominalHz: {type: 'number', minimum: 1},
        require_complete_data: {type: 'boolean'}
    }
};

// --- GenerateEnvironmentReport -------------------------------------------

// Toggleable environment report sections — the twin of REPORT_SECTION_IDS.
// Summary + comfort are core (always rendered); these render only when both
// their data is present AND (when an allowlist is given) they are listed.
export const ENVIRONMENT_REPORT_SECTION_IDS = [
    'air',
    'light',
    'weather',
    'water',
    'presence',
    'safety',
    'per_sensor',
    'breaches',
    'recommendations',
    'data_quality'
] as const;
export type EnvironmentReportSectionId =
    (typeof ENVIRONMENT_REPORT_SECTION_IDS)[number];

// Public numeric reading vocabulary supported by the environment report. This
// is the query fan-out used by the engine, so the API filter and stored sensor
// reads cannot drift into separate classifications.
export const ENVIRONMENT_REPORT_READING_KINDS = [
    'temperature',
    'humidity',
    'illuminance',
    'co2',
    'tvoc',
    'pm25',
    'pm10',
    'pressure',
    'dewpoint',
    'uv',
    'wind_speed',
    'precipitation',
    'moisture',
    'flow',
    'water_temperature',
    'water_pressure',
    'battery'
] as const;
export type EnvironmentReportReadingKind =
    (typeof ENVIRONMENT_REPORT_READING_KINDS)[number];

// The environmental twin of the energy report. Same scope + window shape (pass
// period OR from+to), but sourced from the device_sensor 15-minute rollup that
// the environment dashboard uses — no tariff/PV/cost inputs.
export interface ReportGenerateEnvironmentParams {
    scope?: DashboardScope;
    from?: string;
    to?: string;
    /** Named relative range resolved server-side in the org tz; pass this OR
     *  from/to, not both. */
    period?: ReportPeriod;
    /** Billing-cycle reset day (1-28) for period='billing_period'. */
    billing_day?: number;
    granularity?: 'fifteen_minutes' | 'hour' | 'day' | 'month';
    format?: ReportOutputFormat;
    /** Reading-source filter (builtin/addon/blu/weather/internal). Omit for all
     *  ambient sources — omitting drops chip temps (internal), matching the
     *  dashboard; pass 'internal' explicitly to include them. */
    source?: SensorSource;
    /** Numeric sensor kinds to include. Omit for every environment-report kind. */
    kinds?: EnvironmentReportReadingKind[];
    /** IANA tz name anchoring period resolution; falls back to the org
     *  timezone_default, then UTC. */
    timezone?: string;
    /** When the report belongs to a dashboard, gates cross-tenant reads and
     *  reserves the seam for stored comfort/threshold settings. */
    dashboardId?: number;
    /** Explicit device allowlist (shellyIDs), access-filtered server-side.
     *  Lets the dashboard export exactly what its on-screen filter shows; takes
     *  precedence over `scope` when present. */
    devices?: string[];
    /** Allowlist for the optional sections. Empty/omitted renders every
     *  data-present section; core (summary + comfort) always renders. */
    sections_enabled?: EnvironmentReportSectionId[];
}

// from/to are intentionally NOT required: a caller may pass `period` instead.
// engineHelpers.assertExactlyOneRange enforces exactly one of {period}/{from+to}.
export const REPORT_GENERATE_ENVIRONMENT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: [],
    properties: {
        scope: DASHBOARD_SCOPE_SCHEMA,
        from: {type: 'string'},
        to: {type: 'string'},
        period: {type: 'string', enum: [...REPORT_PERIODS]},
        billing_day: {type: 'integer', minimum: 1, maximum: 28},
        granularity: {
            type: 'string',
            enum: ['fifteen_minutes', 'hour', 'day', 'month']
        },
        format: {type: 'string', enum: ['csv', 'html', 'xlsx', 'pdf']},
        source: {type: 'string', enum: [...SENSOR_SOURCES]},
        kinds: {
            type: 'array',
            items: {
                type: 'string',
                enum: [...ENVIRONMENT_REPORT_READING_KINDS]
            },
            minItems: 1,
            uniqueItems: true
        },
        timezone: {type: 'string', maxLength: 64},
        dashboardId: {type: 'integer', minimum: 1},
        devices: {
            type: 'array',
            items: {type: 'string', minLength: 1},
            maxItems: 500,
            description:
                'Access-filtered shellyID allowlist; takes precedence over scope.'
        },
        sections_enabled: {
            type: 'array',
            items: {type: 'string', enum: [...ENVIRONMENT_REPORT_SECTION_IDS]},
            uniqueItems: true
        }
    }
};

// --- PurgeReports --------------------------------------------------------

export const REPORT_PURGE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {}
};

export const REPORT_PURGE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['success', 'deletedFiles', 'deletedDb'],
    properties: {
        success: {type: 'boolean', const: true},
        deletedFiles: {type: 'integer', minimum: 0},
        deletedDb: {type: 'boolean'}
    }
};

// --- Generate / GetReport (the unified report endpoint) ------------------
//
// One front door for every report and export. `kind` selects the report;
// each public branch carries its complete closed parameter schema.

// 'energy' = the formatted energy report; 'interval' = per-device interval data
// (load profile) — chosen metrics + granularity, CSV. Pass per_phase=true on an
// interval report to keep phases as separate columns instead of summing them.
// 'energy_dump' = backwards-compat alias retained for existing tenants (e.g. t6)
// whose integrations call the legacy per-phase 15-minute dump; it routes to the
// per-phase interval engine (interval + per_phase=true).
// 'environment' = the environmental report (temperature/humidity/air-quality/
// light/weather/water from the device_sensor rollup) — the twin of 'energy'.
export type ReportKind = 'energy' | 'interval' | 'energy_dump' | 'environment';

type ReportGenerateWindow =
    | {
          from: string;
          to: string;
          period?: never;
          billing_day?: never;
      }
    | {
          period: ReportPeriod;
          billing_day?: number;
          from?: never;
          to?: never;
      };

type ReportGenerateWindowedParams<T> = Omit<
    T,
    'from' | 'to' | 'period' | 'billing_day'
> &
    ReportGenerateWindow;

export type ReportGenerateUnifiedParams =
    | (ReportGenerateWindowedParams<ReportGenerateEnergyParams> & {
          kind: 'energy';
      })
    | (ReportGenerateWindowedParams<ReportGenerateParams> & {
          kind: 'interval';
          format?: 'csv';
      })
    | (ReportGenerateWindowedParams<ReportGenerateParams> & {
          kind: 'energy_dump';
          format?: 'csv';
      })
    | (ReportGenerateWindowedParams<ReportGenerateEnvironmentParams> & {
          kind: 'environment';
      });

function reportGenerateKindSchema(
    kind: ReportKind,
    paramsSchema: JsonSchema,
    extraProperties: Record<string, JsonSchema> = {}
): JsonSchema {
    const properties = paramsSchema.properties ?? {};
    const commonProperties = Object.fromEntries(
        Object.entries(properties).filter(
            ([key]) =>
                key !== 'from' &&
                key !== 'to' &&
                key !== 'period' &&
                key !== 'billing_day'
        )
    );
    const required = (paramsSchema.required ?? []).filter(
        (key) =>
            key !== 'from' &&
            key !== 'to' &&
            key !== 'period' &&
            key !== 'billing_day'
    );
    const branchProperties: Record<string, JsonSchema> = {
        kind: {type: 'string', const: kind},
        ...commonProperties,
        ...extraProperties
    };
    return {
        oneOf: [
            {
                type: 'object',
                required: ['kind', ...required, 'from', 'to'],
                additionalProperties: false,
                properties: {
                    ...branchProperties,
                    from: properties.from,
                    to: properties.to,
                    period: {not: {}},
                    billing_day: {not: {}}
                }
            },
            {
                type: 'object',
                required: ['kind', ...required, 'period'],
                additionalProperties: false,
                properties: {
                    ...branchProperties,
                    period: properties.period,
                    billing_day: properties.billing_day,
                    from: {not: {}},
                    to: {not: {}}
                }
            }
        ]
    };
}

export const REPORT_GENERATE_UNIFIED_PARAMS_SCHEMA: JsonSchema = {
    oneOf: [
        reportGenerateKindSchema(
            'energy',
            REPORT_GENERATE_ENERGY_PARAMS_SCHEMA
        ),
        reportGenerateKindSchema('interval', REPORT_GENERATE_PARAMS_SCHEMA, {
            format: {type: 'string', const: 'csv'}
        }),
        reportGenerateKindSchema('energy_dump', REPORT_GENERATE_PARAMS_SCHEMA, {
            format: {type: 'string', const: 'csv'}
        }),
        reportGenerateKindSchema(
            'environment',
            REPORT_GENERATE_ENVIRONMENT_PARAMS_SCHEMA
        )
    ]
};

export const REPORT_GET_REPORT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['jobId'],
    additionalProperties: false,
    properties: {
        jobId: {type: 'string', minLength: 1}
    }
};

export const REPORT_CANCEL_PARAMS_SCHEMA = REPORT_GET_REPORT_PARAMS_SCHEMA;
export const REPORT_DELETE_PARAMS_SCHEMA = REPORT_GET_REPORT_PARAMS_SCHEMA;

export const REPORT_GENERATE_JOB_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['jobId', 'status'],
    properties: {
        jobId: {type: 'string'},
        status: {type: 'string', enum: ['pending']}
    }
};

const REPORT_PROGRESS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        estimatedRows: {type: 'integer', minimum: 0},
        rowsWritten: {type: 'integer', minimum: 0},
        bytesWritten: {type: 'integer', minimum: 0},
        currentPhase: {type: 'string'},
        percent: {type: 'number', minimum: 0, maximum: 100},
        lastActivityAt: {
            type: 'string',
            format: 'date-time',
            description:
                'When the job last recorded activity. Distinguishes a slow poll from work that has stalled.'
        }
    },
    additionalProperties: false
};

const REPORT_ARTIFACTS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        dataCsvGz: {type: 'string'},
        summaryHtml: {type: 'string'},
        workbookXlsx: {type: 'string'},
        documentPdf: {type: 'string'}
    },
    additionalProperties: false
};

const REPORT_COVERAGE_INTERVAL_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'status',
        'requestedFrom',
        'requestedTo',
        'coveredFrom',
        'coveredTo',
        'fraction'
    ],
    additionalProperties: false,
    properties: {
        status: {type: 'string', enum: ['complete', 'partial']},
        requestedFrom: {type: 'string', format: 'date-time'},
        requestedTo: {type: 'string', format: 'date-time'},
        coveredFrom: {type: 'string', format: 'date-time'},
        coveredTo: {type: 'string', format: 'date-time'},
        fraction: {type: 'number', minimum: 0, maximum: 1}
    }
};

const REPORT_MEASURED_USAGE_COST_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'amount',
        'roundedAmount',
        'currency',
        'fractionDigits',
        'roundsToZeroAtMinorUnit'
    ],
    additionalProperties: false,
    properties: {
        amount: {type: 'number'},
        roundedAmount: {type: 'number'},
        currency: {type: 'string'},
        fractionDigits: {type: 'integer', minimum: 0},
        roundsToZeroAtMinorUnit: {type: 'boolean'}
    }
};

const REPORT_MANIFEST_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['expiresAt', 'bytes'],
    properties: {
        dataCsvGz: {type: 'string'},
        summaryHtml: {type: 'string'},
        workbookXlsx: {type: 'string'},
        documentPdf: {type: 'string'},
        expiresAt: {type: 'string', format: 'date-time'},
        bytes: {type: 'integer', minimum: 0},
        report: {
            type: 'object',
            additionalProperties: true
        }
    },
    additionalProperties: false
};

export const REPORT_GENERATION_STATUS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['jobId', 'status'],
    properties: {
        jobId: {type: 'string'},
        status: {
            type: 'string',
            enum: ['pending', 'ready', 'failed', 'cancelled']
        },
        downloadUrl: {type: ['string', 'null']},
        htmlUrl: {type: ['string', 'null']},
        artifacts: {oneOf: [{type: 'null'}, REPORT_ARTIFACTS_SCHEMA]},
        coverage: {
            oneOf: [{type: 'null'}, REPORT_COVERAGE_INTERVAL_SCHEMA]
        },
        measuredUsageCost: {
            oneOf: [{type: 'null'}, REPORT_MEASURED_USAGE_COST_SCHEMA]
        },
        manifest: {oneOf: [{type: 'null'}, REPORT_MANIFEST_SCHEMA]},
        progress: {oneOf: [{type: 'null'}, REPORT_PROGRESS_SCHEMA]},
        expiresAt: {type: ['string', 'null'], format: 'date-time'},
        bytes: {type: ['integer', 'null']},
        error: {type: ['string', 'null']}
    }
};

export const REPORT_CANCEL_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['jobId', 'status'],
    properties: {
        jobId: {type: 'string'},
        status: {
            type: 'string',
            enum: ['pending', 'ready', 'failed', 'cancelled']
        }
    }
};

export const REPORT_DELETE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['success', 'jobId', 'deletedFiles'],
    additionalProperties: false,
    properties: {
        success: {type: 'boolean', const: true},
        jobId: {type: 'string'},
        deletedFiles: {type: 'integer', minimum: 0}
    }
};

// --- Describe ------------------------------------------------------------

export const REPORT_DESCRIBE: DescribeOutput = new DescribeBuilder('report', {
    kind: 'fleet-manager',
    description: 'Generate energy reports and manage their retention.'
})
    .registerMethod('Generate', {
        params: REPORT_GENERATE_UNIFIED_PARAMS_SCHEMA,
        response: REPORT_GENERATE_JOB_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Unified report endpoint — one front door for reports and data exports. ' +
            'Returns a jobId immediately (async); poll Report.GetReport for status + ' +
            'the owner-bound download URL. Supported kinds include `energy` (the energy report — ' +
            'cost, tariff, CO2 and per-source sections; from, to, granularity incl. ' +
            '15-minute, scope or Fleet-owned locationIds, tariff, currency, main_meter_ids, dashboardId; format ' +
            'html | csv | xlsx | pdf) and `interval` (interval data / "load profile" — per-device ' +
            'readings of one or more metrics at a chosen granularity: metrics, from, ' +
            'to, granularity, scope/devices, per_device; streamed CSV) and ' +
            '`environment` (the environmental report — comfort, air quality, ' +
            'light, weather, water, per-sensor breakdown, threshold breaches from the ' +
            'device_sensor rollup; from, to, granularity, scope, source, kinds; format ' +
            'html | csv | xlsx | pdf). ' +
            'Use Energy.Query for live on-screen charts; use this for files to download.'
    })
    .registerMethod('GetReport', {
        params: REPORT_GET_REPORT_PARAMS_SCHEMA,
        response: REPORT_GENERATION_STATUS_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Fetch a report started by Report.Generate. Owner-checked: a caller only ' +
            'sees their own jobs. Returns status (pending | ready | failed); when ready, ' +
            'coverage reports the requested and measured intervals and marks an honest partial result; ' +
            'downloadUrl/htmlUrl keep backwards compatibility and artifacts carries the ' +
            'dataCsvGz/summaryHtml/workbookXlsx/documentPdf files served from /api/exports/download ' +
            '(authenticated GET, streamed). Records expire after configured report retention.'
    })
    .registerMethod('Cancel', {
        params: REPORT_CANCEL_PARAMS_SCHEMA,
        response: REPORT_CANCEL_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Cancel a pending/running report job owned by the caller. Ready and failed jobs are returned unchanged.'
    })
    .registerMethod('Delete', {
        safety: {operation: 'delete'},
        params: REPORT_DELETE_PARAMS_SCHEMA,
        response: REPORT_DELETE_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Delete one finished report job owned by the caller, its files and their download ownership records. A running report must be cancelled first.'
    })
    .registerMethod('SuggestTimeShift', {
        params: REPORT_SUGGEST_TIME_SHIFT_PARAMS_SCHEMA,
        response: REPORT_SUGGEST_TIME_SHIFT_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description:
            'Suggest the single best hour-to-hour load shift for the given device scope + window, scored against grid carbon intensity. Returns null when no useful shift can be proposed.'
    })
    .registerMethod('PurgeReports', {
        safety: {operation: 'delete'},
        params: REPORT_PURGE_PARAMS_SCHEMA,
        response: REPORT_PURGE_RESPONSE_SCHEMA,
        permission: {
            note: 'provider-support-only — instance-wide; drops every tenant report instance and the on-disk CSVs'
        },
        description:
            'Wipe every stored report instance and the on-disk CSV files. Instance-wide provider support recovery only.'
    })
    .build();
