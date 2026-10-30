import {beforeEach, describe, expect, it, vi} from 'vitest';

type EventHandler = (...args: any[]) => unknown;

const oidcMock = vi.hoisted(() => ({
    userLoadedHandlers: [] as EventHandler[],
    userUnloadedHandlers: [] as EventHandler[],
    userSignedOutHandlers: [] as EventHandler[],
    accessTokenExpiringHandlers: [] as EventHandler[],
    accessTokenExpiredHandlers: [] as EventHandler[],
    silentRenewErrorHandlers: [] as EventHandler[]
}));

vi.mock('oidc-client-ts', () => {
    class WebStorageStateStore {
        constructor(_settings: unknown) {}
    }

    class UserManager {
        events = {
            addUserLoaded: (cb: EventHandler) =>
                oidcMock.userLoadedHandlers.push(cb),
            addUserUnloaded: (cb: EventHandler) =>
                oidcMock.userUnloadedHandlers.push(cb),
            addUserSignedOut: (cb: EventHandler) =>
                oidcMock.userSignedOutHandlers.push(cb),
            addAccessTokenExpiring: (cb: EventHandler) =>
                oidcMock.accessTokenExpiringHandlers.push(cb),
            addAccessTokenExpired: (cb: EventHandler) =>
                oidcMock.accessTokenExpiredHandlers.push(cb),
            addSilentRenewError: (cb: EventHandler) =>
                oidcMock.silentRenewErrorHandlers.push(cb)
        };

        constructor(_settings: unknown) {}

        getUser = vi.fn(async () => null);
        signinRedirect = vi.fn(async () => undefined);
        signoutRedirect = vi.fn(async () => undefined);
        signinSilent = vi.fn(async () => null);
    }

    return {UserManager, WebStorageStateStore};
});

function oidcUser(accessToken: string) {
    return {
        access_token: accessToken,
        expired: false,
        profile: {sub: 'test-user'}
    };
}

async function loadAuthModule(path = '/dash/1') {
    window.__FM_RUNTIME_CONFIG__ = {
        devMode: false,
        oidc: {
            authority: 'https://issuer.example.test',
            client_id: 'fleet-client',
            project_resource_id: 'fleet-project',
            redirect_uri: 'https://fleet.example.test/callback',
            metadata: {issuer: 'https://issuer.example.test'}
        }
    };
    window.history.replaceState({}, '', path);
    return await import('@/helpers/zitadelAuth');
}

beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    localStorage.clear();
    for (const handlers of Object.values(oidcMock)) handlers.length = 0;
});

describe('Zitadel access-token lifecycle', () => {
    it('rotates the live websocket token when UserLoaded replaces an existing token', async () => {
        const {initZitadelAuth, setAuthLifecycleHandlers} =
            await loadAuthModule();
        const rotateToken = vi.fn(async () => undefined);
        const signOut = vi.fn(async () => undefined);
        setAuthLifecycleHandlers({rotateToken, signOut});
        await initZitadelAuth();

        const userLoaded = oidcMock.userLoadedHandlers.at(0)!;
        await userLoaded(oidcUser('access-token-1'));
        expect(sessionStorage.getItem('access_token')).toBe('access-token-1');
        expect(rotateToken).not.toHaveBeenCalled();

        await userLoaded(oidcUser('access-token-2'));
        await vi.waitFor(() => {
            expect(rotateToken).toHaveBeenCalledTimes(1);
        });
        expect(rotateToken).toHaveBeenCalledWith('access-token-2');
        expect(sessionStorage.getItem('access_token')).toBe('access-token-2');
        expect(signOut).not.toHaveBeenCalled();
    });

    it('does not turn a websocket rotation failure into an OIDC logout', async () => {
        const {initZitadelAuth, setAuthLifecycleHandlers} =
            await loadAuthModule();
        const rotateToken = vi.fn(async () => {
            throw new Error('websocket unavailable');
        });
        const signOut = vi.fn(async () => undefined);
        setAuthLifecycleHandlers({rotateToken, signOut});
        await initZitadelAuth();

        const userLoaded = oidcMock.userLoadedHandlers.at(0)!;
        await userLoaded(oidcUser('access-token-1'));
        await userLoaded(oidcUser('access-token-2'));

        await vi.waitFor(() => {
            expect(rotateToken).toHaveBeenCalledTimes(1);
        });
        expect(sessionStorage.getItem('access_token')).toBe('access-token-2');
        expect(signOut).not.toHaveBeenCalled();
    });

    it('does not rotate during the interactive callback before the websocket exists', async () => {
        const {initZitadelAuth, setAuthLifecycleHandlers} =
            await loadAuthModule('/callback');
        const rotateToken = vi.fn(async () => undefined);
        setAuthLifecycleHandlers({
            rotateToken,
            signOut: vi.fn(async () => undefined)
        });
        await initZitadelAuth();

        const userLoaded = oidcMock.userLoadedHandlers.at(0)!;
        await userLoaded(oidcUser('access-token-1'));
        await userLoaded(oidcUser('access-token-2'));

        expect(sessionStorage.getItem('access_token')).toBe('access-token-2');
        expect(rotateToken).not.toHaveBeenCalled();
    });
});
