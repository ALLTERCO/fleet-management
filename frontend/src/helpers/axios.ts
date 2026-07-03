import axios from 'axios';
import {FLEET_MANAGER_HTTP, LOGIN_PATH} from '@/constants';
import {getZitadelAuth} from '@/helpers/zitadelAuth';
import {isInRebootGrace} from '@/tools/websocket';

const apiClient = axios.create({
    baseURL: FLEET_MANAGER_HTTP
});

async function attachAuthToken(config: any): Promise<any> {
    let token =
        localStorage.getItem('dev_mode_token') ||
        sessionStorage.getItem('access_token');
    // Fallback before addUserLoaded writes sessionStorage: read from OIDC mgr.
    if (!token) {
        const zAuth = getZitadelAuth();
        if (zAuth) {
            const user = await zAuth.oidcAuth.mgr.getUser().catch(() => null);
            if (user?.access_token) token = user.access_token;
        }
    }
    if (token) config.headers.Authorization = `Bearer ${token}`;
    if (!config.headers['Content-Type'])
        config.headers['Content-Type'] = 'application/json';
    return config;
}

// OIDC manager is the source of truth — only redirect when it confirms
// the session is gone. A bare 401 is not enough.
async function handleUnauthorized(): Promise<void> {
    if (isInRebootGrace()) {
        console.warn(
            '[HTTP] 401 during reboot grace — skipping login redirect'
        );
        return;
    }
    const zAuth = getZitadelAuth();
    if (zAuth) {
        const user = await zAuth.oidcAuth.mgr.getUser().catch(() => null);
        const sessionLooksValid =
            !!user?.access_token &&
            (typeof user.expires_at !== 'number' ||
                user.expires_at * 1000 > Date.now());
        if (sessionLooksValid) {
            console.warn(
                '[HTTP] 401 with still-valid OIDC session — not redirecting'
            );
            return;
        }
        await zAuth.oidcAuth.mgr.removeUser().catch(() => {});
    }
    sessionStorage.removeItem('access_token');
    window.location.href = LOGIN_PATH;
}

function handleNetworkError(message: string) {
    console.warn('[HTTP] network error (backend unreachable):', message);
}

apiClient.interceptors.request.use(attachAuthToken, (error) =>
    Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response?.status === 401) await handleUnauthorized();
        if (!error.response) handleNetworkError(error.message);
        return Promise.reject(error);
    }
);

export default apiClient;
