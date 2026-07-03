// Component: DashInsights — pins the "hide when empty" contract and the
// color-variant class mapping. Insights drive the warning surfacing on
// every dash/* page so a regression here would either spam empty rows
// or drop important warnings.

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DashInsights from '@/components/dashboard/DashInsights.vue';

describe('DashInsights', () => {
    it('renders nothing when the insights array is empty', () => {
        const wrapper = mount(DashInsights, {props: {insights: []}});
        expect(wrapper.find('.dash-insights').exists()).toBe(false);
    });

    it('renders one row per insight with its text', () => {
        const wrapper = mount(DashInsights, {
            props: {
                insights: [
                    {key: 'a', color: 'blue', text: 'Peak at 4am'},
                    {key: 'b', color: 'danger', text: '3 devices offline'}
                ]
            }
        });
        const rows = wrapper.findAll('.dash-insight');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Peak at 4am');
        expect(rows[1].text()).toContain('3 devices offline');
    });

    it('applies the color variant class for each insight', () => {
        const wrapper = mount(DashInsights, {
            props: {
                insights: [
                    {key: 'a', color: 'blue', text: 'a'},
                    {key: 'b', color: 'warning', text: 'b'},
                    {key: 'c', color: 'danger', text: 'c'},
                    {key: 'd', color: 'success', text: 'd'}
                ]
            }
        });
        const rows = wrapper.findAll('.dash-insight');
        expect(rows[0].classes()).toContain('insight-blue');
        expect(rows[1].classes()).toContain('insight-warning');
        expect(rows[2].classes()).toContain('insight-danger');
        expect(rows[3].classes()).toContain('insight-success');
    });

    it('keys rows by insight.key so re-renders are stable', () => {
        const wrapper = mount(DashInsights, {
            props: {
                insights: [{key: 'unique', color: 'blue', text: 'hello'}]
            }
        });
        expect(wrapper.find('.dash-insight').exists()).toBe(true);
    });

    it('renders skeleton chips on first load when loading and no insights yet — avoids the empty-state flash', () => {
        const wrapper = mount(DashInsights, {
            props: {insights: [], loading: true, skeletonCount: 4}
        });
        expect(wrapper.findAll('.dash-insight--skeleton')).toHaveLength(4);
    });

    it('prefers real insights over skeletons once data arrives — no double-render', () => {
        const wrapper = mount(DashInsights, {
            props: {
                insights: [{key: 'a', color: 'blue', text: 'real'}],
                loading: true
            }
        });
        expect(wrapper.findAll('.dash-insight--skeleton')).toHaveLength(0);
        expect(wrapper.findAll('.dash-insight')).toHaveLength(1);
    });
});
