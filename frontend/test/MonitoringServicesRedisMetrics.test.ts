import {mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {defineComponent} from 'vue';
import ServicesPage from '@/pages/monitoring/services.vue';
import {useMonitoringStore} from '@/stores/monitoring';

vi.mock('@/tools/websocket', () => ({sendRPC: vi.fn()}));

const {sendRPC} = await import('@/tools/websocket');
const mockedSendRPC = vi.mocked(sendRPC);

const PageTemplateStub = defineComponent({
    name: 'PageTemplate',
    template: '<section><slot /></section>'
});

const PassThroughStub = defineComponent({
    name: 'PassThroughStub',
    template: '<div><slot /></div>'
});

const StatusStub = defineComponent({
    name: 'MonitoringStatusSummaryRow',
    props: ['title'],
    template: '<h3>{{ title }}</h3>'
});

const SectionHeaderStub = defineComponent({
    name: 'MonitoringSectionHeader',
    props: ['title'],
    template: '<h4>{{ title }}</h4>'
});

function loadSnapshot() {
    const store = useMonitoringStore();
    store.obsLevel = 2;
    const snapshot = {
        emQueueSize: 0,
        emActiveSyncs: 1,
        emSyncOldestHeldMs: 0,
        emSyncStuck: 0,
        emSyncStreamDepth: 42,
        emSyncStreamOldestAgeMs: 12000,
        emSyncStreamPending: 3,
        emSyncRowsWrittenPerMin: 900,
        emSyncLastWriteRows: 5000,
        emSyncLastWriteMs: 250,
        emSyncLastWriteRowsPerSec: 20000,
        emSyncLastRpcFetchMs: 80,
        emSyncLastRpcRecords: 600,
        emSyncLastPassBlocks: 9,
        emSyncLastPassMs: 100,
        emSyncWorstChannelLagSec: 3600,
        emSyncLaggedChannels: 2,
        emSyncWorstLagDeviceId: 'dev1',
        emSyncWorstLagChannel: 0,
        dbRuntimeStatus: 'ok',
        dbRuntimeStatusCode: 1,
        dbRuntimeCheckedAt: '2026-07-03T12:00:00.000Z',
        dbRuntimeCheckAgeSec: 1,
        dbRuntimeLastSuccessfulAt: '2026-07-03T12:00:00.000Z',
        dbRuntimeLastSuccessfulAgeSec: 1,
        dbRuntimePostgresVersion: '18.3',
        dbRuntimePostgresMajor: 18,
        dbRuntimeTimescaleVersion: '2.28.1',
        dbRuntimeExpectedTimescaleImage: 'timescale/timescaledb:2.28.1-pg18',
        dbRuntimeExpectedTimescaleVersion: '2.28.1',
        dbRuntimeError: '',
        waitingRoomPending: 0,
        mdnsRunning: true,
        firmwareRunning: true,
        registryCacheSize: 0
    };
    store.latestMetrics = {
        counters: {em_syncs_completed: 1, em_syncs_failed: 0},
        modules: {registry: {fileCacheSize: 0, dbCacheSize: 0}}
    };
    store.history.push(snapshot as never);
}

function mountPage() {
    return mount(ServicesPage, {
        global: {
            stubs: {
                PageTemplate: PageTemplateStub,
                ErrorBoundary: PassThroughStub,
                BasicBlock: PassThroughStub,
                MonitoringGrid: PassThroughStub,
                MonitoringEmptyState: PassThroughStub,
                MonitoringStatusSummaryRow: StatusStub,
                MonitoringSectionHeader: SectionHeaderStub,
                SparkLine: true
            }
        }
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
    mockedSendRPC.mockReset();
});

describe('monitoring services — Redis buffer metrics', () => {
    it('extracts Redis and EM sync gauges from backend metrics', async () => {
        mockedSendRPC.mockResolvedValueOnce({
            metrics: {
                modules: {
                    emSync: {
                        queueSize: 0,
                        activeSyncs: 1,
                        worstChannelLagSeconds: 3600,
                        laggedChannels: 1,
                        worstLagDeviceId: 'dev1',
                        worstLagChannel: 0
                    }
                },
                counters: {},
                gauges: {
                    em_sync_last_write_rows: 5000,
                    em_sync_last_write_ms: 250,
                    em_sync_last_write_rows_per_sec: 20000,
                    em_sync_last_rpc_fetch_ms: 80,
                    em_sync_last_rpc_records: 600,
                    em_sync_last_pass_blocks: 9,
                    em_sync_last_pass_ms: 100
                },
                labeledGauges: {
                    [JSON.stringify({
                        name: 'stream_length',
                        labels: {stream: 'em-sync-buffer'}
                    })]: 42,
                    [JSON.stringify({
                        name: 'stream_oldest_age_ms',
                        labels: {stream: 'em-sync-buffer'}
                    })]: 12000,
                    [JSON.stringify({
                        name: 'stream_pending_entries',
                        labels: {stream: 'em-sync-buffer'}
                    })]: 3
                }
            }
        });
        const store = useMonitoringStore();
        store.obsLevel = 2;

        await store.fetchAndRecord();

        expect(store.latest?.emSyncStreamDepth).toBe(42);
        expect(store.latest?.emSyncStreamOldestAgeMs).toBe(12000);
        expect(store.latest?.emSyncStreamPending).toBe(3);
        expect(store.latest?.emSyncLastWriteRows).toBe(5000);
        expect(store.latest?.emSyncLastWriteRowsPerSec).toBe(20000);
        expect(store.latest?.emSyncWorstChannelLagSec).toBe(3600);
        expect(store.latest?.emSyncLaggedChannels).toBe(1);
        expect(store.latest?.emSyncWorstLagDeviceId).toBe('dev1');
        expect(store.latest?.emSyncWorstLagChannel).toBe(0);
        expect(store.emSyncStatus).toBe('healthy');
    });

    it('raises the Energy Meter Sync status from Redis backlog thresholds', async () => {
        const store = useMonitoringStore();
        store.obsLevel = 2;
        store.history.push({
            emQueueSize: 0,
            emActiveSyncs: 0,
            emSyncOldestHeldMs: 0,
            emSyncStuck: 0,
            emSyncStreamDepth: 50001,
            emSyncStreamOldestAgeMs: 0,
            emSyncStreamPending: 0,
            emSyncRowsWrittenPerMin: 0,
            emSyncLastWriteRows: 0,
            emSyncLastWriteMs: 0,
            emSyncLastWriteRowsPerSec: 0,
            emSyncLastRpcFetchMs: 0,
            emSyncLastRpcRecords: 0,
            emSyncLastPassBlocks: 0,
            emSyncLastPassMs: 0,
            emSyncWorstChannelLagSec: 0,
            emSyncLaggedChannels: 0,
            emSyncWorstLagDeviceId: '',
            emSyncWorstLagChannel: -1,
            dbRuntimeStatus: 'ok',
            dbRuntimeStatusCode: 1,
            dbRuntimeCheckedAt: '2026-07-03T12:00:00.000Z',
            dbRuntimeCheckAgeSec: 1,
            dbRuntimeLastSuccessfulAt: '2026-07-03T12:00:00.000Z',
            dbRuntimeLastSuccessfulAgeSec: 1,
            dbRuntimePostgresVersion: '18.3',
            dbRuntimePostgresMajor: 18,
            dbRuntimeTimescaleVersion: '2.28.1',
            dbRuntimeExpectedTimescaleImage:
                'timescale/timescaledb:2.28.1-pg18',
            dbRuntimeExpectedTimescaleVersion: '2.28.1',
            dbRuntimeError: ''
        } as never);

        expect(store.emSyncStatus).toBe('warning');

        store.history.push({
            ...store.latest,
            emSyncStreamOldestAgeMs: 31 * 60 * 1000
        } as never);

        expect(store.emSyncStatus).toBe('critical');
    });

    it('renders EM sync Redis buffer health from the monitoring snapshot', () => {
        loadSnapshot();

        const wrapper = mountPage();

        expect(wrapper.text()).toContain('Redis Buffer Health');
        expect(wrapper.text()).toContain('Stream Depth');
        expect(wrapper.text()).toContain('42');
        expect(wrapper.text()).toContain('Pending');
        expect(wrapper.text()).toContain('3');
        expect(wrapper.text()).toContain('Rows Written');
        expect(wrapper.text()).toContain('900/min');
        expect(wrapper.text()).toContain('5000 rows / 250ms');
        expect(wrapper.text()).toContain('20000/s');
        expect(wrapper.text()).toContain('80ms / 600 rows');
        expect(wrapper.text()).toContain('60m · 2 channels');
    });
});
