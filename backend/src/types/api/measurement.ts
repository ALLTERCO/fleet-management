// IEC 61850 signal metadata — the vocabulary Schneider / Siemens / Eaton
// all converge on. AC/DC is implicit in logicalNode (MMXU = AC, MMDC = DC),
// no separate field needed.

import type {JsonSchema} from './_schema';

export const LOGICAL_NODES = [
    'MMXU', // 3-phase instantaneous AC
    'MMTR', // 3-phase cumulative metering
    'MMXN', // single-phase / non-phase
    'MMDC', // DC measurement
    'MSQI', // sequence / imbalance
    'MHAI' // harmonics
] as const;

export type LogicalNode = (typeof LOGICAL_NODES)[number];

export const ACCUMULATIONS = ['instant', 'cumulative', 'delta'] as const;
export type Accumulation = (typeof ACCUMULATIONS)[number];

export const DIRECTIONS = ['import', 'export', 'net'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const PHASES = ['A', 'B', 'C', 'N', 'total'] as const;
export type Phase = (typeof PHASES)[number];

export interface MeasurementMeta {
    logicalNode?: LogicalNode;
    /** IEC 61850 Data Object: TotW, TotVAr, Hz, PhV, A, Wh, SupWh, DmdWh, ... */
    dataObject?: string;
    phase?: Phase;
    accumulation?: Accumulation;
    /** SI unit string: W, VAr, Wh, V, A, Hz, etc. */
    unit?: string;
    direction?: Direction;
}

export const MEASUREMENT_META_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        logicalNode: {type: 'string', enum: [...LOGICAL_NODES]},
        dataObject: {type: 'string', minLength: 1, maxLength: 40},
        phase: {type: 'string', enum: [...PHASES]},
        accumulation: {type: 'string', enum: [...ACCUMULATIONS]},
        unit: {type: 'string', minLength: 1, maxLength: 16},
        direction: {type: 'string', enum: [...DIRECTIONS]}
    }
};
