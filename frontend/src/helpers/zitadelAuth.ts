import type {createZITADELAuth} from '@zitadel/vue';
import {RESOLVED_OIDC_CONFIG, USE_LOGIN_ZITADEL} from '@/constants';

type ZitadelAuthInstance = ReturnType<typeof createZITADELAuth>;

// Lazy-initialized to avoid TDZ errors caused by chunk evaluation order.
// @zitadel/vue and oidc-client are loaded via dynamic import() so they
// resolve after all static chunks are ready.
let zitadelAuth: ZitadelAuthInstance | undefined;
let initPromise: Promise<ZitadelAuthInstance | undefined> | undefined;

/**
 * Initialize the Zitadel auth instance (idempotent).
 * Call this once at app startup (main.ts). All subsequent calls return
 * the same promise / cached instance.
 */
export function initZitadelAuth(): Promise<ZitadelAuthInstance | undefined> {
    if (initPromise) return initPromise;

    if (!USE_LOGIN_ZITADEL) {
        initPromise = Promise.resolve(undefined);
        return initPromise;
    }

    initPromise = (async () => {
        const [{createZITADELAuth}, {WebStorageStateStore}] = await Promise.all([
            import('@zitadel/vue'),
            import('oidc-client')
        ]);

        const zitadelConfig = {
            project_resource_id:
                (RESOLVED_OIDC_CONFIG as any).project_resource_id ||
                RESOLVED_OIDC_CONFIG.client_id!.split('@')[0],
            client_id: RESOLVED_OIDC_CONFIG.client_id!,
            issuer: RESOLVED_OIDC_CONFIG.metadata!.issuer!
        };

        zitadelAuth = createZITADELAuth(
            zitadelConfig,
            undefined,
            undefined,
            undefined,
            {
                ...RESOLVED_OIDC_CONFIG,
                userStore: new WebStorageStateStore({store: localStorage})
            }
        );

        // handle events
        zitadelAuth.oidcAuth.events.addAccessTokenExpiring(() => {
            console.debug('access token expiring — silent renew should handle this');
        });

        zitadelAuth.oidcAuth.events.addAccessTokenExpired(() => {
            console.warn('access token expired — clearing session');
            localStorage.removeItem('access_token');
            window.location.href = '/login';
        });

        zitadelAuth.oidcAuth.events.addSilentRenewError((err: Error) => {
            console.error('silent renew error — clearing session', err);
            localStorage.removeItem('access_token');
            window.location.href = '/login';
        });

        zitadelAuth.oidcAuth.events.addUserLoaded((user) => {
            console.debug('user loaded — syncing access token');
            if (user.access_token) {
                localStorage.setItem('access_token', user.access_token);
            }
        });

        zitadelAuth.oidcAuth.events.addUserUnloaded(() => {
            console.debug('user unloaded');
            localStorage.removeItem('access_token');
        });

        zitadelAuth.oidcAuth.events.addUserSignedOut(() => {
            console.debug('user signed out');
            localStorage.removeItem('access_token');
        });

        zitadelAuth.oidcAuth.events.addUserSessionChanged(() => {
            console.debug('user session changed');
        });

        return zitadelAuth;
    })();

    return initPromise;
}

/**
 * Get the current Zitadel auth instance (synchronous).
 * Returns undefined until initZitadelAuth() has resolved.
 */
export function getZitadelAuth(): ZitadelAuthInstance | undefined {
    return zitadelAuth;
}
