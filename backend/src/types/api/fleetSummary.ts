/** fleetSummary.* — org-wide live energy summary for the dash header. */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {ORG_ID_SCHEMA} from './_shared';

export const FLEET_SUMMARY_GET_ENERGY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        organizationId: ORG_ID_SCHEMA
    }
};

export interface FleetSummaryEnergy {
    liveLoadWatts: number;
    energyTodayWh: number;
    solarTodayWh: number;
    asOf: string;
}

export const FLEET_SUMMARY_GET_ENERGY_RESPONSE: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['liveLoadWatts', 'energyTodayWh', 'solarTodayWh', 'asOf'],
    properties: {
        liveLoadWatts: {type: 'number', minimum: 0},
        energyTodayWh: {type: 'number', minimum: 0},
        solarTodayWh: {type: 'number', minimum: 0},
        asOf: {type: 'string', format: 'date-time'}
    }
};

export const FLEET_SUMMARY_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'fleetSummary',
    {
        kind: 'fleet-manager',
        description:
            'Serve the org-wide live load and cumulative energy summary for the dashboard header.'
    }
)
    .registerMethod('GetEnergy', {
        params: FLEET_SUMMARY_GET_ENERGY_PARAMS,
        response: FLEET_SUMMARY_GET_ENERGY_RESPONSE,
        permission: {component: 'dashboards', operation: 'read'},
        description:
            'Org-wide live load + cumulative energy delivered/generated today. Cached server-side ~5s.'
    })
    .build();
