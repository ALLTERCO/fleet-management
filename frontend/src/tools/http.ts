import {getZitadelAuth} from '@/helpers/zitadelAuth';
import {FLEET_MANAGER_HTTP} from '../constants';

// Dev mode token storage key (same as in auth store)
const DEV_MODE_TOKEN_KEY = 'dev_mode_token';

/**
 * Check if we're in dev mode by looking for dev mode token
 */
function isDevMode(): boolean {
    return !!localStorage.getItem(DEV_MODE_TOKEN_KEY);
}

/**
 * Get the current access token (supports both Zitadel and dev mode)
 */
async function getAccessToken(): Promise<string | null> {
    // Check for dev mode token first
    const devModeToken = localStorage.getItem(DEV_MODE_TOKEN_KEY);
    if (devModeToken) {
        return devModeToken;
    }

    // Fall back to Zitadel
    const zitadelAuth = getZitadelAuth();
    if (!zitadelAuth) {
        console.error('Zitadel auth not initialized');
        return null;
    }

    const user = await zitadelAuth.oidcAuth.mgr.getUser();
    return user?.access_token ?? null;
}

/**
 * Send an RPC request to the backend
 * Note: For User.Authenticate in dev mode, we don't require a token
 */
export async function sendRPC(method: string, params: object | null = null) {
    // For authentication request, don't require token
    if (method === 'User.Authenticate') {
        const resp = await fetch(FLEET_MANAGER_HTTP + '/rpc', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                method,
                params
            })
        }).then((res) => res.json());

        if (resp.error) return Promise.reject(resp.error);
        return resp;
    }

    const token = await getAccessToken();

    if (!token) {
        return Promise.reject({code: 401, message: 'Not authenticated'});
    }

    const resp = await fetch(FLEET_MANAGER_HTTP + '/rpc', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
        },
        body: JSON.stringify({
            method,
            params
        })
    }).then((res) => res.json());

    if (resp.error) return Promise.reject(resp.error);
    return resp;
}
