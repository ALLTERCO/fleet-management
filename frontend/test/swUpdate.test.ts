import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const applyUpdate = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const registerSW = vi.hoisted(() => vi.fn());

vi.mock('virtual:pwa-register', () => ({
    registerSW
}));

vi.mock('@/tools/debug', () => ({
    debug: vi.fn()
}));

interface SwCallbacks {
    onNeedRefresh(): void;
    onOfflineReady(): void;
    onRegisteredSW(
        swUrl: string,
        registration?: {update: () => Promise<unknown>}
    ): void;
}

function setVisibleTab(): void {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible'
    });
    Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false
    });
}

describe('swUpdate activation policy', () => {
    let callbacks: SwCallbacks;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        applyUpdate.mockClear();
        registerSW.mockImplementation((nextCallbacks: SwCallbacks) => {
            callbacks = nextCallbacks;
            return applyUpdate;
        });
        sessionStorage.clear();
        window.history.pushState({}, '', '/devices');
        window.__FM_RUNTIME_CONFIG__ = {};
        setVisibleTab();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps a waiting update pending instead of reloading immediately', async () => {
        const swUpdate = await import('@/tools/swUpdate');

        swUpdate.initSwUpdate();
        callbacks.onNeedRefresh();

        expect(swUpdate.isUpdatePending()).toBe(true);
        expect(applyUpdate).not.toHaveBeenCalled();
    });

    it('activates a pending update on a safe navigation boundary', async () => {
        const swUpdate = await import('@/tools/swUpdate');

        swUpdate.initSwUpdate();
        callbacks.onNeedRefresh();

        expect(swUpdate.tryActivateUpdate('/devices')).toBe(true);
        await vi.waitFor(() => {
            expect(applyUpdate).toHaveBeenCalledWith(false);
        });
    });

    it('keeps a pending update blocked while a screen reports unsaved work', async () => {
        const swUpdate = await import('@/tools/swUpdate');

        swUpdate.initSwUpdate();
        callbacks.onNeedRefresh();
        const unregister = swUpdate.registerUpdateReloadBlocker(() => true);

        expect(swUpdate.tryActivateUpdate('/devices')).toBe(false);
        expect(applyUpdate).not.toHaveBeenCalled();

        unregister();
        expect(swUpdate.tryActivateUpdate('/devices')).toBe(true);
    });

    it('keeps a pending update blocked when a blocker cannot answer', async () => {
        const swUpdate = await import('@/tools/swUpdate');

        swUpdate.initSwUpdate();
        callbacks.onNeedRefresh();
        swUpdate.registerUpdateReloadBlocker(() => {
            throw new Error('dirty state unavailable');
        });

        expect(swUpdate.tryActivateUpdate('/devices')).toBe(false);
        expect(applyUpdate).not.toHaveBeenCalled();
    });

    it('does not activate updates during the OIDC callback route', async () => {
        const swUpdate = await import('@/tools/swUpdate');

        swUpdate.initSwUpdate();
        callbacks.onNeedRefresh();
        window.history.pushState({}, '', '/callback');

        expect(swUpdate.tryActivateUpdate('/devices')).toBe(false);
        expect(applyUpdate).not.toHaveBeenCalled();
    });

    it('does not reload when the tab regains focus', async () => {
        const swUpdate = await import('@/tools/swUpdate');

        swUpdate.initSwUpdate();
        callbacks.onRegisteredSW('/sw.js', {
            update: vi.fn(() => Promise.resolve())
        });
        callbacks.onNeedRefresh();
        applyUpdate.mockClear();

        document.dispatchEvent(new Event('visibilitychange'));

        expect(applyUpdate).not.toHaveBeenCalled();
    });

    it('does not reload on an idle timer while a pending update waits', async () => {
        const swUpdate = await import('@/tools/swUpdate');

        swUpdate.initSwUpdate();
        callbacks.onNeedRefresh();
        applyUpdate.mockClear();

        // Advance well past any plausible legacy idle-activation delay.
        vi.advanceTimersByTime(10 * 60_000);

        expect(applyUpdate).not.toHaveBeenCalled();
    });
});
