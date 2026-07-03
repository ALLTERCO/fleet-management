// Phase 7: composite rule evaluator.
//
// Combines the outputs of other evaluators with AND / OR / NOT and
// optional sliding-window (within N seconds). The engine resolves
// child references to MatchResult-like leaves and hands the tree here
// for a deterministic boolean roll-up.

import {fingerprintV2} from '../fingerprint';
import type {Evaluator, MatchResult} from '../types';

export type CompositeOp = 'and' | 'or' | 'not';

export interface CompositeChildLeaf {
    kind: 'leaf';
    id: string;
    matched: boolean;
    matchedAtMs?: number;
}

export interface CompositeChildNode {
    kind: 'node';
    op: CompositeOp;
    children: CompositeChild[];
    /**
     * For AND only: only count children that matched within the last
     * `windowSeconds`. Older matches are treated as not-matched.
     */
    windowSeconds?: number;
}

export type CompositeChild = CompositeChildLeaf | CompositeChildNode;

export interface CompositeEvaluation {
    matched: boolean;
    matchedLeafIds: string[];
    explanation: string;
}

export function evaluateComposite(
    node: CompositeChildNode,
    nowMs: number
): CompositeEvaluation {
    const matchedLeafIds: string[] = [];
    const matched = evalNode(node, nowMs, matchedLeafIds);
    return {
        matched,
        matchedLeafIds,
        explanation: explain(node)
    };
}

function evalNode(
    node: CompositeChildNode,
    nowMs: number,
    bag: string[]
): boolean {
    switch (node.op) {
        case 'and':
            return evalAnd(node, nowMs, bag);
        case 'or':
            return evalOr(node, nowMs, bag);
        case 'not':
            return evalNot(node, nowMs, bag);
    }
}

function evalAnd(
    node: CompositeChildNode,
    nowMs: number,
    bag: string[]
): boolean {
    if (node.children.length === 0) return false;
    for (const child of node.children) {
        if (!matchWithWindow(child, nowMs, node.windowSeconds, bag)) {
            return false;
        }
    }
    return true;
}

function evalOr(
    node: CompositeChildNode,
    nowMs: number,
    bag: string[]
): boolean {
    for (const child of node.children) {
        if (matchChild(child, nowMs, bag)) return true;
    }
    return false;
}

function evalNot(
    node: CompositeChildNode,
    nowMs: number,
    _bag: string[]
): boolean {
    if (node.children.length !== 1) {
        throw new Error('composite NOT must have exactly one child');
    }
    const local: string[] = [];
    const inner = matchChild(node.children[0], nowMs, local);
    return !inner;
}

function matchChild(
    child: CompositeChild,
    nowMs: number,
    bag: string[]
): boolean {
    if (child.kind === 'leaf') {
        if (child.matched) bag.push(child.id);
        return child.matched;
    }
    return evalNode(child, nowMs, bag);
}

function matchWithWindow(
    child: CompositeChild,
    nowMs: number,
    windowSeconds: number | undefined,
    bag: string[]
): boolean {
    if (child.kind === 'leaf' && windowSeconds && child.matched) {
        if (child.matchedAtMs === undefined) {
            bag.push(child.id);
            return true;
        }
        const age = nowMs - child.matchedAtMs;
        const inWindow = age >= 0 && age <= windowSeconds * 1000;
        if (inWindow) bag.push(child.id);
        return inWindow;
    }
    return matchChild(child, nowMs, bag);
}

function explain(node: CompositeChildNode): string {
    const parts = node.children.map(explainChild);
    if (node.op === 'not') return `NOT(${parts[0] ?? ''})`;
    const sep = node.op === 'and' ? ' AND ' : ' OR ';
    const win =
        node.op === 'and' && node.windowSeconds
            ? ` within ${node.windowSeconds}s`
            : '';
    return `(${parts.join(sep)})${win}`;
}

function explainChild(child: CompositeChild): string {
    if (child.kind === 'leaf') return child.id;
    return explain(child);
}

// Engine hook. Composite rules don't match a raw event — the engine
// sweep resolves child leaf states and synthesises the match.
const KIND = 'composite';

