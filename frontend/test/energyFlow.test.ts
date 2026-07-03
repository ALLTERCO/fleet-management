// 4-tier coverage for the energy-flow visual upgrade.
//   UNIT — particleDuration / curvedEdgePath / id helpers
//   INTEGRATION — DashEnergyFlow emits <defs>, <animateMotion>, gradient refs
//   SYSTEM — full SVG shape on a fixed input
//   REGRESSION — zero-power edges omit particles; missing node drops edge

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DashEnergyFlow, {
    type FlowEdgeInput,
    type FlowNodeInput
} from '@/components/dashboard/DashEnergyFlow.vue';
import {
    curvedEdgePath,
    edgePathId,
    gradientId,
    PARTICLE_DUR_MAX_S,
    PARTICLE_DUR_MIN_S,
    particleDuration
} from '@/helpers/energyFlow';

function nodes(): FlowNodeInput[] {
    return [
        {id: 'grid', label: 'Grid', icon: 'fas fa-bolt', position: 'left'},
        {id: 'loads', label: 'Loads', icon: 'fas fa-house', position: 'right'}
    ];
}

function edge(power: number): FlowEdgeInput {
    return {from: 'grid', to: 'loads', power};
}

// ─── UNIT ───

describe('particleDuration', () => {
    it('returns the MAX duration for zero or negative input', () => {
        expect(particleDuration(0, 100)).toBe(PARTICLE_DUR_MAX_S);
        expect(particleDuration(-10, 100)).toBe(PARTICLE_DUR_MAX_S);
    });
    it('returns the MAX duration when total is zero (no divide-by-zero)', () => {
        expect(particleDuration(50, 0)).toBe(PARTICLE_DUR_MAX_S);
    });
    it('returns the MIN duration when share is 100%', () => {
        expect(particleDuration(100, 100)).toBe(PARTICLE_DUR_MIN_S);
    });
    it('interpolates linearly across the range', () => {
        const half = particleDuration(50, 100);
        expect(half).toBeCloseTo(
            PARTICLE_DUR_MAX_S -
                0.5 * (PARTICLE_DUR_MAX_S - PARTICLE_DUR_MIN_S),
            5
        );
    });
    it('clamps share to 1 even if value > total', () => {
        expect(particleDuration(200, 100)).toBe(PARTICLE_DUR_MIN_S);
    });
});

describe('curvedEdgePath', () => {
    it('emits a cubic Bézier with the correct start and end', () => {
        const d = curvedEdgePath({
            fromX: 10,
            fromY: 20,
            toX: 100,
            toY: 200,
            curvature: 0.2
        });
        expect(d.startsWith('M 10 20 C')).toBe(true);
        expect(d.endsWith(' 100 200')).toBe(true);
    });
    it('degenerates to a single moveTo for zero-length edges', () => {
        expect(curvedEdgePath({fromX: 5, fromY: 5, toX: 5, toY: 5})).toBe(
            'M 5 5'
        );
    });
});

describe('id helpers', () => {
    it('gradientId is stable for the same pair', () => {
        expect(gradientId('grid', 'loads')).toBe(gradientId('grid', 'loads'));
    });
    it('edgePathId encodes both endpoints', () => {
        expect(edgePathId('grid', 'loads')).toContain('grid');
        expect(edgePathId('grid', 'loads')).toContain('loads');
    });
});

// ─── INTEGRATION ───

describe('DashEnergyFlow (defs + animation wiring)', () => {
    it('emits one <linearGradient> in <defs> per resolved edge', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: nodes(), edges: [edge(500)]}
        });
        expect(wrapper.findAll('linearGradient').length).toBe(1);
    });
    it('emits exactly one glow filter regardless of edge count', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {
                nodes: nodes(),
                edges: [edge(500), {from: 'grid', to: 'loads', power: 200}]
            }
        });
        expect(wrapper.findAll('filter#def-glow').length).toBe(1);
    });
    it('emits an <animateMotion> only on active edges', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: nodes(), edges: [edge(500)]}
        });
        expect(wrapper.findAll('animateMotion').length).toBe(1);
    });
    it('animateMotion mpath references the edge path id', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: nodes(), edges: [edge(500)]}
        });
        const mpath = wrapper.find('mpath');
        const expected = `#${edgePathId('grid', 'loads')}`;
        expect(mpath.attributes('href')).toBe(expected);
    });
    it('edge stroke references its gradient via url(#...)', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: nodes(), edges: [edge(500)]}
        });
        const path = wrapper.find('path.def__edge');
        const expected = `url(#${gradientId('grid', 'loads')})`;
        expect(path.attributes('stroke')).toBe(expected);
    });
});

// ─── SYSTEM ───

describe('DashEnergyFlow (system: end-to-end SVG shape)', () => {
    it('renders nodes + edge + gradient + particle for a single live edge', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: nodes(), edges: [edge(800)]}
        });
        expect(wrapper.findAll('circle.def__node-circle').length).toBe(2);
        expect(wrapper.findAll('path.def__edge').length).toBe(1);
        expect(wrapper.findAll('linearGradient').length).toBe(1);
        expect(wrapper.findAll('circle.def__particle').length).toBe(1);
        expect(wrapper.findAll('animateMotion').length).toBe(1);
    });
});

// ─── REGRESSION ───

describe('DashEnergyFlow (regression)', () => {
    it('omits the particle when edge power is below MIN_DRAW_POWER', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: nodes(), edges: [edge(0)]}
        });
        expect(wrapper.findAll('circle.def__particle').length).toBe(0);
        expect(wrapper.findAll('animateMotion').length).toBe(0);
    });
    it('keeps the existing label-threshold behavior intact', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: nodes(), edges: [edge(1200)]}
        });
        expect(wrapper.find('text.def__edge-label').text()).toBe('1.2kW');
    });
    it('drops an edge entirely when one endpoint is unknown', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {
                nodes: nodes(),
                edges: [{from: 'mystery', to: 'loads', power: 500}]
            }
        });
        expect(wrapper.findAll('path.def__edge').length).toBe(0);
        expect(wrapper.findAll('linearGradient').length).toBe(0);
        expect(wrapper.findAll('animateMotion').length).toBe(0);
    });
    it('flags both endpoint nodes as active when their edge is live', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: nodes(), edges: [edge(500)]}
        });
        expect(wrapper.findAll('g.def__node--active').length).toBe(2);
    });
    it('marks a node as a convergence point when 2+ active edges target it', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {
                nodes: [
                    {
                        id: 'grid',
                        label: 'Grid',
                        icon: 'fas fa-bolt',
                        position: 'left'
                    },
                    {
                        id: 'solar',
                        label: 'Solar',
                        icon: 'fas fa-sun',
                        position: 'top'
                    },
                    {
                        id: 'loads',
                        label: 'Loads',
                        icon: 'fas fa-house',
                        position: 'right'
                    }
                ],
                edges: [
                    {from: 'grid', to: 'loads', power: 300},
                    {from: 'solar', to: 'loads', power: 700}
                ]
            }
        });
        expect(wrapper.findAll('g.def__node--converge').length).toBe(1);
    });
    it('does not mark single-inflow nodes as convergence points', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: nodes(), edges: [edge(500)]}
        });
        expect(wrapper.findAll('g.def__node--converge').length).toBe(0);
    });
});
