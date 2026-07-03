// Component: DashFleetSummary — pins the on/off arithmetic, the groups
// conditional row, the device-type label dictionary, and the cost
// formatter. It's the at-a-glance panel on Control so a math regression
// would mislead the operator on whether the fleet is healthy.

import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DashFleetSummary from '@/components/dashboard/DashFleetSummary.vue';

describe('DashFleetSummary', () => {
    it('renders the on/off device row', () => {
        const wrapper = mount(DashFleetSummary, {
            props: {
                totalDevices: 10,
                onlineDevices: 7,
                groups: 0,
                devicesByType: {}
            }
        });
        const rows = wrapper.findAll('.dfs-row');
        expect(rows[0].text()).toContain('7 on');
        expect(rows[0].text()).toContain('3 off');
    });

    it('hides the groups row when no groups exist', () => {
        const wrapper = mount(DashFleetSummary, {
            props: {
                totalDevices: 5,
                onlineDevices: 5,
                groups: 0,
                devicesByType: {}
            }
        });
        expect(wrapper.text()).not.toContain('groups');
    });

    it('renders one row per device type with friendly labels', () => {
        const wrapper = mount(DashFleetSummary, {
            props: {
                totalDevices: 8,
                onlineDevices: 8,
                groups: 1,
                devicesByType: {'3ph_em': 2, switch: 6}
            }
        });
        const text = wrapper.text();
        expect(text).toContain('3-phase EM');
        expect(text).toContain('Switches');
    });

    it('falls back to raw type key when label is missing', () => {
        const wrapper = mount(DashFleetSummary, {
            props: {
                totalDevices: 1,
                onlineDevices: 1,
                groups: 0,
                devicesByType: {unknown_thing: 1}
            }
        });
        expect(wrapper.text()).toContain('unknown_thing');
    });

    it('formats cost with the provided currency symbol', () => {
        const wrapper = mount(DashFleetSummary, {
            props: {
                totalDevices: 1,
                onlineDevices: 1,
                groups: 0,
                devicesByType: {},
                avgCostPerDay: 12.5,
                currencySymbol: '$'
            }
        });
        expect(wrapper.text()).toContain('$12.50');
    });

    it('falls back to the euro symbol when no currency is provided', () => {
        const wrapper = mount(DashFleetSummary, {
            props: {
                totalDevices: 1,
                onlineDevices: 1,
                groups: 0,
                devicesByType: {},
                avgCostPerDay: 7
            }
        });
        expect(wrapper.text()).toContain('€7.00');
    });

    it('shows the skeleton placeholder when loading', () => {
        const wrapper = mount(DashFleetSummary, {
            props: {
                totalDevices: 0,
                onlineDevices: 0,
                groups: 0,
                devicesByType: {},
                loading: true
            }
        });
        expect(wrapper.find('.dfs-skeleton').exists()).toBe(true);
        expect(wrapper.find('.dfs-row').exists()).toBe(false);
    });
});
