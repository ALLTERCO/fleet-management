// OIDC integration using oidc-client-ts directly (no @zitadel/vue wrapper).
// Exposes the same `oidcAuth` shape as the old wrapper so call sites are unchanged.

import {
    type User,
    UserManager,
    type UserManagerSettings,
    WebStorageStateStore
} from 'oidc-client-ts';
import {type Ref, ref} from 'vue';
import {debug} from '@/tools/debug';

interface AuthLifecycleHandlers {
    rotateToken: (accessToken: string) => Promise<void>;
    signOut: (reason: string) => Promise<void>;
}

let authLifecycleHandlers: AuthLifecycleHandlers | undefined;

export function setAuthLifecycleHandlers(
    handlers: AuthLifecycleHandlers
): void {
    authLifecycleHandlers = handlers;
}

async function signalSessionLost(reason: string): Promise<void> {
    await authLifecycleHandlers?.signOut(reason);
}

async function pushRotatedTokenToWs(accessToken: string): Promise<void> {
    await authLifecycleHandlers?.rotateToken(accessToken);
}

// Identity fingerprint = (issuer, client_id). When either side flips between
// page loads — e.g. the operator runs `deploy.sh down --volumes && up`, which
// regenerates Zitadel from scratch — every cached token, OIDC user record,
// and in-flight redirect state in the browser is bound to the *previous*
// issuer's signing keys and is therefore garbage. We detect that change here,
// before the UserManager opens its WebStorageStateStore against the fresh
// identity, so the SPA self-heals instead of throwing "Not authenticated"
// at the user until they manually wipe site data.
const IDENTITY_KEY = 'fm_oidc_identity';

function purgeStaleAuthState(reason: string): void {
    console.warn('[auth] purging stale auth state:', reason);
    sessionStorage.removeItem('access_token');
    localStorage.removeItem('dev_mode_token');
    localStorage.removeItem('dev_mode_refresh_token');
    localStorage.removeItem('dev_mode_username');
    localStorage.removeItem('_oidc_debug');
    for (const store of [localStorage, sessionStorage]) {
        for (let i = store.length - 1; i >= 0; i--) {
            const key = store.key(i);
            if (key?.startsWith('oidc.')) store.removeItem(key);
        }
    }
}

function reconcileOidcIdentity(authority: string, clientId: string): void {
    const current = `${authority}|${clientId}`;
    const recorded = localStorage.getItem(IDENTITY_KEY);
    if (recorded && recorded !== current) {
        purgeStaleAuthState(`identity changed: ${recorded} -> ${current}`);
    }
    // Missing recorded identity is treated as "first boot under this fix" —
    // record without purging so existing valid sessions survive the rollout.
    localStorage.setItem(IDENTITY_KEY, current);
}

interface OidcAuthShape {
    mgr: UserManager;
    events: UserManager['events'];
    isAuthenticated: boolean;
    userProfile: User['profile'] | null;
    accessToken: string | null;
    signIn: (to?: string) => Promise<void>;
    signOut: () => Promise<void>;
    startup: () => Promise<boolean>;
}

interface ZitadelAuthInstance {
    oidcAuth: OidcAuthShape;
    user: Ref<User | null>;
}

let instance: ZitadelAuthInstance | undefined;
let initPromise: Promise<ZitadelAuthInstance | undefined> | undefined;

export function initZitadelAuth(): Promise<ZitadelAuthInstance | undefined> {
    if (initPromise) return initPromise;

    const oidc = window.__FM_RUNTIME_CONFIG__?.oidc as
        | UserManagerSettings
        | undefined;

    // Dev mode (FM_DEV_MODE=true) or no OIDC in runtime config → skip Zitadel.
    if (window.__FM_RUNTIME_CONFIG__?.devMode || !oidc?.authority) {
        // Reconcile so switching away from OIDC purges prior issuer tokens.
        reconcileOidcIdentity('dev-mode', 'dev-mode');
        initPromise = Promise.resolve(undefined);
        return initPromise;
    }

    initPromise = (async () => {
        const projectResourceId =
            (oidc as unknown as {project_resource_id?: string})
                .project_resource_id ?? oidc.client_id!.split('@')[0];

        reconcileOidcIdentity(oidc.metadata!.issuer!, oidc.client_id!);

        const mgr = new UserManager({
            ...oidc,
            authority: oidc.metadata!.issuer!,
            client_id: oidc.client_id!,
            redirect_uri: oidc.redirect_uri!,
            post_logout_redirect_uri: oidc.post_logout_redirect_uri,
            response_type: 'code',
            scope:
                oidc.scope ??
                `openid profile email urn:zitadel:iam:org:project:id:${projectResourceId}:aud urn:zitadel:iam:org:projects:roles`,
            // Tab-scoped: tokens die on tab close.
            userStore: new WebStorageStateStore({store: sessionStorage}),
            automaticSilentRenew: true
        });

        const userRef = ref<User | null>(null);

        const oidcAuth: OidcAuthShape = {
            mgr,
            events: mgr.events,
            get isAuthenticated() {
                const u = userRef.value;
                return !!u && !u.expired && !!u.access_token;
            },
            get userProfile() {
                return userRef.value?.profile ?? null;
            },
            get accessToken() {
                return userRef.value?.access_token ?? null;
            },
            // Optional `to` is carried through the OIDC `state` so the
            // callback page can resume at the originally-requested path
            // (e.g. /api/docs) instead of dumping the user on the default.
            signIn: (to?: string) =>
                mgr.signinRedirect(to ? {state: {to}} : undefined),
            signOut: async () => {
                await mgr.signoutRedirect();
            },
            startup: async () => {
                const u = await mgr.getUser();
                userRef.value = u;
                return !!u && !u.expired;
            }
        };

        mgr.events.addUserLoaded((u) => {
            userRef.value = u;
            if (u.access_token) {
                sessionStorage.setItem('access_token', u.access_token);
            }
        });

        mgr.events.addUserUnloaded(() => {
            userRef.value = null;
            sessionStorage.removeItem('access_token');
        });

        mgr.events.addUserSignedOut(() => {
            userRef.value = null;
            sessionStorage.removeItem('access_token');
        });

        mgr.events.addAccessTokenExpiring(() => {
            debug('access token expiring — silent renew should handle');
        });

        mgr.events.addAccessTokenExpired(async () => {
            console.warn('access token expired — attempting silent renew');
            if (window.location.pathname === '/callback') return;
            try {
                const u = await mgr.signinSilent();
                if (u?.access_token) {
                    userRef.value = u;
                    sessionStorage.setItem('access_token', u.access_token);
                    await pushRotatedTokenToWs(u.access_token);
                    return;
                }
            } catch (err) {
                const msg = (err as Error)?.message || String(err);
                console.warn('silent renew failed:', msg);
                if (
                    msg.includes('Failed to fetch') ||
                    msg.includes('Network') ||
                    msg.includes('ERR_')
                ) {
                    return;
                }
            }
            await signalSessionLost('oidc-token-expired');
        });

        mgr.events.addSilentRenewError(async (err: Error) => {
            const msg = err?.message || String(err);
            console.warn('silent renew error:', msg);
            if (
                msg.includes('payload') ||
                msg.includes('expired') ||
                msg.includes('invalid')
            ) {
                await signalSessionLost('oidc-renew-error');
            }
        });

        instance = {oidcAuth, user: userRef};
        return instance;
    })();

    return initPromise;
}

export function getZitadelAuth(): ZitadelAuthInstance | undefined {
    return instance;
}
