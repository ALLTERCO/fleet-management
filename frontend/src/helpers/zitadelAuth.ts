import {createZITADELAuth, type ZITADELConfig} from '@zitadel/vue';
import {
    type User,
    UserManagerSettings,
    WebStorageStateStore
} from 'oidc-client';
import {RESOLVED_OIDC_CONFIG, USE_LOGIN_ZITADEL} from '@/constants';

let zitadelAuth: ReturnType<typeof createZITADELAuth> | undefined = undefined;

if (USE_LOGIN_ZITADEL) {
    const zitadelConfig: ZITADELConfig = {
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
        // eslint-disable-next-line no-console
        console.log('access token expiring');
    });

    zitadelAuth.oidcAuth.events.addAccessTokenExpired(() => {
        // eslint-disable-next-line no-console
        console.log('access token expired');
    });

    zitadelAuth.oidcAuth.events.addSilentRenewError((err: Error) => {
        // eslint-disable-next-line no-console
        console.error('silent renew error', err);
    });

    zitadelAuth.oidcAuth.events.addUserLoaded((_user: User) => {
        // eslint-disable-next-line no-console
        console.debug('user loaded');
    });

    zitadelAuth.oidcAuth.events.addUserUnloaded(() => {
        // eslint-disable-next-line no-console
        console.log('user unloaded');
    });

    zitadelAuth.oidcAuth.events.addUserSignedOut(() => {
        // eslint-disable-next-line no-console
        console.log('user signed out');
    });

    zitadelAuth.oidcAuth.events.addUserSessionChanged(() => {
        // eslint-disable-next-line no-console
        console.log('user session changed');
    });
}

export default zitadelAuth;
