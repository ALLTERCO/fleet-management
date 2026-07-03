import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/tools/websocket', () => ({
    sendRPC: vi.fn()
}));

const {sendRPC} = await import('@/tools/websocket');
const mockedSendRPC = vi.mocked(sendRPC);

async function importObservability() {
    vi.resetModules();
    return await import('@/tools/observability');
}

beforeEach(() => {
    localStorage.clear();
    window.__FM_RUNTIME_CONFIG__ = undefined;
    mockedSendRPC.mockReset();
});

describe('fetchBackendMetrics', () => {
    it('loads rich instance metrics through authenticated System health RPC', async () => {
        mockedSendRPC.mockResolvedValueOnce({
            metrics: {
                counters: {status_messages: 10},
                modules: {devices: {total: 3}}
            }
        });

        const observability = await importObservability();
        const metrics = await observability.fetchBackendMetrics();

        expect(mockedSendRPC).toHaveBeenCalledWith(
            'FLEET_MANAGER',
            'System.Health.GetFull',
            {}
        );
        expect(metrics).toEqual({
            counters: {status_messages: 10},
            modules: {devices: {total: 3}}
        });
        expect(observability.getCachedBackendMetrics()).toBe(metrics);
    });

    it('returns null and clears cache when the health RPC fails', async () => {
        mockedSendRPC.mockResolvedValueOnce({
            metrics: {counters: {status_messages: 10}}
        });

        const observability = await importObservability();
        await observability.fetchBackendMetrics();

        mockedSendRPC.mockRejectedValueOnce(new Error('offline'));

        await expect(observability.fetchBackendMetrics()).resolves.toBeNull();
        expect(observability.getCachedBackendMetrics()).toBeNull();
    });
});
