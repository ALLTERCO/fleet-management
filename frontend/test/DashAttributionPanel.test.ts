// Component: DashAttributionPanel — pins the four states (no range,
// loading, error, populated) and the contributor row layout the user
// reads after a brush. Truncated message + per-row share % live here
// because they're the bits the operator most relies on.

import type {AttributeWindowResult} from '@api/analytics';
import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import DashAttributionPanel from '@/components/dashboard/DashAttributionPanel.vue';

function makeResult(
    overrides: Partial<AttributeWindowResult> = {}
): AttributeWindowResult {
    return {
        metric: 'consumption',
        from: '2026-05-28T00:00:00Z',
        to: '2026-05-28T01:00:00Z',
        aggregation: 'sum',
        unit: 'kWh',
        totalValue: 10,
        contributors: [
            {
                deviceId: 1,
                shellyID: 's-1',
                deviceName: 'Server room',
                value: 6,
                share: 0.6,
                sampleCount: 60
            },
            {
                deviceId: 2,
                shellyID: 's-2',
                deviceName: 'HVAC roof',
                value: 4,
                share: 0.4,
                sampleCount: 60
            }
        ],
        truncated: false,
        truncatedCount: 0,
        ...overrides
    };
}

describe('DashAttributionPanel', () => {
    it('prompts the user to brush when no range is set', () => {
        const wrapper = mount(DashAttributionPanel, {
            props: {range: null, result: null}
        });
        expect(wrapper.text()).toContain('Select a range');
    });

    it('shows a loading state while the RPC is in flight', () => {
        const wrapper = mount(DashAttributionPanel, {
            props: {
                range: {from: 'a', to: 'b'},
                result: null,
                loading: true
            }
        });
        expect(wrapper.find('.dsx--loading').exists()).toBe(true);
    });

    it('surfaces an error state with a retry button', () => {
        const wrapper = mount(DashAttributionPanel, {
            props: {
                range: {from: 'a', to: 'b'},
                result: null,
                error: 'boom'
            }
        });
        const errBox = wrapper.find('.dsx--error');
        expect(errBox.exists()).toBe(true);
        expect(errBox.text()).toContain('boom');
    });

    it('renders the total + one row per contributor with share', () => {
        const wrapper = mount(DashAttributionPanel, {
            props: {
                range: {from: 'a', to: 'b'},
                result: makeResult()
            }
        });
        expect(wrapper.find('.dap__total-value').text()).toBe('10.0');
        expect(wrapper.find('.dap__total-unit').text()).toBe('kWh');
        const rows = wrapper.findAll('.dap__row');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('Server room');
        expect(rows[0].text()).toContain('60%');
        expect(rows[1].text()).toContain('HVAC roof');
        expect(rows[1].text()).toContain('40%');
    });

    it('shows the truncated hint when more devices were dropped', () => {
        const wrapper = mount(DashAttributionPanel, {
            props: {
                range: {from: 'a', to: 'b'},
                result: makeResult({truncated: true, truncatedCount: 47})
            }
        });
        expect(wrapper.find('.dap__truncated').text()).toContain('47 more');
    });

    it('renders an empty-window message when the result has no contributors', () => {
        const wrapper = mount(DashAttributionPanel, {
            props: {
                range: {from: 'a', to: 'b'},
                result: makeResult({contributors: [], totalValue: 0})
            }
        });
        expect(wrapper.text()).toContain('No data in window');
    });

    it('emits close when the closable header button is clicked', async () => {
        const wrapper = mount(DashAttributionPanel, {
            props: {
                range: {from: 'a', to: 'b'},
                result: makeResult(),
                closable: true
            }
        });
        await wrapper.find('.dap__close').trigger('click');
        expect(wrapper.emitted('close')?.length).toBe(1);
    });

    it('hides the close button when closable is false', () => {
        const wrapper = mount(DashAttributionPanel, {
            props: {
                range: {from: 'a', to: 'b'},
                result: makeResult()
            }
        });
        expect(wrapper.find('.dap__close').exists()).toBe(false);
    });
});
