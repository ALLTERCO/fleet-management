// Default aggregation per metric. Brush UI does not need to choose; the
// metric implies the only sensible default (consumption sums, gauges avg).

import type {
    AttributeAggregation,
    AttributeMetric
} from '../../types/api/analytics';

const DEFAULTS: Readonly<Record<AttributeMetric, AttributeAggregation>> = {
    consumption: 'sum',
    power: 'avg',
    voltage: 'avg',
    temperature: 'avg'
};

export function resolveDefaultAggregation(
    metric: AttributeMetric
): AttributeAggregation {
    return DEFAULTS[metric];
}

const ALLOWED: Readonly<
    Record<AttributeMetric, ReadonlyArray<AttributeAggregation>>
> = {
    consumption: ['sum', 'max', 'latest'],
    power: ['avg', 'max', 'latest'],
    voltage: ['avg', 'max', 'latest'],
    temperature: ['avg', 'max', 'latest']
};

export function isAggregationAllowedForMetric(
    metric: AttributeMetric,
    aggregation: AttributeAggregation
): boolean {
    return ALLOWED[metric].includes(aggregation);
}
