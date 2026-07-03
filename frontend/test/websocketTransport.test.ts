import {beforeEach, describe, expect, it, vi} from 'vitest';

const httpSendRPC = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());

vi.mock('@/tools/http', () => ({
    sendRPC: httpSendRPC
}));

vi.mock('@/helpers/zitadelAuth', () => ({
    getZitadelAuth: () => null
}));

vi.mock('@/tools/websocketStores', () => ({
    getConnectStores: () => ({
        pinia: {},
        devicesStore: {},
        entitiesStore: {},
        logStore: {}
    }),
    getOnConnectStores: () => ({
        pinia: {},
        devicesStore: {
            refreshDevicesInBackground: vi.fn()
        },
        entityStore: {
            fetchEntities: vi.fn()
        },
        groupsStore: {
            fetchGroups: vi.fn()
        }
    }),
    getResyncStores: () => ({
        pinia: {},
        authStore: {
            fetchUserPermissions: vi.fn(),
            loggedIn: true,
            signOut
        },
        devicesStore: {
            fetchDevices: vi.fn()
        },
        jobsStore: {
            restoreActive: vi.fn()
        }
    })
}));

type SocketHandler = ((event?: unknown) => void) | null;

class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];

    readyState = FakeWebSocket.CONNECTING;
    onopen: SocketHandler = null;
    onclose: SocketHandler = null;
    onerror: SocketHandler = null;
    onmessage: ((event: {data: string}) => void) | null = null;
    readonly sent: unknown[] = [];
    private readonly listeners = new Map<string, Set<SocketHandler>>();
    private readonly responseOverrides = new Map<string, {error: unknown}>();

    constructor() {
        FakeWebSocket.instances.push(this);
    }

    addEventListener(event: string, handler: SocketHandler): void {
        const handlers = this.listeners.get(event) ?? new Set<SocketHandler>();
        handlers.add(handler);
        this.listeners.set(event, handlers);
    }

    removeEventListener(event: string, handler: SocketHandler): void {
        this.listeners.get(event)?.delete(handler);
    }

    open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
        this.emit('open');
    }

    send(payload: string): void {
        const message = JSON.parse(payload);
        this.sent.push(message);
        if (typeof message.id !== 'number') return;
        queueMicrotask(() => {
            const response = this.responseFor(message);
            this.onmessage?.({
                data: JSON.stringify({
                    jsonrpc: '2.0',
                    id: message.id,
                    src: 'FLEET_MANAGER',
                    dst: 'FLEET_MANAGER_UI',
                    ...(isRpcError(response)
                        ? {error: response.error}
                        : {result: response})
                })
            });
        });
    }

    private responseFor(message: {method: string; params?: unknown}): unknown {
        const override = this.responseOverrides.get(message.method);
        if (override) return override;
        if (message.method === 'System.Subscribe') return {ids: [42]};
        return {};
    }

    rejectNextRpc(method: string, error: unknown): void {
        this.responseOverrides.set(method, {error});
    }

    private emit(event: string): void {
        for (const handler of this.listeners.get(event) ?? []) {
            handler?.();
        }
    }
}

function isRpcError(response: unknown): response is {error: unknown} {
    return (
        !!response &&
        typeof response === 'object' &&
        'error' in response
    );
}

describe('websocket transport RPCs', () => {
    beforeEach(() => {
        vi.resetModules();
        httpSendRPC.mockReset();
        signOut.mockReset();
        localStorage.clear();
        sessionStorage.clear();
        FakeWebSocket.instances = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
    });

    it('sends temporary subscriptions over websocket only', async () => {
        localStorage.setItem('dev_mode_token', 'dev-token');
        const ws = await import('@/tools/websocket');

        const subscriptionPromise = ws.addTemporarySubscription(['dev-1']);
        await vi.waitFor(() => {
            expect(FakeWebSocket.instances).toHaveLength(1);
        });
        FakeWebSocket.instances[0].open();

        const subscription = await subscriptionPromise;
        await subscription.unsubscribe();

        const sentMethods = FakeWebSocket.instances[0].sent.map(
            (message) => (message as {method: string}).method
        );
        expect(sentMethods).toContain('System.Subscribe');
        expect(sentMethods).toContain('System.Unsubscribe');
        expect(httpSendRPC).not.toHaveBeenCalled();
    });

    it('does not fall back to HTTP for websocket-only subscriptions', async () => {
        const ws = await import('@/tools/websocket');

        await expect(ws.addTemporarySubscription(['dev-1'])).rejects.toThrow(
            'System.Subscribe requires an active websocket connection'
        );
        expect(httpSendRPC).not.toHaveBeenCalled();
    });

    it('does not fall back to HTTP when unsubscribing after websocket close', async () => {
        localStorage.setItem('dev_mode_token', 'dev-token');
        const ws = await import('@/tools/websocket');

        const subscriptionPromise = ws.addTemporarySubscription(['dev-1']);
        await vi.waitFor(() => {
            expect(FakeWebSocket.instances).toHaveLength(1);
        });
        const socket = FakeWebSocket.instances[0];
        socket.open();
        const subscription = await subscriptionPromise;
        socket.readyState = FakeWebSocket.CLOSED;

        await subscription.unsubscribe();

        const sentMethods = socket.sent.map(
            (message) => (message as {method: string}).method
        );
        expect(sentMethods).not.toContain('System.Unsubscribe');
        expect(httpSendRPC).not.toHaveBeenCalled();
    });

    it('runs auth recovery when a websocket RPC returns 401', async () => {
        localStorage.setItem('dev_mode_token', 'dev-token');
        const ws = await import('@/tools/websocket');

        const connectPromise = ws.connect();
        await vi.waitFor(() => {
            expect(FakeWebSocket.instances).toHaveLength(1);
        });
        const socket = FakeWebSocket.instances[0];
        socket.open();
        await connectPromise;
        socket.rejectNextRpc('device.list', {
            code: 401,
            message: 'Not authenticated'
        });

        await expect(
            ws.sendRPC('FLEET_MANAGER', 'device.list')
        ).rejects.toMatchObject({
            code: 401,
            method: 'device.list'
        });
        await vi.waitFor(() => {
            expect(signOut).toHaveBeenCalledWith('ws-4401');
        });
    });
});
