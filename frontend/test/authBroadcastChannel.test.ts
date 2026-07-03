import {createPinia, setActivePinia} from 'pinia';
import {afterEach, describe, expect, it, vi} from 'vitest';

type MessageListener = (event: {data: unknown}) => void;

class FakeBroadcastChannel {
    static readonly listeners = new Set<MessageListener>();
    static readonly instances: FakeBroadcastChannel[] = [];

    constructor(readonly name: string) {
        FakeBroadcastChannel.instances.push(this);
    }

    addEventListener(type: string, listener: MessageListener): void {
        if (type === 'message') FakeBroadcastChannel.listeners.add(listener);
    }

    postMessage(data: unknown): void {
        for (const listener of FakeBroadcastChannel.listeners) listener({data});
    }

    close(): void {}
}

describe('auth store cross-tab channel', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
        vi.clearAllMocks();
        FakeBroadcastChannel.listeners.clear();
        FakeBroadcastChannel.instances.length = 0;
    });

    it('registers one BroadcastChannel listener for repeated store instances', async () => {
        vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
        vi.doMock('@/tools/websocket', () => ({
            connect: vi.fn().mockResolvedValue(undefined),
            close: vi.fn()
        }));
        vi.doMock('@/tools/http', () => ({
            sendRPC: vi.fn()
        }));
        vi.doMock('@/helpers/zitadelAuth', () => ({
            initZitadelAuth: vi.fn().mockResolvedValue(undefined),
            getZitadelAuth: vi.fn().mockReturnValue(undefined),
            setAuthLifecycleHandlers: vi.fn()
        }));

        const {useAuthStore} = await import('@/stores/auth');

        for (let index = 0; index < 12; index += 1) {
            setActivePinia(createPinia());
            useAuthStore();
        }

        expect(FakeBroadcastChannel.listeners.size).toBe(1);
    });

    it('ignores malformed broadcast payloads', async () => {
        vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
        vi.doMock('@/tools/websocket', () => ({
            connect: vi.fn().mockResolvedValue(undefined),
            close: vi.fn()
        }));
        vi.doMock('@/tools/http', () => ({
            sendRPC: vi.fn()
        }));
        vi.doMock('@/helpers/zitadelAuth', () => ({
            initZitadelAuth: vi.fn().mockResolvedValue(undefined),
            getZitadelAuth: vi.fn().mockReturnValue(undefined),
            setAuthLifecycleHandlers: vi.fn()
        }));

        const {useAuthStore} = await import('@/stores/auth');
        setActivePinia(createPinia());
        useAuthStore();
        const [channel] = FakeBroadcastChannel.instances;

        expect(() => channel.postMessage(null)).not.toThrow();
        expect(() => channel.postMessage('bad-shape')).not.toThrow();
    });
});
