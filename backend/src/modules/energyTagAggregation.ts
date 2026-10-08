// SQL copy: device_em.fn_stats_tag_aggregation; an integration test keeps them equal.

import {DELTA_TAGS} from './energyClassifier';

export type StatsTagAggregation = 'sum' | 'min' | 'max' | 'mean';

// Energies only an EM meter record carries; never captured live, so not deltas.
export const STATS_RECORD_ENERGY_TAGS: ReadonlySet<string> = new Set([
    'fund_act_energy',
    'fund_act_ret_energy',
    'lag_react_energy',
    'lead_react_energy'
]);

const STATS_SUM_TAGS: ReadonlySet<string> = new Set([
    ...DELTA_TAGS,
    ...STATS_RECORD_ENERGY_TAGS
]);

export const STATS_MIN_TAGS: ReadonlySet<string> = new Set([
    'min_voltage',
    'min_current',
    'min_power',
    'min_apparent_power',
    'min_neutral_current'
]);

export const STATS_MAX_TAGS: ReadonlySet<string> = new Set([
    'max_voltage',
    'max_current',
    'max_power',
    'max_apparent_power',
    'max_neutral_current'
]);

export function statsTagAggregation(tag: string): StatsTagAggregation {
    if (STATS_SUM_TAGS.has(tag)) return 'sum';
    if (STATS_MIN_TAGS.has(tag)) return 'min';
    if (STATS_MAX_TAGS.has(tag)) return 'max';
    return 'mean';
}

export interface TagAggregationSql {
    /** Column holding the tag, e.g. `s.tag`. */
    tag: string;
    sum: string;
    min: string;
    max: string;
    mean: string;
}

function tagListSql(tags: Iterable<string>): string {
    return [...tags].map((tag) => `'${tag}'`).join(',');
}

/** One CASE choosing each tag's aggregate. Tag names are code constants. */
export function tagAggregationCaseSql(input: TagAggregationSql): string {
    return (
        `CASE WHEN ${input.tag} IN (${tagListSql(STATS_SUM_TAGS)}) THEN ${input.sum} ` +
        `WHEN ${input.tag} IN (${tagListSql(STATS_MIN_TAGS)}) THEN ${input.min} ` +
        `WHEN ${input.tag} IN (${tagListSql(STATS_MAX_TAGS)}) THEN ${input.max} ` +
        `ELSE ${input.mean} END`
    );
}
