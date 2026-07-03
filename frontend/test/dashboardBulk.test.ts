import {describe, expect, it, vi} from 'vitest';
import {
    collectSuccessfulRemovals,
    orderForBulkMove
} from '@/helpers/dashboardBulk';

describe('orderForBulkMove', () => {
    it('returns selected keys ascending by visible index for move-up', () => {
        const order = orderForBulkMove([1, 2, 3, 4], ['3', '2'], -1);
        expect(order).toEqual(['2', '3']);
    });

    it('returns selected keys descending by visible index for move-down', () => {
        const order = orderForBulkMove([1, 2, 3, 4], ['2', '3'], 1);
        expect(order).toEqual(['3', '2']);
    });

    it('regression: adjacent selection move-up no longer cancels itself out', () => {
        // Pre-fix behaviour: ['3', '2'] iterated as-given would swap 3↑ first,
        // then 2 (now at index 2) ↑ back into 3's old slot — net no-op.
        // Post-fix: sorts to ['2', '3'] so 2 moves up first, leaving 3 free.
        const order = orderForBulkMove([1, 2, 3, 4], ['3', '2'], -1);
        expect(order).toEqual(['2', '3']);
    });

    it('drops selected keys that are not in the visible list', () => {
        const order = orderForBulkMove([1, 2], ['1', '99'], -1);
        expect(order).toEqual(['1']);
    });

    it('returns an empty list when nothing is selected', () => {
        expect(orderForBulkMove([1, 2, 3], [], -1)).toEqual([]);
    });
});

describe('collectSuccessfulRemovals', () => {
    it('returns only the ids whose remove resolved true', async () => {
        const remove = vi.fn(async (id: number) => id !== 2);
        const ok = await collectSuccessfulRemovals([1, 2, 3], remove);
        expect(ok).toEqual([1, 3]);
        expect(remove).toHaveBeenCalledTimes(3);
    });

    it('regression: a single failure mid-loop does not lose the prior success', async () => {
        const remove = vi.fn(async (id: number) => id !== 2);
        const ok = await collectSuccessfulRemovals([1, 2, 3], remove);
        expect(ok).toContain(1);
        expect(ok).toContain(3);
        expect(ok).not.toContain(2);
    });

    it('returns an empty list when every removal fails', async () => {
        const remove = vi.fn(async () => false);
        const ok = await collectSuccessfulRemovals([1, 2], remove);
        expect(ok).toEqual([]);
    });

    it('returns an empty list when called with an empty input', async () => {
        const remove = vi.fn(async () => true);
        const ok = await collectSuccessfulRemovals([], remove);
        expect(ok).toEqual([]);
        expect(remove).not.toHaveBeenCalled();
    });
});
