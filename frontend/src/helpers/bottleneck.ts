// Pure bottleneck scorer over a topology snapshot + per-edge history.

import type {TopologyEdge, TopologyNode} from '@/types/topology';

export interface BottleneckInput {
    nodes: readonly TopologyNode[];
    edges: readonly TopologyEdge[];
    edgeHistory: ReadonlyMap<string, readonly number[]>;
}

export interface BottleneckThresholds {
    queueDepth: number;
    latencyMs: number;
    errorRate: number;
}

interface ScoringContext {
    edges: readonly TopologyEdge[];
    history: ReadonlyMap<string, readonly number[]>;
    thresholds: BottleneckThresholds;
}

interface PressureProbe {
    keys: readonly string[];
    threshold: number;
    weight: number;
}

const DEFAULT_THRESHOLDS: BottleneckThresholds = {
    queueDepth: 100,
    latencyMs: 500,
    errorRate: 5
};

const SURFACE_THRESHOLD = 50;

const DEPTH_KEYS = [
    'queueSize',
    'pending',
    'queued',
    'queueLength',
    'waitingCount'
] as const;
const LATENCY_KEYS = ['avgMs', 'lastFlushMs', 'latencyMs'] as const;
const ERROR_KEYS = ['errorRate', 'errors'] as const;

const DEPTH_WEIGHT = 100;
const LATENCY_WEIGHT = 50;
const ERROR_WEIGHT = 200;

export function findBottleneck(
    input: BottleneckInput,
    thresholds: BottleneckThresholds = DEFAULT_THRESHOLDS
): string | null {
    const context = buildScoringContext(input, thresholds);
    let bestId: string | null = null;
    let bestScore = SURFACE_THRESHOLD;
    for (const node of input.nodes) {
        const score = scoreNode(node, context);
        if (score <= bestScore) continue;
        bestScore = score;
        bestId = node.id;
    }
    return bestId;
}

function buildScoringContext(
    input: BottleneckInput,
    thresholds: BottleneckThresholds
): ScoringContext {
    return {
        edges: input.edges,
        history: input.edgeHistory,
        thresholds
    };
}

function scoreNode(node: TopologyNode, context: ScoringContext): number {
    let total = queueBuildupScore(node, context);
    for (const probe of probesFor(context.thresholds)) {
        total += pressureFromProbe(node, probe);
    }
    return total;
}

function probesFor(thresholds: BottleneckThresholds): PressureProbe[] {
    return [
        {
            keys: DEPTH_KEYS,
            threshold: thresholds.queueDepth,
            weight: DEPTH_WEIGHT
        },
        {
            keys: LATENCY_KEYS,
            threshold: thresholds.latencyMs,
            weight: LATENCY_WEIGHT
        },
        {
            keys: ERROR_KEYS,
            threshold: thresholds.errorRate,
            weight: ERROR_WEIGHT
        }
    ];
}

function queueBuildupScore(
    node: TopologyNode,
    context: ScoringContext
): number {
    let incoming = 0;
    let outgoing = 0;
    for (const edge of context.edges) {
        const recent = recentThroughput(edge, context.history);
        if (edge.to === node.id) incoming += recent;
        if (edge.from === node.id) outgoing += recent;
    }
    return Math.max(0, incoming - outgoing);
}

function recentThroughput(
    edge: TopologyEdge,
    history: ReadonlyMap<string, readonly number[]>
): number {
    const series = history.get(edge.id);
    if (!series || series.length === 0) return edge.throughput;
    return series[series.length - 1];
}

function pressureFromProbe(node: TopologyNode, probe: PressureProbe): number {
    const value = pickNumber(node.stats, probe.keys);
    if (value === null || probe.threshold <= 0) return 0;
    return (value / probe.threshold) * probe.weight;
}

function pickNumber(
    stats: Record<string, unknown>,
    keys: readonly string[]
): number | null {
    for (const key of keys) {
        const value = stats[key];
        if (typeof value === 'number') return value;
    }
    return null;
}
