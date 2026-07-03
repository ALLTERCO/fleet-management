// CB — Circuit Breaker. Pass-through schemas.

import {
    DescribeBuilder,
    type DescribeOutput,
    type MetricDescriptor
} from './_describe';
import {count, sensor} from './_metricBuilders';
import type {JsonSchema} from './_schema';
import {SHELLY_ID_SCHEMA} from './_shared';

const PERM_READ = {component: 'devices', operation: 'read' as const};
const PERM_UPDATE = {component: 'devices', operation: 'update' as const};
const RESP_OPAQUE: JsonSchema = {type: 'object', additionalProperties: true};

export interface CbGetParams {
    shellyID: string;
    id: number;
}

export interface CbSetConfigParams {
    shellyID: string;
    id: number;
    config: Record<string, unknown>;
}

const ID_PROP: JsonSchema = {type: 'integer', minimum: 0};

export const CB_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'id'],
    properties: {shellyID: SHELLY_ID_SCHEMA, id: ID_PROP}
};

export const CB_SET_CONFIG_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['shellyID', 'id', 'config'],
    properties: {
        shellyID: SHELLY_ID_SCHEMA,
        id: ID_PROP,
        config: {type: 'object', additionalProperties: true}
    }
};

const b = new DescribeBuilder('cb', {
    kind: 'device',
    description:
        'Monitor and configure the circuit breaker state, trip cause, and events.'
});
b.registerMethod('GetStatus', {
    params: CB_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Circuit Breaker status — state, trip cause, last events.'
});
b.registerMethod('GetConfig', {
    params: CB_GET_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_READ,
    description: 'Circuit Breaker config.'
});
b.registerMethod('SetConfig', {
    params: CB_SET_CONFIG_PARAMS_SCHEMA,
    response: RESP_OPAQUE,
    permission: PERM_UPDATE,
    description: 'Circuit Breaker SetConfig — opaque pass-through.'
});

const CB_METRICS: MetricDescriptor[] = [
    count('total_cycles'),
    sensor('temperature_tc', '°C', {optional: true}),
    sensor('temperature_tf', '°F', {optional: true})
];

b.setMetrics(CB_METRICS);

export const CB_DESCRIBE: DescribeOutput = b.build();
