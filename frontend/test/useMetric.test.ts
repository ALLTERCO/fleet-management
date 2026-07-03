import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {effectScope, nextTick} from 'vue';

// The composables read through callMethod -> call -> sendRPC. Mock the
// transport so we drive responses and assert the exact RPC calls.
const sendRPC = vi.hoisted(() => vi.fn());
vi.mock('@/tools/websocket', () => ({sendRPC}));

import {
    metrics,
    useLiveMetric,
    useMetric,
    useMetricHistory
} from '@/shell/template-host/energy';

function lastCall() {
    return sendRPC.mock.calls.at(-1);
}

beforeEach(() => {
    sendRPC.mockReset();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('metrics imperative helpers', () => {
    it('maps current() to energy.current', async () => {
        sendRPC.mockResolvedValue({watts: 5, asOf: 't', onlineDevices: 1});
        await metrics.current({devices: ['A']});
        const [provider, method, params] = lastCall()!;
        expect(provider).toBe('FLEET_MANAGER');
        expect(method).toBe('energy.current');
        expect(params).toEqual({devices: ['A']});
    });

    it('maps history() to energy.query', async () => {
        sendRPC.mockResolvedValue({items: [], total: 0});
        await metrics.history({from: 'a', to: 'b', tags: ['power']});
        expect(lastCall()![1]).toBe('energy.query');
    });
});

describe('useLiveMetric', () => {
    it('polls energy.current and exposes watts', async () => {
        sendRPC.mockResolvedValue({
            watts: 123,
            asOf: 't0',
            onlineDevices: 2
        });
        const scope = effectScope();
        const live = scope.run(() =>
            useLiveMetric({devices: ['A', 'B'], intervalMs: 2000})
        )!;

        await vi.waitFor(() => expect(live.watts.value).toBe(123));
        expect(live.state.value).toBe('ready');
        expect(live.onlineDevices.value).toBe(2);
        expect(sendRPC).toHaveBeenCalledTimes(1);
        expect(lastCall()![1]).toBe('energy.current');

        sendRPC.mockResolvedValue({watts: 200, asOf: 't1', onlineDevices: 2});
        await vi.advanceTimersByTimeAsync(2000);
        await vi.waitFor(() => expect(live.watts.value).toBe(200));

        scope.stop();
        sendRPC.mockClear();
        await vi.advanceTimersByTimeAsync(4000);
        expect(sendRPC).not.toHaveBeenCalled(); // stopped on scope dispose
    });

    it('clamps the interval to the 1s floor', async () => {
        sendRPC.mockResolvedValue({watts: 0, asOf: 't', onlineDevices: 0});
        const scope = effectScope();
        scope.run(() => useLiveMetric({intervalMs: 10}));
        await vi.advanceTimersByTimeAsync(0); // flush the immediate refresh
        expect(sendRPC).toHaveBeenCalledTimes(1);
        sendRPC.mockClear();
        await vi.advanceTimersByTimeAsync(999);
        expect(sendRPC).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(sendRPC).toHaveBeenCalledTimes(1);
        scope.stop();
    });

    it('does not start when immediate is false', async () => {
        sendRPC.mockResolvedValue({watts: 0, asOf: 't', onlineDevices: 0});
        const scope = effectScope();
        const live = scope.run(() => useLiveMetric({immediate: false}))!;
        await nextTick();
        expect(sendRPC).not.toHaveBeenCalled();
        live.start();
        await vi.waitFor(() => expect(live.state.value).toBe('ready'));
        scope.stop();
    });

    it('records an error and keeps polling', async () => {
        sendRPC.mockRejectedValueOnce(new Error('boom'));
        const scope = effectScope();
        const live = scope.run(() => useLiveMetric({intervalMs: 1000}))!;
        await vi.waitFor(() => expect(live.state.value).toBe('error'));
        expect(live.error.value).toBe('boom');
        scope.stop();
    });

    it('forwards components[] and detail', async () => {
        sendRPC.mockResolvedValue({watts: 0, asOf: 't', onlineDevices: 0});
        const scope = effectScope();
        scope.run(() =>
            useLiveMetric({
                devices: ['A'],
                components: ['switch:1', 'switch:3'],
                detail: 'channel'
            })
        );
        await vi.waitFor(() => expect(sendRPC).toHaveBeenCalled());
        expect(lastCall()![2]).toEqual({
            devices: ['A'],
            components: ['switch:1', 'switch:3'],
            detail: 'channel'
        });
        scope.stop();
    });
});

describe('useMetricHistory', () => {
    it('queries energy.query, defaulting tags to power', async () => {
        sendRPC.mockResolvedValue({
            items: [
                {bucket: 'b', device: 1, shellyID: 'A', tag: 'power', value: 9}
            ],
            total: 1
        });
        const scope = effectScope();
        const hist = scope.run(() =>
            useMetricHistory({from: 'f', to: 't', scope: {groupId: 7}})
        )!;
        await vi.waitFor(() => expect(hist.rows.value.length).toBe(1));
        expect(hist.rows.value[0].value).toBe(9);
        const params = lastCall()![2] as Record<string, unknown>;
        expect(lastCall()![1]).toBe('energy.query');
        expect(params.tags).toEqual(['power']);
        expect(params.scope).toEqual({groupId: 7});
        scope.stop();
    });
});

describe('useMetric front door', () => {
    it('delegates to history when mode=history', async () => {
        sendRPC.mockResolvedValue({items: [], total: 0});
        const scope = effectScope();
        const res = scope.run(() =>
            useMetric({mode: 'history', from: 'f', to: 't'})
        )!;
        await vi.waitFor(() => expect(sendRPC).toHaveBeenCalled());
        expect('rows' in res).toBe(true);
        expect(lastCall()![1]).toBe('energy.query');
        scope.stop();
    });

    it('defaults to live polling', async () => {
        sendRPC.mockResolvedValue({watts: 1, asOf: 't', onlineDevices: 1});
        const scope = effectScope();
        const res = scope.run(() => useMetric({devices: ['A']}))!;
        await vi.waitFor(() => expect(sendRPC).toHaveBeenCalled());
        expect('watts' in res).toBe(true);
        expect(lastCall()![1]).toBe('energy.current');
        scope.stop();
    });
});
