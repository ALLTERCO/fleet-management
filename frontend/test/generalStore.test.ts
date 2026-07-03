import {createPinia, setActivePinia} from 'pinia';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {useGeneralStore} from '@/stores/general';
import {sendRPC} from '@/tools/websocket';

const getAll = vi.fn();

vi.mock('@/tools/websocket', () => ({
    getRegistry: vi.fn(() => ({getAll})),
    sendRPC: vi.fn()
}));

describe('general store reconnect handling', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        setActivePinia(createPinia());
        vi.useFakeTimers();
        vi.resetAllMocks();
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        errorSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('treats websocket reconnect setup failure as delayed work', async () => {
        getAll.mockRejectedValueOnce(new Error('WebSocket closed'));
        const store = useGeneralStore();

        await store.setup();

        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
            'setup delayed by reconnect',
            expect.any(Error)
        );
    });

    it('logs non-reconnect setup failures as errors', async () => {
        getAll.mockRejectedValueOnce(new Error('permission denied'));
        const store = useGeneralStore();

        await store.setup();

        expect(errorSpy).toHaveBeenCalledWith(
            'error in setup',
            expect.any(Error)
        );
    });

    it('uses backend-signed background URLs as the only protected media truth', async () => {
        getAll.mockResolvedValueOnce({
            backgroundImg: '/uploads/backgrounds/org-1/app_bg_10.png'
        });
        vi.mocked(sendRPC).mockResolvedValueOnce({
            thumbnails: [],
            originals: ['org-1/app_bg_10.png?assetToken=signed']
        });
        const store = useGeneralStore();

        await store.setup();

        expect(store.background).toBe(
            'http://localhost:3000/uploads/backgrounds/org-1/app_bg_10.png?assetToken=signed'
        );
    });

    it('does not repaint stale unsigned protected backgrounds', async () => {
        getAll.mockResolvedValueOnce({
            backgroundImg: '/uploads/backgrounds/app_bg_10.png'
        });
        vi.mocked(sendRPC).mockResolvedValueOnce({
            thumbnails: [],
            originals: ['org-1/app_bg_10.png?assetToken=signed']
        });
        const store = useGeneralStore();

        await store.setup();

        expect(store.background).toBe('');
    });
});
