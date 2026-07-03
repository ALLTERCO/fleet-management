/**
 * Public API types for the `Report.*` namespace — Describe() contract.
 *
 * Covers ad-hoc report generation (async job front door) and retention.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {DASHBOARD_SCOPE_SCHEMA, type DashboardScope} from './fleet';
import {REPORT_SECTION_IDS, type ReportSectionId} from './reporttemplate';

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
    from: string;
    to: string;
    /** Named relative range resolved server-side in the org tz; pass this OR
     *  from/to, not both. */
    period?: ReportPeriod;
    /** Billing-cycle reset day (1-28) for period='billing_period'. */
    billing_day?: number;
    granularity?: 'fifteen_minutes' | 'hour' | 'day' | 'month';
    tariff?: number;
    tariff_mode?: 'single' | 'day_night' | 'tou';
    day_rate?: number;
    night_rate?: number;
    day_start?: string;
    day_end?: string;
    currency?: string;
    /** Stored tariff from the org library; overrides the inline rate fields. */
    tariff_id?: number;
    /** IANA tz name (e.g. 'Europe/Sofia') anchoring bill-period matching;
     *  falls back to the org timezone_default, then UTC. */
    timezone?: string;
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
        from: {type: 'string'},
        to: {type: 'string'},
        period: {type: 'string', enum: [...REPORT_PERIODS]},
        billing_day: {type: 'integer', minimum: 1, maximum: 28},
        granularity: {
            type: 'string',
            enum: ['fifteen_minutes', 'hour', 'day', 'month']
        },
        tariff: {type: 'number', minimum: 0},
        tariff_mode: {type: 'string', enum: ['single', 'day_night', 'tou']},
        day_rate: {type: 'number', minimum: 0},
        night_rate: {type: 'number', minimum: 0},
        day_start: {type: 'string'},
        day_end: {type: 'string'},
        currency: {type: 'string'},
        tariff_id: {type: 'integer', minimum: 1},
        timezone: {type: 'string', maxLength: 64},
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
        nominalHz: {type: 'number', minimum: 1}
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
// each kind strictly validates its own params downstream, so this schema is
// intentionally permissive on the passthrough fields.

// 'energy' = the formatted energy report; 'interval' = per-device interval data
// (load profile) — chosen metrics + granularity, CSV. Pass per_phase=true on an
// interval report to keep phases as separate columns instead of summing them.
// 'energy_dump' = backwards-compat alias retained for existing tenants (e.g. t6)
// whose integrations call the legacy per-phase 15-minute dump; it routes to the
// per-phase interval engine (interval + per_phase=true).
export type ReportKind = 'energy' | 'interval' | 'energy_dump';

export interface ReportGenerateUnifiedParams {
    kind: ReportKind;
    format?: 'csv' | 'html';
    [k: string]: unknown;
}

export const REPORT_GENERATE_UNIFIED_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['kind'],
    additionalProperties: true,
    properties: {
        kind: {
            type: 'string',
            enum: ['energy', 'interval', 'energy_dump']
        },
        format: {type: 'string', enum: ['csv', 'html']}
    }
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
        percent: {type: 'number', minimum: 0, maximum: 100}
    },
    additionalProperties: false
};

const REPORT_ARTIFACTS_SCHEMA: JsonSchema = {
    type: 'object',
    properties: {
        dataCsvGz: {type: 'string'},
        summaryHtml: {type: 'string'}
    },
    additionalProperties: false
};

const REPORT_MANIFEST_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['expiresAt', 'bytes'],
    properties: {
        dataCsvGz: {type: 'string'},
        summaryHtml: {type: 'string'},
        expiresAt: {type: 'string', format: 'date-time'},
        bytes: {type: 'integer', minimum: 0}
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
            'the owner-bound download URL. Two `kind`s: `energy` (the energy report — ' +
            'cost, tariff, CO2 and per-source sections; from, to, granularity incl. ' +
            '15-minute, scope, tariff, currency, main_meter_ids, dashboardId; format ' +
            'html | csv) and `interval` (interval data / "load profile" — per-device ' +
            'readings of one or more metrics at a chosen granularity: metrics, from, ' +
            'to, granularity, scope/devices, per_device; streamed CSV). ' +
            'Use Energy.Query for live on-screen charts; use this for files to download.'
    })
    .registerMethod('GetReport', {
        params: REPORT_GET_REPORT_PARAMS_SCHEMA,
        response: REPORT_GENERATION_STATUS_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Fetch a report started by Report.Generate. Owner-checked: a caller only ' +
            'sees their own jobs. Returns status (pending | ready | failed); when ready, ' +
            'downloadUrl/htmlUrl keep backwards compatibility and artifacts carries the ' +
            'dataCsvGz/summaryHtml files served from /api/exports/download ' +
            '(authenticated GET, streamed). Records expire after configured report retention.'
    })
    .registerMethod('Cancel', {
        params: REPORT_CANCEL_PARAMS_SCHEMA,
        response: REPORT_CANCEL_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'update'},
        description:
            'Cancel a pending/running report job owned by the caller. Ready and failed jobs are returned unchanged.'
    })
    .registerMethod('SuggestTimeShift', {
        params: REPORT_SUGGEST_TIME_SHIFT_PARAMS_SCHEMA,
        response: REPORT_SUGGEST_TIME_SHIFT_RESPONSE_SCHEMA,
        permission: {component: 'reports', operation: 'read'},
        description:
            'Suggest the single best hour-to-hour load shift for the given device scope + window, scored against grid carbon intensity. Returns null when no useful shift can be proposed.'
    })
    .registerMethod('PurgeReports', {
        params: REPORT_PURGE_PARAMS_SCHEMA,
        response: REPORT_PURGE_RESPONSE_SCHEMA,
        permission: {
            note: 'provider-support-only — instance-wide; drops every tenant report instance and the on-disk CSVs'
        },
        description:
            'Wipe every stored report instance and the on-disk CSV files. Instance-wide provider support recovery only.'
    })
    .build();
