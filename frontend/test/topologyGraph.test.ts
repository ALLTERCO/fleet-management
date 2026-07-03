// UNIT — pure topology shaping: visibility, zone columns, health rollup,
// primary stat, and the deterministic grid positions.

import {describe, expect, it} from 'vitest';
import {
    connectedNodeIds,
    gridPositions,
    isUnhealthy,
    primaryStat,
    visibleNodeIds,
    zoneColumns,
    zoneStatus
} from '@/helpers/topologyGraph';
import type {
    ModuleStatus,
    TopologyEdge,
    TopologyNode,
    TopologyZone
} from '@/types/topology';

function node(
    id: string,
    overrides: Partial<TopologyNode> = {}
): TopologyNode {
    return {
        id,
        label: id,
        role: 'service',
        cluster: null,
        status: 'healthy',
        stats: {},
        route: null,
        description: null,
        virtual: false,
        ...overrides
    };
}

function edge(from: string, to: string): TopologyEdge {
    return {
        id: `${from}->${to}`,
        from,
        to,
        throughput: 0,
        counterName: null,
        status: 'healthy'
    };
}

const ZONES: TopologyZone[] = [
    {id: 'ingress', label: 'Ingress', description: '', order: 10, collapseByDefault: false},
    {id: 'storage', label: 'Storage', description: '', order: 60, collapseByDefault: false}
];

describe('connectedNodeIds', () => {
    it('collects every endpoint, ignoring isolated nodes', () => {
        const ids = connectedNodeIds([edge('a', 'b'), edge('b', 'c')]);
        expect([...ids].sort()).toEqual(['a', 'b', 'c']);
    });
});

describe('visibleNodeIds', () => {
    const nodes = [node('a'), node('b'), node('lonely')];
    const edges = [edge('a', 'b')];

    it('drops isolated nodes when not filtering', () => {
        const ids = visibleNodeIds({nodes, edges, unhealthyOnly: false});
        expect(ids.has('lonely')).toBe(false);
        expect(ids.has('a')).toBe(true);
    });

    it('keeps problem nodes and their direct neighbours when filtering', () => {
        const withProblem = [node('a', {status: 'critical'}), node('b')];
        const ids = visibleNodeIds({
            nodes: withProblem,
            edges,
            unhealthyOnly: true
        });
        expect(ids.has('a')).toBe(true);
        expect(ids.has('b')).toBe(true); // neighbour pulled in
    });

    it('returns nothing unhealthy when all are healthy', () => {
        const ids = visibleNodeIds({nodes, edges, unhealthyOnly: true});
        expect(ids.size).toBe(0);
    });
});

describe('zoneColumns', () => {
    it('orders columns by zone order and members by node order', () => {
        const nodes = [
            node('db', {zone: 'storage', order: 20}),
            node('cache', {zone: 'storage', order: 10}),
            node('door', {zone: 'ingress', order: 5})
        ];
        const columns = zoneColumns({nodes, zones: ZONES});
        expect(columns.map((c) => c.id)).toEqual(['ingress', 'storage']);
        expect(columns[1].members.map((m) => m.id)).toEqual(['cache', 'db']);
    });

    it('falls back to unclassified for nodes without a zone', () => {
        const columns = zoneColumns({nodes: [node('x')], zones: ZONES});
        expect(columns[0].id).toBe('unclassified');
    });
});

describe('zoneStatus', () => {
    it('rolls up to the most severe member status', () => {
        expect(
            zoneStatus([node('a'), node('b', {status: 'critical'}), node('c', {status: 'warning'})])
        ).toBe('critical');
    });

    it('is unknown for an empty zone', () => {
        expect(zoneStatus([])).toBe('unknown');
    });
});

describe('primaryStat', () => {
    it('returns the first populated counter key', () => {
        expect(primaryStat({other: 1, queueSize: 4})).toBe('queueSize 4');
    });

    it('is empty when no known counter is present', () => {
        expect(primaryStat({nope: 'x'})).toBe('');
    });
});

describe('gridPositions', () => {
    it('places columns by index and centres members vertically', () => {
        const columns = zoneColumns({
            nodes: [
                node('door', {zone: 'ingress'}),
                node('db', {zone: 'storage', order: 1}),
                node('cache', {zone: 'storage', order: 2})
            ],
            zones: ZONES
        });
        const pos = gridPositions(columns, {columnGap: 100, rowGap: 50});
        expect(pos.door).toEqual({x: 0, y: 0}); // single member centred
        expect(pos.db.x).toBe(100); // second column
        expect(pos.db.y).toBe(-25); // two members centred around 0
        expect(pos.cache.y).toBe(25);
    });
});

describe('isUnhealthy', () => {
    it('is true only for warning and critical', () => {
        const cases: Array<[ModuleStatus, boolean]> = [
            ['healthy', false],
            ['unknown', false],
            ['warning', true],
            ['critical', true]
        ];
        for (const [status, expected] of cases) {
            expect(isUnhealthy(status)).toBe(expected);
        }
    });
});
