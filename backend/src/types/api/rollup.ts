// Declarative rollup vocabulary: a parent metric is a formula over child or
// component-instance values, declared on catalog entries (AWS SiteWise pattern).
// Lives in the types layer so the catalog (config) and the evaluator
// (model/report) share one definition without a config -> model import.

import type {SemanticType} from './semantic';

export type RollupExpr =
    | {kind: 'sum'; over: string}
    | {kind: 'avg'; over: string}
    | {kind: 'max'; over: string}
    | {kind: 'min'; over: string}
    | {kind: 'imbalance'; over: string}
    | {kind: 'count'; over: string; nonNull?: boolean}
    | {kind: 'ratio'; numerator: string; denominator: string};

// A parent metric declared on a catalog entry: its name, what it semantically
// is (for formatting), and how it rolls up from children or component instances.
export interface KindMetricDef {
    name: string;
    semantic: SemanticType;
    rollup: RollupExpr;
}
