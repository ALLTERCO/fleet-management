import {getZitadelAuth} from '@/helpers/zitadelAuth';
import {RPC_URL} from '../constants';

// Same priority order as helpers/axios.ts so HTTP and axios paths agree.
const DEV_MODE_TOKEN_KEY = 'dev_mode_token';
const ACCESS_TOKEN_KEY = 'access_token';

async function getAccessToken(): Promise<string | null> {
    // dev_mode_token: localStorage (cross-tab for dev). access_token:
    // sessionStorage (tab-scoped, XSS-resistant).
    const devToken = localStorage.getItem(DEV_MODE_TOKEN_KEY);
    if (devToken) return devToken;

    // Synced by addUserLoaded; closes the isAuthenticated/mgr.getUser race.
    const cachedToken = sessionStorage.getItem(ACCESS_TOKEN_KEY);
    if (cachedToken) return cachedToken;

    if (window.__FM_RUNTIME_CONFIG__?.devMode) return null;

    // Fallback if addUserLoaded hasn't fired yet.
    const zitadelAuth = getZitadelAuth();
    if (!zitadelAuth) return null;
    const user = await zitadelAuth.oidcAuth.mgr.getUser().catch(() => null);
    return user?.access_token ?? null;
}

/**
 * Send an RPC request to the backend
 * Note: For User.Authenticate in dev mode, we don't require a token
 */
export async function sendRPC(
    method: string,
    params: object | null = null,
    dst?: string | string[]
) {
    // For authentication request, don't require token
    if (method === 'User.Authenticate') {
        const res = await fetch(RPC_URL, {
            method: 'POST',
            mode: 'same-origin',
            credentials: 'omit',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                method,
                params
            })
        });

        if (!res.ok) {
            const text = await res.text();
            try {
                const parsed = JSON.parse(text);
                return Promise.reject(
                    parsed.error || {code: res.status, message: text}
                );
            } catch {
                return Promise.reject({
                    code: res.status,
                    message: text || `HTTP ${res.status}`
                });
            }
        }

        const resp = await res.json();
        if (resp.error) return Promise.reject(resp.error);
        return resp;
    }

    const token = await getAccessToken();

    if (!token) {
        return Promise.reject({code: 401, message: 'Not authenticated'});
    }

    const res = await fetch(RPC_URL, {
        method: 'POST',
        mode: 'same-origin',
        credentials: 'omit',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            method,
            params,
            ...(dst ? {dst} : {})
        })
    });

    if (!res.ok) {
        // Try to read JSON error body — backend returns error details even on non-200
        try {
            const body = await res.json();
            if (body?.error) return Promise.reject(body.error);
        } catch {
            // Non-JSON response (e.g., HTML error page) — fall through to generic error
        }
        return Promise.reject({
            code: res.status,
            message: `HTTP ${res.status}: ${res.statusText}`
        });
    }

    const resp = await res.json();
    if (resp.error) return Promise.reject(resp.error);
    return resp;
}
