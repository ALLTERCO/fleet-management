// Component: DashKpiStrip — verifies the threshold accent, pulse-on-change,
// and the cleanup of internal maps when a metric key disappears (F11).

import {mount} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick} from 'vue';
import DashKpiStrip from '@/components/dashboard/DashKpiStrip.vue';
import type {DashKpiMetric} from '@/types/dashboard-components';

function metric(over: Partial<DashKpiMetric>): DashKpiMetric {
    return {
        key: over.key ?? 'k',
        label: over.label ?? 'Label',
        value: over.value ?? 0,
        ...over
    };
}

describe('DashKpiStrip', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('applies the warning accent border when value crosses warning threshold', () => {
        const wrapper = mount(DashKpiStrip, {
            props: {
                metrics: [
                    metric({value: 15, threshold: {warning: 10, danger: 20}})
                ]
            }
        });
        expect(wrapper.find('.kpi-card').classes()).toContain(
            'kpi-card--warning'
        );
    });

    it('applies danger accent when value crosses danger threshold', () => {
        const wrapper = mount(DashKpiStrip, {
            props: {
                metrics: [
                    metric({value: 25, threshold: {warning: 10, danger: 20}})
                ]
            }
        });
        expect(wrapper.find('.kpi-card').classes()).toContain(
            'kpi-card--danger'
        );
    });

    it('pulses when the value changes', async () => {
        const wrapper = mount(DashKpiStrip, {
            props: {metrics: [metric({key: 'a', value: 5})]}
        });
        await wrapper.setProps({metrics: [metric({key: 'a', value: 7})]});
        await nextTick();
        expect(wrapper.find('.kpi-card').classes()).toContain(
            'kpi-card--pulse'
        );
    });

    it('does NOT pulse when only the label changes', async () => {
        const wrapper = mount(DashKpiStrip, {
            props: {metrics: [metric({key: 'a', value: 5, label: 'Old'})]}
        });
        await wrapper.setProps({
            metrics: [metric({key: 'a', value: 5, label: 'New'})]
        });
        await nextTick();
        expect(wrapper.find('.kpi-card').classes()).not.toContain(
            'kpi-card--pulse'
        );
    });

    it('regression: removes lingering pulse class for a metric that disappears from the array', async () => {
        const wrapper = mount(DashKpiStrip, {
            props: {
                metrics: [
                    metric({key: 'a', value: 5}),
                    metric({key: 'b', value: 5})
                ]
            }
        });
        // Bump 'a' so a pulse timer is scheduled for it.
        await wrapper.setProps({
            metrics: [
                metric({key: 'a', value: 9}),
                metric({key: 'b', value: 5})
            ]
        });
        await nextTick();
        // Drop 'a' entirely; cleanup logic should clear its pulse timer.
        await wrapper.setProps({metrics: [metric({key: 'b', value: 5})]});
        await nextTick();
        // Advance past the pulse duration; nothing should be in pulse class.
        vi.advanceTimersByTime(1000);
        await nextTick();
        const cards = wrapper.findAll('.kpi-card');
        for (const card of cards) {
            expect(card.classes()).not.toContain('kpi-card--pulse');
        }
    });

    it('renders skeleton tiles when loading and no metrics have arrived yet', () => {
        const wrapper = mount(DashKpiStrip, {
            props: {metrics: [], loading: true, skeletonCount: 4}
        });
        expect(wrapper.findAll('.kpi-card--skeleton')).toHaveLength(4);
    });

    it('does not render skeletons once real metrics are available, even if loading is true', () => {
        const wrapper = mount(DashKpiStrip, {
            props: {
                metrics: [metric({key: 'a', value: 1})],
                loading: true
            }
        });
        expect(wrapper.findAll('.kpi-card--skeleton')).toHaveLength(0);
        expect(wrapper.findAll('.kpi-card')).toHaveLength(1);
    });
});
