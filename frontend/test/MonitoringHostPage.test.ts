// Smoke tests for the host page: it shows the enable-CTA at obs 0, swaps to
// loading skeleton while waiting for metrics, and renders Core Pipeline +
// Services FlowCards once a snapshot lands. Verifies the demotion didn't
// drop any of the sections overview.vue used to own.

import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {defineComponent} from 'vue';
import HostPage from '@/pages/monitoring/host.vue';
import {useMonitoringStore} from '@/stores/monitoring';

vi.mock('@/tools/websocket', () => ({sendRPC: vi.fn()}));

const FlowCardStub = defineComponent({
    name: 'FlowCard',
    props: ['title'],
    template: '<div class="flow-card-stub" :data-title="title"></div>'
});

const ExpandedVitalCardStub = defineComponent({
    name: 'ExpandedVitalCard',
    props: ['label'],
    template: '<div class="evc-stub" :data-label="label"></div>'
});

const VitalCardStub = defineComponent({
    name: 'VitalCard',
    props: ['label'],
    template: '<div class="vc-stub" :data-label="label"></div>'
});

const PageTemplateStub = defineComponent({
    name: 'PageTemplate',
    template: '<section><slot /></section>'
});

function mountPage() {
    return mount(HostPage, {
        global: {
            stubs: {
                FlowCard: FlowCardStub,
                ExpandedVitalCard: ExpandedVitalCardStub,
                VitalCard: VitalCardStub,
                PageTemplate: PageTemplateStub,
                BottleneckPanel: true,
                RecentChangesStrip: true,
                TopologyDiagram: true,
                PageSkeleton: true,
                ErrorBoundary: {template: '<div><slot /></div>'},
                BasicBlock: {template: '<div><slot /></div>'}
            }
        }
    });
}

function loadSnapshot() {
    const store = useMonitoringStore();
    store.obsLevel = 2;
    const snapshot = {
        uptimeS: 60,
        devicesTotal: 5,
        initActive: 0,
        initFailureRate: 0,
        statusMsgRate: 0,
        statusQueueSize: 0,
        statusFlushing: false,
        rpcAvgMs: 1,
        rpcErrorRate: 0,
        rpcSuccessRate: 1,
        dbPoolTotal: 10,
        dbPoolIdle: 8,
        dbPoolWaiting: 0,
        dbAvgMs: 1,
        eventsListeners: 1,
        eventsTypes: 1,
        pluginsLoaded: 1,
        pluginWorkers: 0,
        emQueueSize: 0,
        emActiveSyncs: 0,
        waitingRoomPending: 0,
        cpuUserPct: 5,
        cpuSystemPct: 2,
        eventLoopLagMs: 1,
        eventLoopP99: 1,
        rssM: 100,
        heapUsedM: 50,
        heapTotalM: 100,
        heapTrend: 'stable',
        wsClients: 1,
        activeHandles: 10,
        mdnsRunning: true,
        firmwareRunning: true,
        registryCacheSize: 5,
        commanderComponents: 3,
        eventsBroadcastRate: 0,
        osFreeMemM: 4000,
        osTotalMemM: 8000,
        osLoadAvg1: 0.5,
        osLoadAvg5: 0.4,
        osLoadAvg15: 0.3,
        gcMaxPauseMs: 5,
        externalM: 10,
        counters: {}
    };
    store.latestMetrics = snapshot;
    store.history.push(snapshot as never);
}

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('monitoring host page — smoke', () => {
    it('shows the enable CTA when monitoring is off', () => {
        const store = useMonitoringStore();
        store.obsLevel = 0;
        const wrapper = mountPage();
        expect(wrapper.text()).toContain('Enable monitoring');
    });

    it('renders both Core Pipeline and Services FlowCards once data lands', () => {
        loadSnapshot();
        const wrapper = mountPage();
        const titles = wrapper
            .findAll('.flow-card-stub')
            .map((c) => c.attributes('data-title'));
        expect(titles).toEqual([
            'Device Ingest',
            'Status Pipeline',
            'RPC Commands',
            'Database',
            'Events & Plugins',
            'Energy Meters',
            'Waiting Room'
        ]);
    });

    it('renders the seven ExpandedVitalCards in the System Vitals block', () => {
        loadSnapshot();
        const wrapper = mountPage();
        const labels = wrapper
            .findAll('.evc-stub')
            .map((c) => c.attributes('data-label'));
        expect(labels).toEqual([
            'CPU Usage',
            'Event Loop Lag',
            'Memory (RSS)',
            'Heap',
            'Browser Sessions',
            'Devices Online',
            'Active Handles'
        ]);
    });

    it('renders the ten Auxiliary VitalCards', () => {
        loadSnapshot();
        const wrapper = mountPage();
        expect(wrapper.findAll('.vc-stub')).toHaveLength(10);
    });
});
