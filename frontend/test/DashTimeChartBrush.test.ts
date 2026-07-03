// Component: DashTimeChart brush — verifies the opt-in brush toggle and
// the bucket-range emit path. Tests run with a mocked useEChart so they
// stay headless; the chart event handler is exercised by replaying a
// brushEnd payload with the same shape ECharts emits.

import {mount} from '@vue/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ref} from 'vue';
import DashTimeChart from '@/components/dashboard/DashTimeChart.vue';

type BrushEnd = (params: {areas?: {coordRange?: number[]}[]}) => void;

const mockChart = {
    handlers: new Map<string, BrushEnd>(),
    on(event: string, cb: BrushEnd) {
        this.handlers.set(event, cb);
    },
    dispatchAction: vi.fn()
};

vi.mock('@/composables/useEChart', () => ({
    useEChart: () => ({chart: ref(mockChart)})
}));

vi.mock('@/tools/echarts', () => ({
    default: {
        graphic: {
            LinearGradient: class {}
        },
        use: vi.fn()
    }
}));

describe('DashTimeChart brush', () => {
    beforeEach(() => {
        mockChart.handlers.clear();
        mockChart.dispatchAction.mockClear();
    });

    it('hides the compare toggle when brush is disabled', () => {
        const wrapper = mount(DashTimeChart, {
            props: {data: [{bucket: '00:00', value: 1}]}
        });
        expect(wrapper.find('.dash-chart-brush-toggle').exists()).toBe(false);
    });

    it('renders the compare toggle when brush is enabled', () => {
        const wrapper = mount(DashTimeChart, {
            props: {data: [{bucket: '00:00', value: 1}], brush: true}
        });
        expect(wrapper.find('.dash-chart-brush-toggle').exists()).toBe(true);
        expect(wrapper.find('.dash-chart-brush-toggle').text()).toContain(
            'Compare'
        );
    });

    it('dispatches takeGlobalCursor when toggled on then off', async () => {
        const wrapper = mount(DashTimeChart, {
            props: {data: [{bucket: '00:00', value: 1}], brush: true}
        });
        await wrapper.find('.dash-chart-brush-toggle').trigger('click');
        expect(mockChart.dispatchAction).toHaveBeenLastCalledWith({
            type: 'takeGlobalCursor',
            key: 'brush',
            brushOption: {brushType: 'lineX', brushMode: 'single'}
        });
        await wrapper.find('.dash-chart-brush-toggle').trigger('click');
        expect(mockChart.dispatchAction).toHaveBeenLastCalledWith({
            type: 'takeGlobalCursor',
            key: undefined,
            brushOption: undefined
        });
    });

    it('emits brush-end with bucket strings for the selected range', () => {
        const wrapper = mount(DashTimeChart, {
            props: {
                data: [
                    {bucket: '00:00', value: 1},
                    {bucket: '01:00', value: 2},
                    {bucket: '02:00', value: 3},
                    {bucket: '03:00', value: 4}
                ],
                brush: true
            }
        });
        const handler = mockChart.handlers.get('brushEnd');
        expect(handler).toBeDefined();
        handler?.({areas: [{coordRange: [1, 2.7]}]});
        const events = wrapper.emitted('brush-end');
        expect(events?.length).toBe(1);
        expect(events?.[0]?.[0]).toEqual({from: '01:00', to: '03:00'});
    });

    it('ignores brushEnd payloads without a coordRange', () => {
        const wrapper = mount(DashTimeChart, {
            props: {data: [{bucket: '00:00', value: 1}], brush: true}
        });
        const handler = mockChart.handlers.get('brushEnd');
        handler?.({areas: [{}]});
        handler?.({});
        expect(wrapper.emitted('brush-end')).toBeUndefined();
    });
});
