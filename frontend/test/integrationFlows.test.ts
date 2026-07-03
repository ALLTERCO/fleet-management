// Honeycomb-shift integration tests: each one drives a real flow that
// touches at least two modules (store + transport, store + helper, or
// store + store). Mocks stop at the network boundary; everything above
// it runs as it does in production. Per Spotify/Kent C. Dodds: high-
// fidelity integration coverage is more valuable than mock-heavy unit
// stacks because the bugs that ship are usually at module seams.
//
// One test = one behaviour. Setup helpers stay small and named after
// what they accomplish; no test mutates state another test depends on.

import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/helpers/zitadelAuth', () => ({
    initZitadelAuth: vi.fn().mockResolvedValue(undefined),
    getZitadelAuth: vi.fn().mockReturnValue(undefined),
    setAuthLifecycleHandlers: vi.fn()
}));

vi.mock('@/tools/websocket', () => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    sendRPC: vi.fn(),
    onAlertEvent: vi.fn(() => () => undefined),
    onDashboardEvent: vi.fn(() => () => undefined),
    onLocationEvent: vi.fn(() => () => undefined),
    onJobEvent: vi.fn(() => () => undefined),
    onResyncRequired: vi.fn(() => () => undefined),
    onCertificateEvent: vi.fn(() => () => undefined),
    onCredentialEvent: vi.fn(() => () => undefined),
    onComponentEvent: vi.fn(() => () => undefined),
    onNotificationEvent: vi.fn(() => () => undefined),
    onWaitingRoomUpdated: vi.fn(() => () => undefined),
    onOtaProgress: vi.fn(() => () => undefined)
}));

vi.mock('@/tools/http', () => ({sendRPC: vi.fn()}));

import {rpcErrorMessage} from '@/helpers/rpcError';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {useAuthStore} from '@/stores/auth';
import {sendRPC} from '@/tools/http';

const mockedSendRPC = vi.mocked(sendRPC);

function bootstrapPayload(overrides: Record<string, unknown> = {}) {
    const permissions = {
        isAdmin: false,
        isPlatformAdmin: false,
        canWrite: false,
        uiCapabilities: {components: {}},
        ...overrides
    };
    return {
        serverTime: '2026-05-26T00:00:00.000Z',
        user: {
            username: 'test',
            organizationId: null,
            isAdmin: !!permissions.isAdmin
        },
        permissions,
        uiCapabilities: permissions.uiCapabilities,
        devices: {visible: false, items: [], total: 0},
        waitingRoom: {visible: false, pendingCount: 0, pending: {}},
        alerts: {visible: false, openCount: 0, criticalCount: 0}
    };
}

async function primeAuthFrom(payload: ReturnType<typeof bootstrapPayload>) {
    mockedSendRPC.mockResolvedValueOnce(payload);
    const auth = useAuthStore();
    // The store factory schedules handleLoginChanged(false) on mount when
    // Zitadel is mocked undefined, which flips status to 'unauthenticated'
    // and gates out fetchUserPermissions. Reset to 'booting' so the
    // integration tests can exercise the post-bootstrap state.
    auth.status = 'booting';
    await auth.fetchUserPermissions();
    return auth;
}

describe('integration: auth → permissions chain', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        mockedSendRPC.mockReset();
    });

    it('exposes isAdmin to useRpcPermissions after a bootstrap that grants admin', async () => {
        const auth = await primeAuthFrom(bootstrapPayload({isAdmin: true}));
        const rpc = useRpcPermissions();
        expect(auth.isAdmin).toBe(true);
        expect(rpc.canCall('User.CreateZitadelUser')).toBe(true);
    });

    it('denies provider-support-only RPCs to tenant admins', async () => {
        await primeAuthFrom(bootstrapPayload({isAdmin: true}));
        const rpc = useRpcPermissions();
        expect(rpc.canCall('Identity.ListIdentityProviders')).toBe(false);
    });

    it('lets a provider-support user reach instance-wide identity RPCs', async () => {
        await primeAuthFrom(
            bootstrapPayload({
                isAdmin: true,
                isPlatformAdmin: true
            })
        );
        const rpc = useRpcPermissions();
        expect(rpc.canCall('Identity.ListIdentityProviders')).toBe(true);
    });

    it('clears permissionsLoaded back to false on logout', async () => {
        const auth = await primeAuthFrom(bootstrapPayload({isAdmin: true}));
        expect(auth.permissionsLoaded).toBe(true);
        auth.logout();
        expect(auth.permissionsLoaded).toBe(false);
    });
});

describe('integration: RPC routing + error mapping', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        mockedSendRPC.mockReset();
    });

    it('surfaces a backend RPC error message through rpcErrorMessage', () => {
        const wireError = {
            message: 'permission denied',
            data: {code: 403}
        };
        expect(rpcErrorMessage(wireError, 'fallback')).toBe(
            'permission denied'
        );
    });

    it('preserves the device-coded RPC error shape for device commands', () => {
        const deviceError = {
            message: 'device rejected',
            data: {deviceMessage: 'wifi busy', deviceCode: 503}
        };
        const formatted = rpcErrorMessage(deviceError, 'fallback');
        expect(formatted).toContain('device rejected');
        expect(formatted).toContain('wifi busy');
        expect(formatted).toContain('503');
    });

    it('falls back to the supplied label when the error has no message', () => {
        expect(rpcErrorMessage({}, 'could not load')).toBe('could not load');
    });

    it('default-allows methods that are not owned by any permission rule', async () => {
        // Documented behavior — open by default for methods the registry
        // does not gate. Backend remains the source of truth for unknown
        // methods; the frontend just hides admin UI for known-gated ones.
        await primeAuthFrom(bootstrapPayload());
        const rpc = useRpcPermissions();
        expect(rpc.canCall('Made.Up.Method' as never)).toBe(true);
    });
});

describe('integration: bootstrap fallback + permission roll-over', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        mockedSendRPC.mockReset();
    });

    it('falls back to User.GetMe when Mobile.GetBootstrap fails', async () => {
        // First call (Mobile.GetBootstrap) throws; second call (User.GetMe)
        // returns a permission shape. permissionsLoaded must still flip true
        // and the permissions must come from the fallback response.
        mockedSendRPC
            .mockRejectedValueOnce(new Error('socket closed'))
            .mockResolvedValueOnce({isAdmin: true, canWrite: true});

        const auth = useAuthStore();
        auth.status = 'booting';
        await auth.fetchUserPermissions();

        expect(auth.permissionsLoaded).toBe(true);
        expect(auth.isAdmin).toBe(true);
        // Two RPCs were made: the failing primary + the fallback.
        expect(mockedSendRPC.mock.calls.length).toBe(2);
    });

    it('a fresh bootstrap after logout replaces stale permissions, not merges them', async () => {
        // First login: admin. Logout. Second login: viewer. The viewer
        // session must not retain admin-only canCall results from the
        // previous session — proves the permission state is fully owned
        // by the latest fetch, not merged.
        const auth = await primeAuthFrom(bootstrapPayload({isAdmin: true}));
        const rpc = useRpcPermissions();
        expect(rpc.canCall('User.CreateZitadelUser')).toBe(true);

        auth.logout();
        expect(auth.permissionsLoaded).toBe(false);

        mockedSendRPC.mockResolvedValueOnce(
            bootstrapPayload({isAdmin: false, canWrite: false})
        );
        auth.status = 'booting';
        await auth.fetchUserPermissions();

        expect(auth.isAdmin).toBe(false);
        expect(rpc.canCall('User.CreateZitadelUser')).toBe(false);
    });
});
