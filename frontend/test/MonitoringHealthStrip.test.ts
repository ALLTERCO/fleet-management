// Verifies bucket aggregation reads the topology snapshot, the "awaiting"
// placeholder hides until a snapshot lands, the uptime suffix is gated on
// monitoring data, the obs-level pill picks the right variant, and the
// strip exposes the System Health region landmark.

import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import MonitoringHealthStrip from '@/components/monitoring/MonitoringHealthStrip.vue';
import {useMonitoringStore} from '@/stores/monitoring';
import {useTopologyStore} from '@/stores/topology';
import type {ModuleStatus, TopologySnapshot} from '@/types/topology';

vi.mock('@/tools/websocket', () => ({sendRPC: vi.fn()}));

function node(id: string, status: ModuleStatus) {
    return {
        id,
        label: id,
        role: 'service' as const,
        cluster: null,
        status,
        stats: {},
        route: null,
        description: null,
        virtual: false
    };
}

function snapshot(nodes: ReturnType<typeof node>[]): TopologySnapshot {
    return {
        schemaVersion: 1,
        generatedAt: 1_700_000_000_000,
        nodes,
        edges: [],
        clusters: [],
        thresholds: {}
    };
}

const RouterLinkStub = {
    name: 'RouterLink',
    props: ['to'],
    template: '<a><slot /></a>'
};

function mountStrip() {
    return mount(MonitoringHealthStrip, {
        global: {stubs: {RouterLink: RouterLinkStub}}
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('MonitoringHealthStrip — buckets', () => {
    it('hides the bucket row and shows a placeholder until a snapshot arrives', () => {
        const wrapper = mountStrip();
        expect(wrapper.find('.hs__buckets').exists()).toBe(false);
        expect(wrapper.find('.hs__buckets-placeholder').text()).toContain(
            'Awaiting topology'
        );
    });

    it('renders buckets in the documented order once a snapshot is present', () => {
        const topology = useTopologyStore();
        topology.current = snapshot([
            node('a', 'healthy'),
            node('b', 'healthy'),
            node('c', 'warning'),
            node('d', 'critical'),
            node('e', 'unknown')
        ]);
        const wrapper = mountStrip();
        const buckets = wrapper.findAll('.hs__bucket');
        expect(buckets.map((b) => b.attributes('data-status'))).toEqual([
            'critical',
            'warning',
            'healthy',
            'unknown'
        ]);
        const byStatus: Record<string, string> = {};
        for (const b of buckets) {
            const status = b.attributes('data-status') ?? '';
            byStatus[status] = b.find('.hs__bucket-count').text();
        }
        expect(byStatus).toEqual({
            critical: '1',
            warning: '1',
            healthy: '2',
            unknown: '1'
        });
    });
});

describe('MonitoringHealthStrip — header', () => {
    it('exposes a "System Health" region landmark', () => {
        const wrapper = mountStrip();
        expect(wrapper.attributes('role')).toBe('region');
        expect(wrapper.attributes('aria-label')).toBe('System Health');
    });

    it('renders the overall label inside an h2', () => {
        const wrapper = mountStrip();
        expect(wrapper.find('h2.hs__overall-label').exists()).toBe(true);
    });

    it('falls back to "No signal" overall when monitoring is off', () => {
        const wrapper = mountStrip();
        expect(wrapper.attributes('data-overall')).toBe('unknown');
        expect(wrapper.find('.hs__overall-label').text()).toContain(
            'No signal'
        );
    });

    it('renders the uptime suffix only when latestMetrics carries it', async () => {
        const wrapper = mountStrip();
        expect(wrapper.find('.hs__uptime').exists()).toBe(false);
        const monitoring = useMonitoringStore();
        monitoring.latestMetrics = {uptimeS: 3 * 86400 + 5 * 3600};
        await wrapper.vm.$nextTick();
        expect(wrapper.find('.hs__uptime').text()).toBe('Uptime 3d 5h');
    });

    it('picks the right obs-level pill variant', async () => {
        const monitoring = useMonitoringStore();
        monitoring.obsLevel = 2;
        const wrapper = mountStrip();
        expect(wrapper.find('.hs__obs-pill').classes()).toContain(
            'hs__obs-pill--medium'
        );
    });
});
