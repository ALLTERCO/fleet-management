import {describe, expect, it, vi} from 'vitest';
import {paginate} from '@/helpers/pagination';

describe('paginate', () => {
    it('returns all items across multiple pages', async () => {
        const fetchPage = vi.fn(async (offset: number) => {
            if (offset === 0)
                return {
                    items: Array.from({length: 100}, (_, i) => i + 1),
                    has_more: true
                };
            if (offset === 100)
                return {
                    items: Array.from({length: 100}, (_, i) => offset + i + 1),
                    has_more: true
                };
            return {items: [201, 202], has_more: false};
        });
        const all = await paginate(fetchPage, 100);
        expect(all.length).toBe(202);
        expect(all[0]).toBe(1);
        expect(all[201]).toBe(202);
        expect(fetchPage).toHaveBeenCalledTimes(3);
    });

    it('breaks on has_more: false even with full page', async () => {
        const fetchPage = vi.fn(async () => ({
            items: Array.from({length: 50}, (_, i) => i),
            has_more: false
        }));
        const all = await paginate(fetchPage, 50);
        expect(all.length).toBe(50);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('breaks when items.length < pageSize (defensive — backend bug protection)', async () => {
        const fetchPage = vi.fn(async () => ({
            items: [1, 2, 3],
            has_more: true // Backend lie: has_more but items < pageSize
        }));
        const all = await paginate(fetchPage, 100);
        expect(all).toEqual([1, 2, 3]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it('returns empty for empty first page', async () => {
        const fetchPage = vi.fn(async () => ({items: [], has_more: false}));
        const all = await paginate(fetchPage, 100);
        expect(all).toEqual([]);
    });

    it('propagates fetchPage errors', async () => {
        const fetchPage = vi.fn(async () => {
            throw new Error('rpc failed');
        });
        await expect(paginate(fetchPage, 100)).rejects.toThrow('rpc failed');
    });
});
