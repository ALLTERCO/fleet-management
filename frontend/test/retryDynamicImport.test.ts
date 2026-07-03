import {describe, expect, it, vi} from 'vitest';
import {retryDynamicImport} from '@/tools/retryDynamicImport';

describe('retryDynamicImport — bounded retry around a transient loader', () => {
    it('returns the loader result immediately when the first attempt succeeds', async () => {
        const loader = vi.fn(() => Promise.resolve('ok'));
        const result = await retryDynamicImport(loader);
        expect(result).toBe('ok');
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('retries up to the configured count and then rethrows so the caller can reload', async () => {
        const loader = vi.fn(() => Promise.reject(new Error('blip')));
        await expect(
            retryDynamicImport(loader, {retries: 2, backoffMs: 1})
        ).rejects.toThrow('blip');
        expect(loader).toHaveBeenCalledTimes(3);
    });

    it('stops retrying as soon as one attempt succeeds so a recovered network is not poked further', async () => {
        let calls = 0;
        const loader = vi.fn(() => {
            calls += 1;
            return calls < 2 ? Promise.reject(new Error('blip')) : Promise.resolve('ok');
        });
        const result = await retryDynamicImport(loader, {retries: 5, backoffMs: 1});
        expect(result).toBe('ok');
        expect(loader).toHaveBeenCalledTimes(2);
    });
});
