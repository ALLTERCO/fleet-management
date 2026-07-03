// Resolves rollup `over` paths against an in-memory context, and evaluates a
// catalog metric with a null-result counter. The context (children + self
// component instances) is built by the report engine from real devices/groups;
// time-windowed PG aggregation is layered on there. This module is the bridge
// between the pure evaluator and that context, kept DB-free so it is testable.

import {incrementLabeledCounter} from '../../modules/Observability';
import type {KindMetricDef} from '../../types/api/rollup';
import {evaluateRollup, type RollupResolver} from './rollupEvaluator';

type Record_ = Record<string, unknown>;

export interface RollupContext {
    children?: ReadonlyArray<Record_>;
    // Component instances on the rollup target, keyed by component type (e.g.
    // 'em' -> [{id:0,...}, {id:1,...}]). Drives `self.components.<type>:*`.
    selfComponents?: ReadonlyMap<string, ReadonlyArray<Record_>>;
}

const SELF_COMPONENTS =
    /^self\.components\.([a-z][a-z0-9_]*):(\*|\d+)\.([a-z][a-z0-9_]*)$/;

// Walks a dotted path to a leaf and coerces it to a finite number, accepting a
// numeric string (device/group JSON often serializes numbers as strings).
// Anything non-numeric, blank, or non-finite yields null.
function numericAt(source: Record_, path: string): number | null {
    let cursor: unknown = source;
    for (const key of path.split('.')) {
        if (cursor === null || typeof cursor !== 'object') return null;
        cursor = (cursor as Record_)[key];
    }
    if (typeof cursor === 'number') {
        return Number.isFinite(cursor) ? cursor : null;
    }
    if (typeof cursor === 'string' && cursor.trim() !== '') {
        const parsed = Number(cursor);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function childValues(
    context: RollupContext,
    field: string
): Array<number | null> {
    return (context.children ?? []).map((child) => numericAt(child, field));
}

function selfComponentValues(
    context: RollupContext,
    type: string,
    selector: string,
    metric: string
): Array<number | null> {
    const instances = context.selfComponents?.get(type) ?? [];
    // Compare ids as strings so a numeric or string instance id both match.
    const matched =
        selector === '*'
            ? instances
            : instances.filter((i) => String(i.id) === selector);
    return matched.map((instance) => numericAt(instance, metric));
}

function resolvePath(
    context: RollupContext,
    path: string
): Array<number | null> {
    if (path === 'children') return (context.children ?? []).map(() => 1);
    if (path.startsWith('children.')) {
        return childValues(context, path.slice('children.'.length));
    }
    const component = SELF_COMPONENTS.exec(path);
    if (component) {
        return selfComponentValues(
            context,
            component[1],
            component[2],
            component[3]
        );
    }
    // A path matching no shape is a catalog mistake, not a data gap — flag it on
    // its own counter so it is distinguishable from a legitimate empty rollup.
    incrementLabeledCounter('rollup_path_unresolved', {path});
    return [];
}

export function createRollupResolver(context: RollupContext): RollupResolver {
    return {values: async (path) => resolvePath(context, path)};
}

export interface KindMetricRef {
    kindId: string;
    metric: KindMetricDef;
}

// Evaluates one catalog metric and records a null result, which flags either a
// data gap or a mis-tuned rollup so it shows up in metrics rather than silently.
export async function evaluateKindMetric(
    ref: KindMetricRef,
    resolver: RollupResolver
): Promise<number | null> {
    const value = await evaluateRollup(ref.metric.rollup, resolver);
    if (value === null) {
        incrementLabeledCounter('rollup_eval_null', {
            kind: ref.kindId,
            metric: ref.metric.name
        });
    }
    return value;
}
