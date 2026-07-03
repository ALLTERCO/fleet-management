import {describe, expect, it} from 'vitest';
import {buildTopologyIncidentHints} from '@/helpers/topologyIncidentHints';
import type {TopologyEdge, TopologyNode} from '@/types/topology';

function node(id: string, patch: Partial<TopologyNode> = {}): TopologyNode {
    return {
        id,
        label: id,
        role: 'service',
        cluster: null,
        zone: 'runtime',
        status: 'healthy',
        stats: {},
        route: null,
        description: null,
        virtual: false,
        ...patch
    };
}

function edge(
    from: string,
    to: string,
    patch: Partial<TopologyEdge> = {}
): TopologyEdge {
    return {
        id: `${from}->${to}`,
        from,
        to,
        throughput: 0,
        counterName: null,
        status: 'healthy',
        ...patch
    };
}

describe('buildTopologyIncidentHints', () => {
    it('creates specific auth/security and storage hints from problem nodes', () => {
        const hints = buildTopologyIncidentHints({
            nodes: [
                node('authz', {zone: 'auth_security', status: 'critical'}),
                node('db', {zone: 'storage', status: 'warning'})
            ],
            edges: [],
            bottleneckId: null
        });

        expect(hints[0]).toMatchObject({
            severity: 'critical',
            nodeId: 'authz',
            route: '/monitoring/investigate'
        });
        expect(hints[0].message).toContain('Auth/security');
        expect(hints[1]).toMatchObject({
            severity: 'warning',
            nodeId: 'db',
            route: '/monitoring/resources'
        });
    });

    it('creates edge hints that point to relevant monitoring areas', () => {
        const hints = buildTopologyIncidentHints({
            nodes: [],
            edges: [
                edge('api', 'authz', {
                    kind: 'auth',
                    status: 'critical',
                    description: 'authz runtime unavailable'
                })
            ],
            bottleneckId: null
        });

        expect(hints).toHaveLength(1);
        expect(hints[0]).toMatchObject({
            edgeId: 'api->authz',
            route: '/monitoring/investigate'
        });
        expect(hints[0].evidence).toBe('authz runtime unavailable');
    });

    it('adds a bottleneck hint with metric evidence', () => {
        const hints = buildTopologyIncidentHints({
            nodes: [
                node('statusQueue', {
                    zone: 'device_data_pipeline',
                    stats: {queueSize: 700}
                })
            ],
            edges: [],
            bottleneckId: 'statusQueue'
        });

        expect(hints[0]).toMatchObject({
            severity: 'warning',
            nodeId: 'statusQueue',
            route: '/monitoring/activity'
        });
        expect(hints[0].evidence).toContain('queueSize=700');
    });

    it('redacts secret-looking stats from incident evidence', () => {
        const hints = buildTopologyIncidentHints({
            nodes: [
                node('authz', {
                    zone: 'auth_security',
                    status: 'critical',
                    stats: {
                        token: 'plain-token',
                        password: 'plain-password',
                        queueSize: 4
                    }
                })
            ],
            edges: [],
            bottleneckId: null
        });

        expect(hints[0].evidence).toContain('token=[redacted]');
        expect(hints[0].evidence).toContain('password=[redacted]');
        expect(hints[0].evidence).not.toContain('plain-token');
        expect(hints[0].evidence).not.toContain('plain-password');
    });
});
