import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {computed, defineComponent, h, nextTick, provide, type Component} from 'vue';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import ActivityPage from '@/pages/monitoring/activity.vue';
import InvestigatePage from '@/pages/monitoring/investigate.vue';
import ResourcesPage from '@/pages/monitoring/resources.vue';
import RuntimePage from '@/pages/monitoring/runtime.vue';
import {MONITORING_TABS} from '@/helpers/monitoringNavigation';
import {useMonitoringStore} from '@/stores/monitoring';

vi.mock('@/helpers/monitoringRuntimeClient', () => ({
    loadRuntimeContractPayloads: vi.fn(async () => ({
        versionInfo: {
            version: '2.1.2',
            commit: 'abcdef123456',
            environment_id: 'office-test',
            client_id: 'client-a',
            deployment_mode: 'shared_saas',
            compose_project: 'fleet-manager'
        },
        manifestPayload: {
            status: 'ok',
            checksum: 'sha256:test',
            revision: 7,
            generated_at: '2026-06-14T00:00:00.000Z',
            rollback: {ready: true, target: 'abcdef0'},
            containers: {
                expected: [{name: 'fm-backend'}],
                running: [{name: 'fm-backend', status: 'running'}]
            },
            checks: {
                migration: {status: 'passed'},
                smoke: {status: 'passed'},
                api: {status: 'passed'},
                browser: {status: 'passed'}
            }
        },
        manifestError: null,
        deviceUsagePayload: {
            rows: [
                {
                    client_id: 'client-a',
                    unique_active_devices: 12,
                    paid_device_limit: 20,
                    limit_status: 'ok'
                }
            ]
        },
        deviceUsageError: null
    }))
}));

const RouterLinkStub = defineComponent({
    name: 'RouterLink',
    props: ['to'],
    template:
        '<a class="router-link-stub" :data-to="typeof to === `string` ? to : to.path"><slot /></a>'
});

const PageTemplateStub = defineComponent({
    name: 'PageTemplate',
    props: ['title'],
    template: '<section class="page-template-stub"><h1>{{ title }}</h1><slot /></section>'
});

const BasicBlockStub = defineComponent({
    name: 'BasicBlock',
    template: '<section class="basic-block-stub"><slot /></section>'
});

const ErrorBoundaryStub = defineComponent({
    name: 'ErrorBoundary',
    template: '<div class="error-boundary-stub"><slot /></div>'
});

const DataListStub = defineComponent({
    name: 'DataList',
    props: ['rows', 'columns', 'emptyMessage'],
    template:
        '<div class="data-list-stub"><span v-for="row in rows" :key="JSON.stringify(row)">{{ JSON.stringify(row) }}</span><span v-if="!rows?.length">{{ emptyMessage }}</span></div>'
});

const RootHarness = defineComponent({
    props: {
        component: {type: Object, required: true}
    },
    setup(props) {
        provide('monitoringTabs', computed(() => MONITORING_TABS));
        return () => h(props.component as Component);
    }
});

function mountMonitoringPage(component: object) {
    return mount(RootHarness, {
        props: {component},
        global: {
            stubs: {
                RouterLink: RouterLinkStub,
                PageTemplate: PageTemplateStub,
                BasicBlock: BasicBlockStub,
                ErrorBoundary: ErrorBoundaryStub,
                DataList: DataListStub,
                HealthDot: true,
                SparkLine: true,
                TimeSeriesChart: true,
                MonitoringEmptyState: {
                    props: ['title'],
                    template: '<div class="empty-state-stub">{{ title }}</div>'
                }
            }
        }
    });
}

function seedMonitoringStore(): void {
    const store = useMonitoringStore();
    store.obsLevel = 2;
    store.latestMetrics = {
        cpuUserPct: 12,
        cpuSystemPct: 4,
        osFreeMemM: 4096,
        dbPoolWaiting: 0,
        statusQueueSize: 2,
        rssM: 128,
        heapUsedM: 64,
        dbPoolIdle: 8,
        dbPoolTotal: 10,
        dbAvgMs: 18,
        auditQueueLength: 0,
        devicesTotal: 12,
        rpcAvgMs: 42,
        eventsBroadcastRate: 5,
        wsClients: 3,
        initActive: 0,
        initQueued: 0,
        initFailureRate: 0,
        rpcErrorRate: 0,
        eventsListeners: 4,
        eventsTypes: 2,
        broadcastMaxMs: 7,
        waitingRoomPending: 0,
        emActiveSyncs: 0,
        pluginsLoaded: 1,
        registryCacheSize: 42,
        eventLoopLagMs: 2,
        activeHandles: 10,
        counters: {}
    } as never;
}

beforeEach(() => {
    setActivePinia(createPinia());
    seedMonitoringStore();
});

describe('monitoring top-level pages', () => {
    it('keeps Resources as the host and database entry point', () => {
        const wrapper = mountMonitoringPage(ResourcesPage);

        expect(wrapper.text()).toContain('Resource Health');
        expect(wrapper.find('[data-to="/monitoring/host"]').exists()).toBe(true);
        expect(wrapper.find('[data-to="/monitoring/database"]').exists()).toBe(true);
    });

    it('keeps Activity as the live operations entry point', () => {
        const wrapper = mountMonitoringPage(ActivityPage);

        expect(wrapper.text()).toContain('Live Activity');
        for (const path of [
            '/monitoring/device-ingest',
            '/monitoring/commands',
            '/monitoring/connections',
            '/monitoring/events',
            '/monitoring/services'
        ]) {
            expect(wrapper.find(`[data-to="${path}"]`).exists()).toBe(true);
        }
    });

    it('keeps Investigate as the logs, audit, commands, and controls entry point', () => {
        const wrapper = mountMonitoringPage(InvestigatePage);

        expect(wrapper.text()).toContain('Investigation tools');
        for (const path of [
            '/monitoring/logs',
            '/monitoring/audit-log',
            '/monitoring/commands',
            '/monitoring/control-panel'
        ]) {
            expect(wrapper.find(`[data-to="${path}"]`).exists()).toBe(true);
        }
    });

    it('renders Runtime deployment, containers, device usage, and contract payload sections', async () => {
        const wrapper = mountMonitoringPage(RuntimePage);
        await nextTick();
        await nextTick();

        expect(wrapper.text()).toContain('Instance');
        expect(wrapper.text()).toContain('Deploy Checks');
        expect(wrapper.text()).toContain('Containers');
        expect(wrapper.text()).toContain('Device Usage');
        expect(wrapper.text()).toContain('Contract Payloads');
        expect(wrapper.text()).toContain('fm-backend');
        expect(wrapper.text()).toContain('client-a');
    });
});
