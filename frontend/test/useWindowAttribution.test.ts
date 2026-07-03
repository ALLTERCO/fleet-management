// Composable: useWindowAttribution — pins the debounce + abort-on-stale
// behavior + the input-validation gate. Brush gestures can fire many
// times per second; without the 150ms debounce and the abort-id guard,
// the UI would flicker through stale RPC responses landing out of order.
// Bad input (non-ISO, inverted range, >90 days) is rejected at the
// boundary so the backend never sees garbage.

import type {AttributeWindowResult} from '@api/analytics';
import {flushPromises} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {effectScope, ref} from 'vue';
import type {DashboardScope} from '@/composables/useDashboardScope';
import {
    isValidRange,
    toApiScope,
    useWindowAttribution
} from '@/composables/useWindowAttribution';

const sendRPC =
    vi.fn<
        (
            target: string,
            method: string,
            params: Record<string, unknown>
        ) => Promise<AttributeWindowResult | null>
    >();

vi.mock('@/tools/websocket', () => ({
    sendRPC: (
        target: string,
        method: string,
        params: Record<string, unknown>
    ) => sendRPC(target, method, params)
}));

const FROM = '2026-05-27T03:00:00Z';
const TO = '2026-05-27T04:00:00Z';
const FROM_2 = '2026-05-27T05:00:00Z';
const TO_2 = '2026-05-27T06:00:00Z';
const FLEET: DashboardScope = {kind: 'fleet'};

function fakeResult(value = 100): AttributeWindowResult {
    return {
        metric: 'consumption',
        from: FROM,
        to: TO,
        aggregation: 'sum',
        unit: 'kWh',
        totalValue: value,
        contributors: [],
        truncated: false,
        truncatedCount: 0
    };
}

