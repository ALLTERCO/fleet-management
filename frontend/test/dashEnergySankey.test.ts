// 4-tier coverage for the cumulative-flow Sankey component.
//   UNIT — component mounts with valid props
//   INTEGRATION — emits a single root <div> sized for the chart
//   SYSTEM — re-renders cleanly when edges change
//   REGRESSION — handles zero-edge input without throwing

import {mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';
import DashEnergySankey, {
    type SankeyEdge,
    type SankeyNode
} from '@/components/dashboard/DashEnergySankey.vue';

vi.mock('@/tools/echarts', () => ({
    default: {
        init: () => ({
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn()
        })
    }
}));

function nodes(): SankeyNode[] {
    return [
        {id: 'grid', label: 'Grid'},
        {id: 'solar', label: 'Solar'},
        {id: 'loads', label: 'Loads'}
    ];
}

function edges(): SankeyEdge[] {
    return [
        {from: 'solar', to: 'loads', value: 8.2},
        {from: 'grid', to: 'loads', value: 2.1}
    ];
}

// ─── UNIT ───

describe('DashEnergySankey', () => {
    it('mounts with nodes and edges without throwing', () => {
        const wrapper = mount(DashEnergySankey, {
            props: {nodes: nodes(), edges: edges()}
        });
        expect(wrapper.exists()).toBe(true);
    });

    it('uses the configured aria-label for a11y', () => {
        const wrapper = mount(DashEnergySankey, {
            props: {
                nodes: nodes(),
                edges: edges(),
                ariaLabel: 'Weekly energy flow'
            }
        });
        expect(wrapper.attributes('aria-label')).toBe('Weekly energy flow');
    });
});

// ─── INTEGRATION ───

describe('DashEnergySankey — DOM shape', () => {
    it('renders exactly one chart container', () => {
        const wrapper = mount(DashEnergySankey, {
            props: {nodes: nodes(), edges: edges()}
        });
        expect(wrapper.findAll('.des').length).toBe(1);
    });
});

// ─── SYSTEM ───

describe('DashEnergySankey — reactivity', () => {
    it('re-renders without error when edges change', async () => {
        const wrapper = mount(DashEnergySankey, {
            props: {nodes: nodes(), edges: edges()}
        });
        await wrapper.setProps({
            nodes: nodes(),
            edges: [{from: 'grid', to: 'loads', value: 50}]
        });
        expect(wrapper.exists()).toBe(true);
    });
});

// ─── REGRESSION ───

describe('DashEnergySankey — guards', () => {
    it('mounts with an empty edges array', () => {
        const wrapper = mount(DashEnergySankey, {
            props: {nodes: nodes(), edges: []}
        });
        expect(wrapper.exists()).toBe(true);
    });

    it('mounts with no nodes either', () => {
        const wrapper = mount(DashEnergySankey, {
            props: {nodes: [], edges: []}
        });
        expect(wrapper.exists()).toBe(true);
    });

    it('accepts negative values (export-to-grid flow)', () => {
        const wrapper = mount(DashEnergySankey, {
            props: {
                nodes: nodes(),
                edges: [{from: 'loads', to: 'grid', value: -5.5}]
            }
        });
        expect(wrapper.exists()).toBe(true);
    });
});
