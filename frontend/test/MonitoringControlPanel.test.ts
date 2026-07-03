import {flushPromises, mount} from '@vue/test-utils';
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, nextTick} from 'vue';
import ControlPanel from '@/pages/monitoring/control-panel.vue';
import {sendRPC} from '@/tools/websocket';

vi.mock('@/helpers/rpcPermissions', () => ({
    useRpcPermissions: () => ({
        canCall: (method: string) => method === 'System.DbWrites.Set'
    })
}));

vi.mock('@/tools/observability', () => ({
    OBS_LEVEL_LABELS: ['Off', 'Light', 'Medium', 'Heavy'],
    fetchDebugReport: vi.fn().mockResolvedValue({}),
    getInteractionCounts: vi.fn(() => ({})),
    getInteractions: vi.fn(() => []),
    getObsLevel: vi.fn(() => 1),
    getPendingRpcCount: vi.fn(() => 0),
    getRpcTimings: vi.fn(() => []),
    getWsMessagesPerSec: vi.fn(() => 0),
    getWsTelemetry: vi.fn(() => ({
        patchBufferMaxDepth: 0,
        droppedFrameCount: 0,
        rafFrameTimeMaxMs: 0,
        shellyConnectReceived: 0,
        shellyDisconnectReceived: 0,
        shellyConnectLatencyMs: {count: 0, last: 0, max: 0, p50: 0, p95: 0},
        shellyDisconnectLatencyMs: {count: 0, last: 0, max: 0, p50: 0, p95: 0}
    })),
    isDebugEnabled: vi.fn(() => false),
    isHeatmapEnabled: vi.fn(() => false),
    isWsTelemetryEnabled: vi.fn(() => false),
    setDebug: vi.fn(),
    setHeatmap: vi.fn(),
    setObsLevel: vi.fn(),
    setWsTelemetry: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({sendRPC: vi.fn()}));

const PageTemplateStub = defineComponent({
    name: 'PageTemplate',
    template: '<section><slot /></section>'
});

const BasicBlockStub = defineComponent({
    name: 'BasicBlock',
    template: '<div><slot /></div>'
});

const sendRPCMock = vi.mocked(sendRPC);

function mountPage() {
    return mount(ControlPanel, {
        global: {
            stubs: {
                PageTemplate: PageTemplateStub,
                BasicBlock: BasicBlockStub
            },
            provide: {
                monitoringTabs: []
            }
        }
    });
}

beforeEach(() => {
    setActivePinia(createPinia());
    sendRPCMock.mockReset();
    sendRPCMock.mockImplementation(async (_target, method, params) => {
        if (method === 'System.DbWrites.Get') {
            return {dbWritesDisabled: false};
        }
        if (method === 'System.DbWrites.Set') {
            return {dbWritesDisabled: Boolean((params as {disabled?: boolean}).disabled)};
        }
        if (method === 'System.Log.ListLevels') {
            return {levels: {}};
        }
        return {};
    });
});

describe('monitoring control panel', () => {
    it('requires typed confirmation before disabling hot-path DB writes', async () => {
        const wrapper = mountPage();
        await flushPromises();
        await nextTick();

        await wrapper
            .find('button[aria-label="Disable DB writes"]')
            .trigger('click');

        expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
        expect(
            sendRPCMock.mock.calls.some(([, method]) => method === 'System.DbWrites.Set')
        ).toBe(false);

        const confirmButton = wrapper
            .findAll('button')
            .find((button) => button.text() === 'Disable writes');
        expect(confirmButton?.attributes('disabled')).toBeDefined();

        await wrapper
            .find('#db-writes-confirm-input')
            .setValue('DISABLE DB WRITES');
        await confirmButton?.trigger('click');

        expect(sendRPCMock).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'System.DbWrites.Set',
            {disabled: true}
        );
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });

    it('enables DB writes again without confirmation', async () => {
        sendRPCMock.mockImplementation(async (_target, method, params) => {
            if (method === 'System.DbWrites.Get') {
                return {dbWritesDisabled: true};
            }
            if (method === 'System.DbWrites.Set') {
                return {dbWritesDisabled: Boolean((params as {disabled?: boolean}).disabled)};
            }
            if (method === 'System.Log.ListLevels') {
                return {levels: {}};
            }
            return {};
        });
        const wrapper = mountPage();
        await flushPromises();
        await nextTick();
        sendRPCMock.mockClear();

        await wrapper
            .find('button[aria-label="Enable DB writes"]')
            .trigger('click');

        expect(sendRPCMock).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'System.DbWrites.Set',
            {disabled: false}
        );
        expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    });
});
