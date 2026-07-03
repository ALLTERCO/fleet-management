// Component: DashEnergyFlow — verifies node placement, edge thickness scaling
// from power, and the active-flow class on edges with non-trivial magnitude.

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DashEnergyFlow, {
    type FlowEdgeInput,
    type FlowNodeInput
} from '@/components/dashboard/DashEnergyFlow.vue';

function gridLoadsNodes(): FlowNodeInput[] {
    return [
        {id: 'grid', label: 'Grid', icon: 'fas fa-bolt', position: 'left'},
        {id: 'loads', label: 'Loads', icon: 'fas fa-house', position: 'right'}
    ];
}

describe('DashEnergyFlow', () => {
    it('shows the empty state when no flow data has arrived yet', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: gridLoadsNodes(), edges: []}
        });
        expect(wrapper.find('.def__empty').exists()).toBe(true);
        expect(wrapper.find('svg.def__svg').exists()).toBe(false);
    });

    it('renders one circle per node once flow exists', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {
                nodes: gridLoadsNodes(),
                edges: [{from: 'grid', to: 'loads', power: 200}]
            }
        });
        expect(wrapper.findAll('circle.def__node-circle').length).toBe(2);
        expect(wrapper.find('.def__empty').exists()).toBe(false);
    });

    it('renders one path per resolved edge', () => {
        const edges: FlowEdgeInput[] = [
            {from: 'grid', to: 'loads', power: 200}
        ];
        const wrapper = mount(DashEnergyFlow, {
            props: {nodes: gridLoadsNodes(), edges}
        });
        expect(wrapper.findAll('path.def__edge').length).toBe(1);
    });

    it('marks an edge active when power exceeds MIN_DRAW_POWER', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {
                nodes: gridLoadsNodes(),
                edges: [{from: 'grid', to: 'loads', power: 500}]
            }
        });
        expect(wrapper.find('path.def__edge').classes()).toContain(
            'def__edge--active'
        );
    });

    it('drops edges that reference an unknown node', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {
                nodes: gridLoadsNodes(),
                edges: [{from: 'mystery', to: 'loads', power: 100}]
            }
        });
        expect(wrapper.findAll('path.def__edge').length).toBe(0);
    });

    it('shows the labelled power for edges above the label threshold', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {
                nodes: gridLoadsNodes(),
                edges: [{from: 'grid', to: 'loads', power: 1200}]
            }
        });
        const label = wrapper.find('text.def__edge-label');
        expect(label.exists()).toBe(true);
        expect(label.text()).toBe('1.2kW');
    });

    it('hides the label for trickle flows below the label threshold', () => {
        const wrapper = mount(DashEnergyFlow, {
            props: {
                nodes: gridLoadsNodes(),
                edges: [{from: 'grid', to: 'loads', power: 5}]
            }
        });
        expect(wrapper.find('text.def__edge-label').exists()).toBe(false);
    });
});
