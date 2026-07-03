/**
 * Public API types for the `Tariff.*` namespace — Describe() contract.
 *
 * Covers the reusable org-level electricity-tariff library: flat / day-night /
 * TOU / seasonal / live kinds, and the assignment that attaches a tariff to a
 * metering point (dashboard / device / channel).
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

// ---- Domain types -------------------------------------------------------

export type TariffKind = 'single' | 'day_night' | 'tou' | 'live';
export type StandingChargePeriod = 'day' | 'month';

export interface TariffWindowSpec {
    daysMask: number; // bit0=Mon ... bit6=Sun
    startTime: string; // 'HH:MM'
    endTime: string; // 'HH:MM', exclusive
    price: number; // >= 0 for manual kinds
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
    standingCharge: number; // >= 0
    standingChargePeriod: StandingChargePeriod;
    vatPct: number | null;
    demandRate: number | null; // currency per kW-month
    seasons: TariffSeasonSpec[]; // 'single'/'day_night'/'tou' use one season ('01-01'..'12-31')
}

export type TariffScopeLevel = 'dashboard' | 'device' | 'channel';

export interface TariffAssignmentSpec {
    tariffId: number;
    scopeLevel: TariffScopeLevel;
    dashboardId: number | null;
    deviceExternalId: string | null;
    channel: number | null;
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
        price: {type: 'number', minimum: 0}
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

export const TARIFF_EMPTY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false
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
        kind: {type: 'string', enum: ['single', 'day_night', 'tou', 'live']},
        standingCharge: {type: 'number', minimum: 0},
        standingChargePeriod: {type: 'string', enum: ['day', 'month']},
        vatPct: {type: ['number', 'null']},
        demandRate: {type: ['number', 'null']},
        seasons: {type: 'array', items: TARIFF_SEASON_SCHEMA}
    }
};

export const TARIFF_ASSIGNMENT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['tariffId', 'scopeLevel'],
    properties: {
        tariffId: {type: 'integer'},
        scopeLevel: {type: 'string', enum: ['dashboard', 'device', 'channel']},
        dashboardId: {type: ['integer', 'null']},
        deviceExternalId: {type: ['string', 'null']},
        channel: {type: ['integer', 'null']}
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

export const TARIFF_DESCRIBE: DescribeOutput = new DescribeBuilder('tariff', {
    kind: 'fleet-manager',
    description: 'Manage reusable electricity tariffs.'
})
    .registerMethod('List', {
        params: {type: 'object', properties: {}},
        response: {type: 'object'},
        permission: {component: 'reports', operation: 'read'},
        description: 'List all tariffs in the caller org (header rows only).'
    })
    .registerMethod('Get', {
        params: {type: 'object', properties: {}},
        response: {type: 'object'},
        permission: {component: 'reports', operation: 'read'},
        description: 'Fetch one tariff with nested seasons and windows.'
    })
    .registerMethod('Add', {
        params: TARIFF_SPEC_SCHEMA,
        response: {type: 'object'},
        permission: {component: 'reports', operation: 'create'},
        description: 'Create a new tariff in the caller org.'
    })
    .registerMethod('Update', {
        params: TARIFF_SPEC_SCHEMA,
        response: {type: 'object'},
        permission: {component: 'reports', operation: 'update'},
        description:
            'Replace a tariff definition including its seasons and windows.'
    })
    .registerMethod('Delete', {
        params: {type: 'object', properties: {}},
        response: {type: 'object'},
        permission: {component: 'reports', operation: 'delete'},
        description: 'Delete a tariff by id within the caller org.'
    })
    .registerMethod('Assign', {
        params: TARIFF_ASSIGNMENT_SCHEMA,
        response: {type: 'object'},
        permission: {component: 'reports', operation: 'update'},
        description:
            'Attach or remove a tariff assignment for a metering point.'
    })
    .registerMethod('SetLiveSource', {
        params: TARIFF_SET_LIVE_SOURCE_SCHEMA,
        response: {type: 'object'},
        permission: {component: 'reports', operation: 'update'},
        description:
            'Configure a live tariff source. mode=push returns a one-time token for the price-push URL.'
    })
    .build();
