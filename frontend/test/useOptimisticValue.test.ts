// Pin the optimistic-UI contract used by controls like the dimmer
// slider: `display` flips to the user's target value the instant the
// action fires, reconciles once the source-of-truth catches up, and
// snaps back if the action fails. Regression: dimmer presets felt
// unresponsive ("clicked 75, it went to 25, clicked again, then 75")
// because the displayed value lagged the click by one RPC roundtrip.

import {afterEach, describe, expect, it, vi} from 'vitest';
import {effectScope, nextTick, ref} from 'vue';
import {useOptimisticValue} from '@/composables/useOptimisticValue';

afterEach(() => {
    vi.useRealTimers();
});

describe('useOptimisticValue', () => {
    it('shows the source value when nothing has been committed', () => {
        const source = ref(25);
        const scope = effectScope();
        const api = scope.run(() => useOptimisticValue(source))!;
        expect(api.display.value).toBe(25);
        scope.stop();
    });

    it('flips display to the committed value immediately on commit', async () => {
        const source = ref(25);
        let resolve!: () => void;
        const action = () =>
            new Promise<void>((r) => {
                resolve = r;
            });
        const scope = effectScope();
        const api = scope.run(() => useOptimisticValue(source))!;

        const commitPromise = api.commit(75, action);
        // Synchronously, before the action settles, display already shows 75.
        expect(api.display.value).toBe(75);
        resolve();
        await commitPromise;
        scope.stop();
    });

    it('keeps showing the pending value until the source catches up', async () => {
        const source = ref(25);
        const action = vi.fn(() => Promise.resolve());
        const scope = effectScope();
        const api = scope.run(() => useOptimisticValue(source))!;

        await api.commit(75, action);
        // Source hasn't caught up yet; display still shows 75.
        expect(api.display.value).toBe(75);

        // Status push from the device arrives: store catches up to 75.
        source.value = 75;
        await nextTick();
        // Override clears; display now reads from the source directly.
        expect(api.display.value).toBe(75);

        // Source moves again (e.g. user dragged elsewhere from another tab).
        source.value = 40;
        await nextTick();
        expect(api.display.value).toBe(40);
        scope.stop();
    });

    it('reverts to the source value when the action rejects', async () => {
        const source = ref(25);
        const action = () => Promise.reject(new Error('rpc failed'));
        const scope = effectScope();
        const api = scope.run(() => useOptimisticValue(source))!;

        await expect(api.commit(75, action)).rejects.toThrow('rpc failed');
        // Optimistic override dropped; source still 25, display reverts.
        expect(api.display.value).toBe(25);
        scope.stop();
    });

    it('latest commit wins when commits overlap', async () => {
        const source = ref(25);
        let resolveFirst!: () => void;
        let resolveSecond!: () => void;
        const firstAction = () =>
            new Promise<void>((r) => {
                resolveFirst = r;
            });
        const secondAction = () =>
            new Promise<void>((r) => {
                resolveSecond = r;
            });
        const scope = effectScope();
        const api = scope.run(() => useOptimisticValue(source))!;

        const p1 = api.commit(50, firstAction);
        expect(api.display.value).toBe(50);

        const p2 = api.commit(75, secondAction);
        expect(api.display.value).toBe(75); // newer commit overrides

        resolveFirst();
        await p1;
        // First commit settles. pending still equals 75 (the newer one),
        // so the `pending === value` check leaves it intact.
        expect(api.display.value).toBe(75);

        resolveSecond();
        await p2;
        // Second commit settles. Source hasn't caught up yet, so the
        // override stays at 75 until the status push arrives.
        expect(api.display.value).toBe(75);

        // Status push arrives.
        source.value = 75;
        await nextTick();
        expect(api.display.value).toBe(75);
        scope.stop();
    });

    it('works for non-numeric value types (string, boolean)', async () => {
        const sourceStr = ref('off');
        const action = vi.fn(() => Promise.resolve());
        const scope = effectScope();
        const apiStr = scope.run(() => useOptimisticValue(sourceStr))!;

        const p = apiStr.commit('on', action);
        expect(apiStr.display.value).toBe('on');
        await p;
        expect(apiStr.display.value).toBe('on');
        sourceStr.value = 'on';
        await nextTick();
        expect(apiStr.display.value).toBe('on');
        scope.stop();
    });
});
