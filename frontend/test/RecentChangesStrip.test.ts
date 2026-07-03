import {flushPromises, mount} from '@vue/test-utils';
import {afterEach, describe, expect, it, vi} from 'vitest';
import RecentChangesStrip from '@/components/monitoring/RecentChangesStrip.vue';
import {loadDeployManifestPayload} from '@/helpers/monitoringRuntimeClient';
import {sendRPC} from '@/tools/websocket';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn()
}));

vi.mock('@/helpers/monitoringRuntimeClient', () => ({
    loadDeployManifestPayload: vi.fn()
}));

afterEach(() => {
    vi.mocked(sendRPC).mockReset();
    vi.mocked(loadDeployManifestPayload).mockReset();
});

describe('RecentChangesStrip', () => {
    it('renders topology, status, throughput, and runtime container changes', async () => {
        vi.mocked(sendRPC).mockResolvedValueOnce({
            schemaVersion: 2,
            windowMin: 5,
            nodeMembershipChanges: [
                {id: 'authz', change: 'appeared', status: 'warning'}
            ],
            edgeMembershipChanges: [
                {
                    id: 'auth->authz',
                    change: 'disappeared',
                    from: 'auth',
                    to: 'authz'
                }
            ],
            changedNodes: [
                {
                    id: 'dbPool',
                    statusBefore: 'healthy',
                    statusAfter: 'critical'
                }
            ],
            changedEdges: [
                {
                    id: 'statusQueue->dbPool',
                    previousThroughput: 10,
                    currentThroughput: 25,
                    pctChange: 150
                }
            ]
        });
        vi.mocked(loadDeployManifestPayload).mockResolvedValueOnce({
            manifestPayload: {
                status: 'ok',
                manifest: {
                    container_summary: {
                        expected: 7,
                        running: 8,
                        missing: 1,
                        unexpected: 1,
                        unknown_owner: 1
                    }
                }
            },
            manifestError: null
        });

        const wrapper = mount(RecentChangesStrip);
        await flushPromises();

        expect(wrapper.text()).toContain('authz');
        expect(wrapper.text()).toContain('module appeared');
        expect(wrapper.text()).toContain('auth->authz');
        expect(wrapper.text()).toContain('edge disappeared');
        expect(wrapper.text()).toContain('dbPool');
        expect(wrapper.text()).toContain('healthy → critical');
        expect(wrapper.text()).toContain('statusQueue->dbPool');
        expect(wrapper.text()).toContain('+150% throughput');
        expect(wrapper.text()).toContain('declared container missing');
        expect(wrapper.text()).toContain('unexpected/new container detected');
        expect(wrapper.text()).toContain('unknown-owner container detected');

        wrapper.unmount();
    });
});