describe('useWindowAttribution', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        sendRPC.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not call the RPC until a range is set', () => {
        const scope = effectScope();
        scope.run(() => {
            useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
        });
        expect(sendRPC).not.toHaveBeenCalled();
        scope.stop();
    });

    it('debounces rapid setRange calls into one RPC', async () => {
        sendRPC.mockResolvedValue(fakeResult());
        const scope = effectScope();
        scope.run(() => {
            const api = useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
            api.setRange({from: FROM, to: TO});
            api.setRange({from: FROM_2, to: TO_2});
            api.setRange({
                from: '2026-05-27T07:00:00Z',
                to: '2026-05-27T08:00:00Z'
            });
        });
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(sendRPC).toHaveBeenCalledTimes(1);
        const [, , params] = sendRPC.mock.calls[0]!;
        expect(params).toMatchObject({
            from: '2026-05-27T07:00:00Z',
            to: '2026-05-27T08:00:00Z'
        });
        scope.stop();
    });

    it('exposes the loading flag while in flight', async () => {
        let resolveRpc!: (r: AttributeWindowResult) => void;
        sendRPC.mockImplementation(
            () =>
                new Promise<AttributeWindowResult>((r) => {
                    resolveRpc = r;
                })
        );
        const scope = effectScope();
        let api!: ReturnType<typeof useWindowAttribution>;
        scope.run(() => {
            api = useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
            api.setRange({from: FROM, to: TO});
        });
        await vi.advanceTimersByTimeAsync(200);
        expect(api.loading.value).toBe(true);
        resolveRpc(fakeResult());
        await flushPromises();
        expect(api.loading.value).toBe(false);
        expect(api.result.value?.totalValue).toBe(100);
        scope.stop();
    });

    it('ignores a stale RPC response that arrives after a newer one', async () => {
        let resolveFirst!: (r: AttributeWindowResult) => void;
        let resolveSecond!: (r: AttributeWindowResult) => void;
        sendRPC
            .mockImplementationOnce(
                () =>
                    new Promise<AttributeWindowResult>((r) => {
                        resolveFirst = r;
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<AttributeWindowResult>((r) => {
                        resolveSecond = r;
                    })
            );
        const scope = effectScope();
        let api!: ReturnType<typeof useWindowAttribution>;
        scope.run(() => {
            api = useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
            api.setRange({from: FROM, to: TO});
        });
        await vi.advanceTimersByTimeAsync(200);
        api.setRange({from: FROM_2, to: TO_2});
        await vi.advanceTimersByTimeAsync(200);
        resolveFirst({...fakeResult(11), totalValue: 11});
        await flushPromises();
        expect(api.result.value).toBeNull();
        resolveSecond({...fakeResult(22), totalValue: 22});
        await flushPromises();
        expect(api.result.value?.totalValue).toBe(22);
        scope.stop();
    });

    it('clears the result and skips the RPC when range is set to null', async () => {
        sendRPC.mockResolvedValue(fakeResult());
        const scope = effectScope();
        let api!: ReturnType<typeof useWindowAttribution>;
        scope.run(() => {
            api = useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
            api.setRange({from: FROM, to: TO});
        });
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(api.result.value).not.toBeNull();

        api.setRange(null);
        await vi.advanceTimersByTimeAsync(200);
        expect(api.result.value).toBeNull();
        scope.stop();
    });

    it('refetches when the metric ref changes while a range is set', async () => {
        sendRPC.mockResolvedValue(fakeResult());
        const metric = ref<'consumption' | 'power'>('consumption');
        const scope = effectScope();
        let api!: ReturnType<typeof useWindowAttribution>;
        scope.run(() => {
            api = useWindowAttribution({
                metric,
                scope: () => FLEET
            });
            api.setRange({from: FROM, to: TO});
        });
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(sendRPC).toHaveBeenCalledTimes(1);

        metric.value = 'power';
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(sendRPC).toHaveBeenCalledTimes(2);
        const [, , params] = sendRPC.mock.calls[1]!;
        expect(params.metric).toBe('power');
        scope.stop();
    });

    it('captures RPC errors on the error ref', async () => {
        sendRPC.mockRejectedValue(new Error('permission denied'));
        const scope = effectScope();
        let api!: ReturnType<typeof useWindowAttribution>;
        scope.run(() => {
            api = useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
            api.setRange({from: FROM, to: TO});
        });
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(api.error.value).toBe('permission denied');
        expect(api.result.value).toBeNull();
        scope.stop();
    });

    // ── Input validation (regression suite) ──

    it('rejects non-ISO bucket strings without calling the RPC', async () => {
        sendRPC.mockResolvedValue(fakeResult());
        const scope = effectScope();
        let api!: ReturnType<typeof useWindowAttribution>;
        scope.run(() => {
            api = useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
            api.setRange({from: '04:00', to: '05:00'});
        });
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(sendRPC).not.toHaveBeenCalled();
        expect(api.range.value).toBeNull();
        expect(api.result.value).toBeNull();
        scope.stop();
    });

    it('rejects inverted ranges (to <= from)', async () => {
        sendRPC.mockResolvedValue(fakeResult());
        const scope = effectScope();
        let api!: ReturnType<typeof useWindowAttribution>;
        scope.run(() => {
            api = useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
            api.setRange({from: TO, to: FROM});
        });
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(sendRPC).not.toHaveBeenCalled();
        expect(api.range.value).toBeNull();
        scope.stop();
    });

    it('rejects windows wider than 90 days', async () => {
        sendRPC.mockResolvedValue(fakeResult());
        const scope = effectScope();
        let api!: ReturnType<typeof useWindowAttribution>;
        scope.run(() => {
            api = useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
            api.setRange({
                from: '2026-01-01T00:00:00Z',
                to: '2026-05-01T00:00:00Z'
            });
        });
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(sendRPC).not.toHaveBeenCalled();
        scope.stop();
    });

    it('accepts a window exactly at the 90-day boundary', async () => {
        sendRPC.mockResolvedValue(fakeResult());
        const scope = effectScope();
        let api!: ReturnType<typeof useWindowAttribution>;
        scope.run(() => {
            api = useWindowAttribution({
                metric: () => 'consumption',
                scope: () => FLEET
            });
            api.setRange({
                from: '2026-01-01T00:00:00Z',
                to: '2026-04-01T00:00:00Z'
            });
        });
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(sendRPC).toHaveBeenCalledTimes(1);
        scope.stop();
    });

    it('forwards the scope picker selection as a single-axis ApiScope', async () => {
        sendRPC.mockResolvedValue(fakeResult());
        const scopeRef = ref<DashboardScope>({kind: 'group', id: 42});
        const scope = effectScope();
        scope.run(() => {
            const api = useWindowAttribution({
                metric: () => 'consumption',
                scope: scopeRef
            });
            api.setRange({from: FROM, to: TO});
        });
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        const [, , params] = sendRPC.mock.calls[0]!;
        expect(params.scope).toEqual({groupId: 42});
        scope.stop();
    });
});

describe('isValidRange', () => {
    it('accepts a one-hour ISO window', () => {
        expect(isValidRange({from: FROM, to: TO})).toBe(true);
    });

    it('rejects non-ISO bucket strings', () => {
        expect(isValidRange({from: '04:00', to: '05:00'})).toBe(false);
    });

    it('rejects when from === to (zero-length window)', () => {
        expect(isValidRange({from: FROM, to: FROM})).toBe(false);
    });

    it('rejects when to < from (inverted)', () => {
        expect(isValidRange({from: TO, to: FROM})).toBe(false);
    });

    it('rejects windows over 90 days', () => {
        expect(
            isValidRange({
                from: '2026-01-01T00:00:00Z',
                to: '2026-05-01T00:00:00Z'
            })
        ).toBe(false);
    });
});

describe('toApiScope', () => {
    it('maps fleet to an empty object', () => {
        expect(toApiScope({kind: 'fleet'})).toEqual({});
    });

    it('maps group/tag/location to their single-axis keys', () => {
        expect(toApiScope({kind: 'group', id: 7})).toEqual({groupId: 7});
        expect(toApiScope({kind: 'tag', id: 4})).toEqual({tagId: 4});
        expect(toApiScope({kind: 'location', id: 9})).toEqual({locationId: 9});
    });

    it('falls back to empty when id is missing on a non-fleet kind', () => {
        expect(toApiScope({kind: 'group'})).toEqual({});
    });
});
