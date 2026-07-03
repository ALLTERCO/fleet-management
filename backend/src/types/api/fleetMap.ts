/** fleetMap.* — per-location pin snapshots for map dashboard overlays. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {ORG_ID_SCHEMA} from './_shared';
import type {AlertSeverity} from './alert';

export const FLEET_MAP_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA
    }
};

// ── Energy overlay ────────────────────────────────────────────

export interface FleetMapEnergyPin {
    locationId: number;
    currentLoadWatts: number;
    baselineWatts: number | null;
}

export interface FleetMapEnergySnapshot {
    pins: FleetMapEnergyPin[];
    asOf: string;
}

const ENERGY_PIN_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['locationId', 'currentLoadWatts', 'baselineWatts'],
    properties: {
        locationId: {type: 'integer', minimum: 1},
        currentLoadWatts: {type: 'number', minimum: 0},
        baselineWatts: {type: ['number', 'null'], minimum: 0}
    }
};

export const FLEET_MAP_ENERGY_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['pins', 'asOf'],
    properties: {
        pins: {type: 'array', items: ENERGY_PIN_SCHEMA},
        asOf: {type: 'string', format: 'date-time'}
    }
};

// ── Signal overlay ────────────────────────────────────────────

export interface FleetMapSignalPin {
    locationId: number;
    signalHealth: number;
    deviceCount: number;
}

export interface FleetMapSignalSnapshot {
    pins: FleetMapSignalPin[];
    asOf: string;
}

const SIGNAL_PIN_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['locationId', 'signalHealth', 'deviceCount'],
    properties: {
        locationId: {type: 'integer', minimum: 1},
        signalHealth: {type: 'number', minimum: 0, maximum: 100},
        deviceCount: {type: 'integer', minimum: 0}
    }
};

export const FLEET_MAP_SIGNAL_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['pins', 'asOf'],
    properties: {
        pins: {type: 'array', items: SIGNAL_PIN_SCHEMA},
        asOf: {type: 'string', format: 'date-time'}
    }
};

// ── Alert overlay ─────────────────────────────────────────────

export interface FleetMapAlertPin {
    locationId: number;
    openAlertCount: number;
    topSeverity: AlertSeverity | null;
    oldestActiveSince: string | null;
}

export interface FleetMapAlertSnapshot {
    pins: FleetMapAlertPin[];
    asOf: string;
}

const ALERT_PIN_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'locationId',
        'openAlertCount',
        'topSeverity',
        'oldestActiveSince'
    ],
    properties: {
        locationId: {type: 'integer', minimum: 1},
        openAlertCount: {type: 'integer', minimum: 0},
        topSeverity: {
            type: ['string', 'null'],
            enum: ['critical', 'warning', 'info', null]
        },
        oldestActiveSince: {
            type: ['string', 'null'],
            format: 'date-time'
        }
    }
};

export const FLEET_MAP_ALERT_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['pins', 'asOf'],
    properties: {
        pins: {type: 'array', items: ALERT_PIN_SCHEMA},
        asOf: {type: 'string', format: 'date-time'}
    }
};

export const FLEET_MAP_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'fleetMap',
    {
        kind: 'fleet-manager',
        description:
            'Serve per-location energy, signal, and alert pin snapshots for map overlays.'
    }
)
    .registerMethod('GetEnergySnapshot', {
        params: FLEET_MAP_PARAMS,
        response: FLEET_MAP_ENERGY_RESPONSE,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Per-location live load for the Energy map overlay; baselineWatts is null until a rolling baseline source exists. Cached ~5s.'
    })
    .registerMethod('GetSignalSnapshot', {
        params: FLEET_MAP_PARAMS,
        response: FLEET_MAP_SIGNAL_RESPONSE,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Per-location avg signal health (0..100) + device count for the Signal map overlay.'
    })
    .registerMethod('GetAlertSnapshot', {
        params: FLEET_MAP_PARAMS,
        response: FLEET_MAP_ALERT_RESPONSE,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Per-location open-alert count + top severity + oldest activeSince for the Alert map overlay (heatmap layer).'
    })
    .build();