export const compositeEvaluator: Evaluator = {
    triggerKinds: ['device_status_changed'],
    clearKinds: ['device_status_changed'],
    match(_event, _rule): MatchResult | null {
        // Cross-rule lookups require IO; the engine calls evaluateCompositeMatch
        // directly from its async dispatch loop (see AlertEngine handlers).
        return null;
    },
    matchClear(event, rule) {
        if (rule.kind !== KIND) return null;
        if (event.kind !== 'device_status_changed') return null;
        // Engine fires composite with subjectType 'device' + shellyID.
        return {
            fingerprintV2: fingerprintV2({
                ruleId: rule.id,
                subjectType: 'device',
                subjectId: event.shellyID,
                discriminator: ':composite'
            })
        };
    }
};

// Schema-side leaf shape (alert.ts COMPOSITE_CHILD_SCHEMA uses ruleId).
interface SchemaLeaf {
    kind: 'leaf';
    ruleId: number;
}
interface SchemaNode {
    kind: 'node';
    op: CompositeOp;
    children: ReadonlyArray<SchemaLeaf | SchemaNode>;
    windowSeconds?: number;
}
type SchemaChild = SchemaLeaf | SchemaNode;

function isSchemaNode(x: unknown): x is SchemaNode {
    return (
        !!x &&
        typeof x === 'object' &&
        (x as SchemaChild).kind === 'node' &&
        Array.isArray((x as SchemaNode).children)
    );
}

function isSchemaLeaf(x: unknown): x is SchemaLeaf {
    return (
        !!x &&
        typeof x === 'object' &&
        (x as SchemaChild).kind === 'leaf' &&
        typeof (x as SchemaLeaf).ruleId === 'number'
    );
}

export function collectLeafRuleIds(node: SchemaNode): number[] {
    const out: number[] = [];
    const walk = (c: SchemaChild): void => {
        if (isSchemaLeaf(c)) out.push(c.ruleId);
        else if (isSchemaNode(c)) for (const k of c.children) walk(k);
    };
    walk(node);
    return Array.from(new Set(out));
}

export interface LeafState {
    ruleId: number;
    activeSinceMs: number;
}

export function hydrateTree(
    node: SchemaNode,
    states: ReadonlyMap<number, LeafState>
): CompositeChildNode {
    return {
        kind: 'node',
        op: node.op,
        windowSeconds: node.windowSeconds,
        children: node.children.map((c) => hydrateChild(c, states))
    };
}

function hydrateChild(
    c: SchemaChild,
    states: ReadonlyMap<number, LeafState>
): CompositeChild {
    if (isSchemaLeaf(c)) {
        const s = states.get(c.ruleId);
        return {
            kind: 'leaf',
            id: String(c.ruleId),
            matched: !!s,
            matchedAtMs: s?.activeSinceMs
        };
    }
    return hydrateTree(c, states);
}

const MAX_TREE_DEPTH = 16;

// Iterative walk — recursive depth check would itself overflow before
// the cap fires on a malicious deeply-nested tree.
function exceedsMaxDepth(root: SchemaChild, maxDepth: number): boolean {
    const stack: Array<{node: SchemaChild; depth: number}> = [
        {node: root, depth: 1}
    ];
    while (stack.length > 0) {
        const frame = stack.pop();
        if (!frame) break;
        if (frame.depth > maxDepth) return true;
        if (!isSchemaNode(frame.node)) continue;
        for (const c of frame.node.children) {
            stack.push({node: c, depth: frame.depth + 1});
        }
    }
    return false;
}

export function readCompositeTree(
    cfg: Record<string, unknown>
): SchemaNode | null {
    const tree = cfg.tree;
    if (!isSchemaNode(tree)) return null;
    if (exceedsMaxDepth(tree, MAX_TREE_DEPTH)) return null;
    return tree;
}

export function synthesizeCompositeHit(input: {
    ruleId: number;
    ruleName: string;
    subjectType: 'device' | 'entity' | 'group' | 'location' | 'tag';
    subjectId: string;
    evaluation: CompositeEvaluation;
}): MatchResult {
    return {
        fingerprintV2: fingerprintV2({
            ruleId: input.ruleId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            discriminator: ':composite'
        }),
        title: `${input.ruleName} composite condition matched`,
        message:
            `Composite expression ${input.evaluation.explanation} matched. ` +
            `Leaves: ${input.evaluation.matchedLeafIds.join(', ')}.`,
        subject: {type: input.subjectType, id: input.subjectId},
        context: {
            ruleId: input.ruleId,
            matchedLeafIds: input.evaluation.matchedLeafIds,
            explanation: input.evaluation.explanation
        }
    };
}
