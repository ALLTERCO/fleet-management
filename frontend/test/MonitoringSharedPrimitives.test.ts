import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import MonitoringEmptyState from '@/components/monitoring/MonitoringEmptyState.vue';
import MonitoringGrid from '@/components/monitoring/MonitoringGrid.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import MonitoringStatusSummaryRow from '@/components/monitoring/MonitoringStatusSummaryRow.vue';

describe('MonitoringEmptyState', () => {
    it('renders title, description, action, and emits action', async () => {
        const wrapper = mount(MonitoringEmptyState, {
            props: {
                title: 'Enable monitoring',
                description: 'Light mode is enough.',
                actionLabel: 'Enable Light Monitoring',
                icon: 'fas fa-chart-line'
            }
        });

        expect(wrapper.text()).toContain('Enable monitoring');
        expect(wrapper.text()).toContain('Light mode is enough.');
        await wrapper.get('button').trigger('click');
        expect(wrapper.emitted('action')).toHaveLength(1);
    });

    it('shows loading state without requiring an action', () => {
        const wrapper = mount(MonitoringEmptyState, {
            props: {
                title: 'Waiting for metrics data...',
                loading: true
            }
        });

        expect(wrapper.text()).toContain('Waiting for metrics data...');
        expect(wrapper.find('button').exists()).toBe(false);
    });
});

describe('MonitoringStatusSummaryRow', () => {
    it('renders status, title, description, and slot content', () => {
        const wrapper = mount(MonitoringStatusSummaryRow, {
            props: {
                status: 'warning',
                title: 'Connection Pool',
                description: 'DB pool pressure'
            },
            slots: {
                default: '<span class="extra">extra metric</span>'
            }
        });

        expect(wrapper.text()).toContain('Connection Pool');
        expect(wrapper.text()).toContain('DB pool pressure');
        expect(wrapper.find('.extra').text()).toBe('extra metric');
    });
});

describe('MonitoringSectionHeader', () => {
    it('renders title, description, status dot, and action slot', () => {
        const wrapper = mount(MonitoringSectionHeader, {
            props: {
                title: 'Resource Health',
                description: 'Host and DB pressure',
                status: 'warning'
            },
            slots: {
                actions: '<button class="refresh">Refresh</button>'
            }
        });

        expect(wrapper.text()).toContain('Resource Health');
        expect(wrapper.text()).toContain('Host and DB pressure');
        expect(wrapper.find('.refresh').exists()).toBe(true);
        expect(wrapper.find('[aria-label="Warning"]').exists()).toBe(true);
    });
});

describe('MonitoringGrid', () => {
    it('applies the requested responsive column class', () => {
        const wrapper = mount(MonitoringGrid, {
            props: {columns: 2},
            slots: {default: '<div>metric</div>'}
        });

        expect(wrapper.classes()).toContain('monitoring-grid--2');
        expect(wrapper.text()).toContain('metric');
    });
});
