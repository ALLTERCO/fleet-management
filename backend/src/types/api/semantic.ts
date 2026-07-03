// The semantic vocabulary: what a metric IS, independent of how it is rendered.
// Lives in the types layer so both the Describe contract (_describe.ts) and the
// report formatters (model/report/semanticTypes.ts) draw the type from one
// place. Formatting behaviour stays out of here — this file is just the names.

export const SEMANTIC_TYPES = [
    'energy',
    'power',
    'voltage',
    'current',
    'frequency',
    'power_factor',
    'temperature',
    'humidity',
    'illuminance',
    'ratio',
    'duration',
    'state',
    'enum',
    'count',
    'currency',
    'area',
    'volume',
    'mass',
    'flow_rate',
    'pressure',
    'co2',
    'percent_pct'
] as const;

export type SemanticType = (typeof SEMANTIC_TYPES)[number];
