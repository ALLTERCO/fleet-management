import {beforeEach, describe, expect, it, vi} from 'vitest';

type MockUser = {
    access_token: string;
    refresh_token?: string;
    expired: boolean;
    profile: {sub: string};
};

const oidc = vi.hoisted(() => ({
    saved: null as MockUser | null,
    renewed: null as MockUser | null,
    failure: null as Error | null,
    silentCalls: 0
}));

vi.mock('oidc-client-ts', () => ({
    WebStorageStateStore: class {
        constructor(_settings: unknown) {}
    },
    UserManager: class {
        events = {
            addUserLoaded: vi.fn(),
            addUserUnloaded: vi.fn(),
            addUserSignedOut: vi.fn(),
            addAccessTokenExpiring: vi.fn(),
            addAccessTokenExpired: vi.fn(),
            addSilentRenewError: vi.fn()
        };
        constructor(_settings: unknown) {}
        getUser = vi.fn(async () => oidc.saved);
        signinSilent = vi.fn(async () => {
            oidc.silentCalls++;
            if (oidc.failure) throw oidc.failure;
            if (oidc.renewed) oidc.saved = oidc.renewed;
            return oidc.renewed;
        });
    }
}));

function user(token: string, expired: boolean, refreshToken?: string): MockUser {
    return {
        access_token: token,
        refresh_token: refreshToken,
        expired,
        profile: {sub: 'test-user'}
    };
}

async function loadAuth(path = '/dash') {
    window.history.replaceState({}, '', path);
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
    const {initZitadelAuth} = await import('@/helpers/zitadelAuth');
    const auth = await initZitadelAuth();
    if (!auth) throw new Error('Expected the OIDC manager');
    return auth;
}

beforeEach(() => {
    vi.resetModules();
    oidc.saved = null;
    oidc.renewed = null;
    oidc.failure = null;
    oidc.silentCalls = 0;
    localStorage.clear();
    sessionStorage.clear();
});

describe('OIDC session restoration after reload', () => {
    it('renews an expired stored user with a refresh grant before routing', async () => {
        oidc.saved = user('expired-token', true, 'refresh-grant');
        oidc.renewed = user('new-token', false, 'rotated-grant');
        const auth = await loadAuth();

        expect(await auth.oidcAuth.startup()).toBe(true);
        expect(oidc.silentCalls).toBe(1);
        expect(auth.oidcAuth.isAuthenticated).toBe(true);
        expect(auth.oidcAuth.accessToken).toBe('new-token');
        expect(sessionStorage.getItem('access_token')).toBe('new-token');
    });

    it('does not attempt an unsupported refresh grant', async () => {
        oidc.saved = user('expired-token', true);
        sessionStorage.setItem('access_token', 'expired-token');
        const auth = await loadAuth();

        expect(await auth.oidcAuth.startup()).toBe(false);
        expect(oidc.silentCalls).toBe(0);
        expect(sessionStorage.getItem('access_token')).toBeNull();
    });

    it('retains a recoverable cached user after a temporary renew failure', async () => {
        oidc.saved = user('expired-token', true, 'refresh-grant');
        oidc.failure = new Error('temporary network failure');
        const auth = await loadAuth();

        expect(await auth.oidcAuth.startup()).toBe(false);
        expect(oidc.silentCalls).toBe(1);
        expect(oidc.saved?.refresh_token).toBe('refresh-grant');
        expect(sessionStorage.getItem('access_token')).toBeNull();
    });

    it('does not compete with an interactive callback on reload', async () => {
        oidc.saved = user('expired-token', true, 'refresh-grant');
        const auth = await loadAuth('/callback');

        expect(await auth.oidcAuth.startup()).toBe(false);
        expect(oidc.silentCalls).toBe(0);
    });

    it('restores an unexpired user without any refresh request', async () => {
        oidc.saved = user('current-token', false, 'refresh-grant');
        const auth = await loadAuth();

        expect(await auth.oidcAuth.startup()).toBe(true);
        expect(oidc.silentCalls).toBe(0);
        expect(sessionStorage.getItem('access_token')).toBe('current-token');
    });
});
