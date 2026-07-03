// Component: DashStatusDonut — pins the centre-text aggregation (total
// devices = online + offline + sleeping). ECharts itself is mocked since
// the chart is a visual side effect; what we care about is the total
// counter that the user reads at-a-glance and the optional sleeping
// branch.

import {mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';
import DashStatusDonut from '@/components/dashboard/DashStatusDonut.vue';

vi.mock('@/tools/echarts', () => ({
    default: {
        init: () => ({
            setOption: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn()
        })
    }
}));

describe('DashStatusDonut', () => {
    it('sums online + offline into the centre total', () => {
        const wrapper = mount(DashStatusDonut, {
            props: {online: 7, offline: 3}
        });
        expect(wrapper.find('.dsd-center-value').text()).toBe('10');
        expect(wrapper.find('.dsd-center-label').text()).toBe('devices');
    });

    it('includes the sleeping count when provided', () => {
        const wrapper = mount(DashStatusDonut, {
            props: {online: 4, offline: 2, sleeping: 5}
        });
        expect(wrapper.find('.dsd-center-value').text()).toBe('11');
    });

    it('treats missing sleeping as zero', () => {
        const wrapper = mount(DashStatusDonut, {
            props: {online: 0, offline: 0}
        });
        expect(wrapper.find('.dsd-center-value').text()).toBe('0');
    });

    it('renders a circular skeleton + skeleton centre labels while loading — no chart init', () => {
        const wrapper = mount(DashStatusDonut, {
            props: {online: 0, offline: 0, loading: true}
        });
        expect(wrapper.find('.dsd-skeleton').exists()).toBe(true);
        expect(wrapper.find('.dsd-chart').exists()).toBe(false);
        expect(wrapper.find('.dsd-center-value').exists()).toBe(false);
    });
});
