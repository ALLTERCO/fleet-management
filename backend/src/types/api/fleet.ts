/** Canonical scope-slice shape — single source of truth for dashboards, energy, reports, fleet.* methods. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

export type ScopeKind = 'group' | 'location' | 'tag' | 'fleet';

/**
 * Per-device summary in a fleet.GetMetrics result. Single source of truth for
 * the shape: the backend aggregator produces it and the frontend consumes it
 * (via @api/fleet), so the two tiers cannot drift. Kept in sync with the
 * fleet.GetMetrics device schema in FLEET_METRICS_RESULT below.
 */
export interface FleetMetricsDevice {
    id: number;
    shellyID: string;
    name: string;
    online: boolean;
    hasEmChannels: boolean;
    hasEm1Channels: boolean;
}

export interface DashboardScope {
    groupId?: number;
    locationId?: number;
    tagId?: number;
}

export const DASHBOARD_SCOPE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    maxProperties: 1,
    properties: {
        groupId: {type: 'integer', minimum: 1},
        locationId: {type: 'integer', minimum: 1},
        tagId: {type: 'integer', minimum: 1}
    }
};

/** Returns which axis is set, or 'fleet' for unscoped (empty / undefined). */
export function scopeKind(scope: DashboardScope | undefined | null): ScopeKind {
    if (!scope) return 'fleet';
    if (typeof scope.groupId === 'number') return 'group';
    if (typeof scope.locationId === 'number') return 'location';
    if (typeof scope.tagId === 'number') return 'tag';
    return 'fleet';
}

/** Returns the id for the active axis, or null for fleet. */
export function scopeId(
    scope: DashboardScope | undefined | null
): number | null {
    if (!scope) return null;
    if (typeof scope.groupId === 'number') return scope.groupId;
    if (typeof scope.locationId === 'number') return scope.locationId;
    if (typeof scope.tagId === 'number') return scope.tagId;
    return null;
}

/** Throws if more than one axis is set. Schema enforces it but TS callers may bypass. */
export function assertSingleAxis(scope: DashboardScope): void {
    const set = [scope.groupId, scope.locationId, scope.tagId].filter(
        (v) => typeof v === 'number'
    );
    if (set.length > 1) {
        throw new Error('DashboardScope must have at most one axis set');
    }
}

// --- fleet.GetMetrics / fleet.GetCapabilities RPC contract --------------

export const FLEET_METRICS_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: {type: 'string', minLength: 1},
        scope: DASHBOARD_SCOPE_SCHEMA
    }
};

export const FLEET_METRICS_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['scopeKind', 'scopeId', 'devices', 'metrics', 'phaseMetrics'],
    additionalProperties: true,
    properties: {
        scopeKind: {
            type: 'string',
            enum: ['group', 'location', 'tag', 'fleet']
        },
        scopeId: {type: ['integer', 'null']},
        devices: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'shellyID',
                    'name',
                    'online',
                    'hasEmChannels',
                    'hasEm1Channels'
                ],
                additionalProperties: false,
                properties: {
                    id: {type: 'integer'},
                    shellyID: {type: 'string', minLength: 1},
                    name: {type: 'string'},
                    online: {type: 'boolean'},
                    hasEmChannels: {type: 'boolean'},
                    hasEm1Channels: {type: 'boolean'}
                }
            }
        },
        metrics: {
            type: 'object',
            additionalProperties: true,
            description:
                'Live-status metric buckets keyed by name: power, voltage, current, consumption, returned_energy, uptime, temperature, humidity, luminance.'
        },
        phaseMetrics: {
            type: ['object', 'null'],
            additionalProperties: true,
            description: 'Three-phase balance summary when available.'
        }
    }
};

export const FLEET_CAPABILITIES_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['scopeKind', 'scopeId', 'capabilities', 'deviceCount'],
    additionalProperties: false,
    properties: {
        scopeKind: {
            type: 'string',
            enum: ['group', 'location', 'tag', 'fleet']
        },
        scopeId: {type: ['integer', 'null']},
        capabilities: {type: 'array', items: {type: 'string'}},
        deviceCount: {type: 'integer', minimum: 0}
    }
};

export const FLEET_DESCRIBE: DescribeOutput = new DescribeBuilder('fleet', {
    kind: 'fleet-manager',
    description:
        'Aggregate live metrics and capabilities for a fleet scope slice.'
})
    .registerMethod('GetMetrics', {
        params: FLEET_METRICS_PARAMS,
        response: FLEET_METRICS_RESPONSE,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Aggregate live in-memory device metrics for a slice (group / location / tag / fleet). No historical DB scan; offline devices skipped.'
    })
    .registerMethod('GetCapabilities', {
        params: FLEET_METRICS_PARAMS,
        response: FLEET_CAPABILITIES_RESPONSE,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Return capability keys derived from the slice devices live entities — device is single source of truth.'
    })
    .build();
