// Declarative rollup math: a parent metric (group total, device-wide peak) is a
// formula over child values, declared on the catalog rather than coded in the
// report engine (AWS SiteWise pattern). This module evaluates one formula. How
// the underlying values are fetched is injected via RollupResolver so the math
// is testable without a database; the PG-backed resolver lives separately.

import type {KindMetricDef, RollupExpr} from '../../types/api/rollup';

export type {KindMetricDef, RollupExpr};

// Resolves an `over`/`numerator`/`denominator` path to its raw values. Nulls are
// kept so aggregators can decide whether to skip or count them.
export interface RollupResolver {
    values(path: string): Promise<Array<number | null>>;
}

function present(values: Array<number | null>): number[] {
    return values.filter((v): v is number => v !== null);
}

function sum(values: number[]): number {
    return values.reduce((acc, v) => acc + v, 0);
}

// Aggregators return null for an empty input so a missing value reads as "no
// data" rather than a misleading zero. Ratio is resolved separately (two paths).
function aggregate(
    expr: Exclude<RollupExpr, {kind: 'ratio'}>,
    raw: Array<number | null>
): number | null {
    switch (expr.kind) {
        case 'count':
            return (expr.nonNull ? present(raw) : raw).length;
        case 'sum':
        case 'avg':
        case 'max':
        case 'min':
        case 'imbalance':
            return reduceNumeric(expr.kind, present(raw));
        default:
            return assertNever(expr);
    }
}

function reduceNumeric(
    kind: 'sum' | 'avg' | 'max' | 'min' | 'imbalance',
    values: number[]
): number | null {
    if (values.length === 0) return null;
    switch (kind) {
        case 'sum':
            return sum(values);
        case 'avg':
            return sum(values) / values.length;
        case 'max':
            return Math.max(...values);
        case 'min':
            return Math.min(...values);
        case 'imbalance':
            return imbalance(values);
    }
}

// Phase imbalance: how far the worst phase strays above the mean, as a ratio.
// Computed on magnitudes so it stays meaningful for signed data (e.g. phases
// that export). Zero when every magnitude is equal; null when they are all
// zero (undefined ratio).
function imbalance(values: number[]): number | null {
    const magnitudes = values.map(Math.abs);
    const mean = sum(magnitudes) / magnitudes.length;
    if (mean === 0) return null;
    return (Math.max(...magnitudes) - mean) / mean;
}

async function evaluateRatio(
    expr: Extract<RollupExpr, {kind: 'ratio'}>,
    resolver: RollupResolver
): Promise<number | null> {
    const denominator = sum(present(await resolver.values(expr.denominator)));
    if (denominator === 0) return null;
    const numerator = sum(present(await resolver.values(expr.numerator)));
    return numerator / denominator;
}

export async function evaluateRollup(
    expr: RollupExpr,
    resolver: RollupResolver
): Promise<number | null> {
    if (expr.kind === 'ratio') return evaluateRatio(expr, resolver);
    return aggregate(expr, await resolver.values(expr.over));
}

function assertNever(value: never): never {
    throw new Error(`Unhandled rollup expression: ${JSON.stringify(value)}`);
}
