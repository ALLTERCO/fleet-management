// Tests the catalog composable's error + retry path. Previously a fetch
// failure was silently swallowed by `void ensureLoaded()` callers,
// leaving the picker with an empty list and no error message.

import {describe, expect, it, vi} from 'vitest';

// Hoisted mock for sendRPC — set up BEFORE the SUT module is evaluated
// so its `import * as ws from '@/tools/websocket'` picks up the stub.
const sendRPC = vi.hoisted(() => vi.fn());

vi.mock('@/tools/websocket', () => ({sendRPC}));

const {useGroupKinds} = await import('@/composables/useGroupKinds');

const CATALOG_FIXTURE = {
    items: [
        {
            id: 'manual',
            displayName: 'Custom Group',
            description: 'fallback',
            category: 'general',
            icon: 'fa-folder',
            metadataSchema: {type: 'object'},
            sortOrder: 0
        }
    ]
};

describe('useGroupKinds — error path', () => {
    it('captures the error message on fetch failure (no silent swallow)', async () => {
        sendRPC.mockReset();
        sendRPC.mockRejectedValueOnce(new Error('WS disconnected'));
        const {ensureLoaded, loadError, loadedOnce} = useGroupKinds();
        await ensureLoaded();
        expect(loadError.value).toBe('WS disconnected');
        expect(loadedOnce.value).toBe(false);
    });

    it('retry() clears the error and refetches', async () => {
        sendRPC.mockReset();
        sendRPC
            .mockRejectedValueOnce(new Error('WS disconnected'))
            .mockResolvedValueOnce(CATALOG_FIXTURE);
        const {ensureLoaded, retry, loadError, loadedOnce, kinds} =
            useGroupKinds();
        await ensureLoaded();
        expect(loadError.value).toBe('WS disconnected');
        await retry();
        expect(loadError.value).toBe(null);
        expect(loadedOnce.value).toBe(true);
        expect(kinds.value.length).toBeGreaterThan(0);
    });

    it('ensureLoaded after a successful fetch is a no-op (cache hit)', async () => {
        // Cache is shared across the whole test file (module-level). After
        // the prior test loaded the catalog, this call should NOT hit the
        // network — that's the whole point of the lazy cache.
        sendRPC.mockReset();
        const {ensureLoaded} = useGroupKinds();
        await ensureLoaded();
        await ensureLoaded();
        await ensureLoaded();
        expect(sendRPC).not.toHaveBeenCalled();
    });
});
