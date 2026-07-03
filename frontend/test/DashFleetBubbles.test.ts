// Component: DashFleetBubbles — verifies the overflow notice, status-class
// mapping, empty state, and click → select emit.

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DashFleetBubbles from '@/components/dashboard/DashFleetBubbles.vue';
import type {DashFleetBubbleDevice} from '@/types/dashboard-components';

function device(over: Partial<DashFleetBubbleDevice>): DashFleetBubbleDevice {
    return {
        id: over.id ?? 1,
        name: over.name ?? 'd',
        metric: over.metric ?? 0,
        status: over.status ?? 'online'
    };
}

describe('DashFleetBubbles', () => {
    it('renders the empty notice when devices is empty', () => {
        const wrapper = mount(DashFleetBubbles, {props: {devices: []}});
        expect(wrapper.find('.dfb__empty').exists()).toBe(true);
        expect(wrapper.find('svg').exists()).toBe(false);
    });

    it('renders one group per device with the matching status class', () => {
        const wrapper = mount(DashFleetBubbles, {
            props: {
                devices: [
                    device({id: 1, status: 'online'}),
                    device({id: 2, status: 'alarm'}),
                    device({id: 3, status: 'offline'})
                ]
            }
        });
        const groups = wrapper.findAll('g.dfb__group');
        expect(groups.length).toBe(3);
        expect(groups[0].classes()).toContain('dfb__group--online');
        expect(groups[1].classes()).toContain('dfb__group--alarm');
        expect(groups[2].classes()).toContain('dfb__group--offline');
    });

    it('shows the overflow banner when device count exceeds maxBubbles', () => {
        const many = Array.from({length: 30}, (_, i) =>
            device({id: i + 1, metric: i})
        );
        const wrapper = mount(DashFleetBubbles, {
            props: {devices: many, maxBubbles: 10}
        });
        expect(wrapper.find('.dfb__overflow').exists()).toBe(true);
        expect(wrapper.find('.dfb__overflow').text()).toContain('30 devices');
    });

    it('truncates to the top N by metric when overflowing', () => {
        const many = Array.from({length: 30}, (_, i) =>
            device({id: i + 1, metric: i})
        );
        const wrapper = mount(DashFleetBubbles, {
            props: {devices: many, maxBubbles: 10}
        });
        expect(wrapper.findAll('g.dfb__group').length).toBe(10);
    });

    it('emits select with the device id on click', async () => {
        const wrapper = mount(DashFleetBubbles, {
            props: {devices: [device({id: 42, metric: 5})]}
        });
        await wrapper.find('g.dfb__group').trigger('click');
        const emitted = wrapper.emitted('select');
        expect(emitted).toBeTruthy();
        expect(emitted?.[0]).toEqual([42]);
    });

    it('renders the legend with all three status dots when bubbles are visible', () => {
        const wrapper = mount(DashFleetBubbles, {
            props: {devices: [device({id: 1})]}
        });
        expect(wrapper.find('.dfb__legend-dot--online').exists()).toBe(true);
        expect(wrapper.find('.dfb__legend-dot--alarm').exists()).toBe(true);
        expect(wrapper.find('.dfb__legend-dot--offline').exists()).toBe(true);
    });
});
