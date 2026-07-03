// Component: DashFleetPulse — verifies the count, the stale state, and that
// the sparkline only renders with enough history points.

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DashFleetPulse from '@/components/dashboard/DashFleetPulse.vue';

describe('DashFleetPulse', () => {
    it('shows the current online count', () => {
        const wrapper = mount(DashFleetPulse, {
            props: {currentCount: 7, history: []}
        });
        expect(wrapper.find('.dfp__count').text()).toBe('7');
    });

    it('does not render a sparkline with fewer than two points', () => {
        const wrapper = mount(DashFleetPulse, {
            props: {currentCount: 7, history: [{bucket: 't', value: 7}]}
        });
        expect(wrapper.find('svg').exists()).toBe(false);
    });

    it('renders a sparkline once enough history is collected', () => {
        const wrapper = mount(DashFleetPulse, {
            props: {
                currentCount: 7,
                history: [
                    {bucket: 't0', value: 5},
                    {bucket: 't1', value: 6},
                    {bucket: 't2', value: 7}
                ]
            }
        });
        expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('applies the stale class when the stale prop is true', () => {
        const wrapper = mount(DashFleetPulse, {
            props: {currentCount: 0, history: [], stale: true}
        });
        expect(wrapper.classes()).toContain('dfp--stale');
    });

    it('reports the min/max in the tooltip when history is present', () => {
        const wrapper = mount(DashFleetPulse, {
            props: {
                currentCount: 7,
                history: [
                    {bucket: 't0', value: 3},
                    {bucket: 't1', value: 9},
                    {bucket: 't2', value: 7}
                ]
            }
        });
        const title = wrapper.attributes('title') ?? '';
        expect(title).toContain('3');
        expect(title).toContain('9');
    });
});
