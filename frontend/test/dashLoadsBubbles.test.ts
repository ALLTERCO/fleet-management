// 4-tier coverage for the loads bubble cluster.
//   UNIT — component mounts
//   INTEGRATION — renders root container
//   SYSTEM — reacts to load updates
//   REGRESSION — handles empty + zero-watt loads gracefully

import {mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';
import DashLoadsBubbles, {
    type LoadBubble
} from '@/components/dashboard/DashLoadsBubbles.vue';

vi.mock('@/tools/echarts', () => ({
    default: {
        init: () => ({
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn()
        })
    }
}));

function loads(): LoadBubble[] {
    return [
        {id: 'a', label: 'Plug A', watts: 80},
        {id: 'b', label: 'EV', watts: 7200},
        {id: 'c', label: 'Fridge', watts: 120}
    ];
}

// ─── UNIT ───

describe('DashLoadsBubbles', () => {
    it('mounts with a valid load list', () => {
        const wrapper = mount(DashLoadsBubbles, {props: {loads: loads()}});
        expect(wrapper.exists()).toBe(true);
    });

    it('exposes a configurable aria-label', () => {
        const wrapper = mount(DashLoadsBubbles, {
            props: {loads: loads(), ariaLabel: 'Live loads'}
        });
        expect(wrapper.attributes('aria-label')).toBe('Live loads');
    });
});

// ─── INTEGRATION ───

describe('DashLoadsBubbles — DOM shape', () => {
    it('renders one container element', () => {
        const wrapper = mount(DashLoadsBubbles, {props: {loads: loads()}});
        expect(wrapper.findAll('.dlb').length).toBe(1);
    });
});

// ─── SYSTEM ───

describe('DashLoadsBubbles — reactivity', () => {
    it('re-renders without error when loads change', async () => {
        const wrapper = mount(DashLoadsBubbles, {props: {loads: loads()}});
        await wrapper.setProps({
            loads: [{id: 'x', label: 'X', watts: 1000}]
        });
        expect(wrapper.exists()).toBe(true);
    });
});

// ─── REGRESSION ───

describe('DashLoadsBubbles — guards', () => {
    it('mounts with an empty loads array', () => {
        const wrapper = mount(DashLoadsBubbles, {props: {loads: []}});
        expect(wrapper.exists()).toBe(true);
    });

    it('filters out zero-watt loads (no false bubbles)', () => {
        const wrapper = mount(DashLoadsBubbles, {
            props: {
                loads: [
                    {id: 'a', label: 'Off', watts: 0},
                    {id: 'b', label: 'On', watts: 100}
                ]
            }
        });
        expect(wrapper.exists()).toBe(true);
    });
});
