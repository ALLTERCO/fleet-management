// 4-tier coverage: UNIT scoring, INTEGRATION pick winner,
// SYSTEM realistic graph, REGRESSION below threshold and empty.

import {describe, expect, it} from 'vitest';
import {findBottleneck} from '@/helpers/bottleneck';
import type {TopologyEdge, TopologyNode} from '@/types/topology';

function node(id: string, stats: Record<string, unknown> = {}): TopologyNode {
    return {
        id,
        label: id,
        role: 'transform',
        cluster: null,
        status: 'healthy',
        stats,
        route: null,
        description: null,
        virtual: false
    };
}

function edge(from: string, to: string, throughput = 0): TopologyEdge {
    return {
        id: `${from}->${to}`,
        from,
        to,
        throughput,
        counterName: null,
        status: 'healthy'
    };
}

const NO_HISTORY = new Map<string, readonly number[]>();

// ─── UNIT — single dimension ───

describe('findBottleneck — single-dimension pressure', () => {
    it('queue depth above the threshold surfaces the node', () => {
        const out = findBottleneck({
            nodes: [node('overflow', {queueSize: 5000})],
            edges: [],
            edgeHistory: NO_HISTORY
        });
        expect(out).toBe('overflow');
    });

    it('latency above the threshold surfaces the node', () => {
        const out = findBottleneck({
            nodes: [node('slow', {avgMs: 50_000})],
            edges: [],
            edgeHistory: NO_HISTORY
        });
        expect(out).toBe('slow');
    });
});

// ─── INTEGRATION — competing nodes ───

describe('findBottleneck — picks the highest score', () => {
    it('a saturated queue beats a moderately slow node', () => {
        const out = findBottleneck({
            nodes: [
                node('queue', {queueSize: 5000}),
                node('slow', {avgMs: 600})
            ],
            edges: [],
            edgeHistory: NO_HISTORY
        });
        expect(out).toBe('queue');
    });

    it('queue buildup from incoming > outgoing surfaces the sink', () => {
        const nodes = [node('src'), node('sink')];
        const edges = [edge('src', 'sink', 200)];
        const history = new Map<string, readonly number[]>([
            ['src->sink', [200]]
        ]);
        const out = findBottleneck({nodes, edges, edgeHistory: history});
        expect(out).toBe('sink');
    });
});

// ─── SYSTEM — realistic five-node graph ───

describe('findBottleneck — realistic graph', () => {
    it('a moderately busy linear chain surfaces the queueing node', () => {
        const nodes = [
            node('src'),
            node('queue', {queueSize: 5000}),
            node('proc', {avgMs: 100}),
            node('sink')
        ];
        const edges = [
            edge('src', 'queue'),
            edge('queue', 'proc'),
            edge('proc', 'sink')
        ];
        const out = findBottleneck({nodes, edges, edgeHistory: NO_HISTORY});
        expect(out).toBe('queue');
    });
});

// ─── REGRESSION — guards ───

describe('findBottleneck — guards', () => {
    it('all healthy + below threshold returns null', () => {
        const out = findBottleneck({
            nodes: [node('a'), node('b')],
            edges: [],
            edgeHistory: NO_HISTORY
        });
        expect(out).toBeNull();
    });

    it('empty graph returns null', () => {
        const out = findBottleneck({
            nodes: [],
            edges: [],
            edgeHistory: NO_HISTORY
        });
        expect(out).toBeNull();
    });

    it('missing stats fields contribute nothing to the score', () => {
        // Stats may have keys the bottleneck scorer does not recognise.
        const out = findBottleneck({
            nodes: [node('noisy', {randomKey: 9999})],
            edges: [],
            edgeHistory: NO_HISTORY
        });
        expect(out).toBeNull();
    });
});
