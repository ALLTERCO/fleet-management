// UNIT: uploadVisualAsset is a thin wrapper around uploadAsset — returns
// the asset id on success, routes errors through onError (no throw).

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {uploadVisualAsset} from '@/helpers/uploadVisualAsset';

describe('uploadVisualAsset', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('returns the asset id on a successful upload', async () => {
        globalThis.fetch = vi.fn(
            async () =>
                new Response(JSON.stringify({id: 'asset-uuid-1'}), {
                    status: 200,
                    headers: {'Content-Type': 'application/json'}
                })
        ) as never;

        const id = await uploadVisualAsset({
            file: new File(['x'], 'icon.png', {type: 'image/png'}),
            label: 'icon',
            onError: () => {}
        });

        expect(id).toBe('asset-uuid-1');
    });

    it('routes upload errors to onError and returns null', async () => {
        globalThis.fetch = vi.fn(
            async () =>
                new Response(JSON.stringify({error: 'too big'}), {status: 413})
        ) as never;

        let captured = '';
        const id = await uploadVisualAsset({
            file: new File(['x'], 'icon.png', {type: 'image/png'}),
            onError: (msg) => {
                captured = msg;
            }
        });

        expect(id).toBeNull();
        expect(captured).toContain('too big');
    });
});
