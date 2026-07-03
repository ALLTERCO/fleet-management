// Sanitises oidc-client-ts storage to prevent the library from crashing
// on a malformed JWT cached from a previous deployment.
import {LOGIN_PATH} from '@/constants';

const OIDC_USER_KEY_PREFIX = 'oidc.user:';
const ACCESS_TOKEN_KEY = 'access_token';
const PAYLOAD_ERROR_FRAGMENT = "reading 'payload'";

function isValidJwt(token: unknown): boolean {
    if (typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = JSON.parse(atob(b64));
        return typeof json === 'object' && json !== null;
    } catch {
        return false;
    }
}

function isCorruptOidcEntry(key: string, raw: string | null): boolean {
    if (key === ACCESS_TOKEN_KEY) return !isValidJwt(raw);
    if (!key.startsWith(OIDC_USER_KEY_PREFIX)) return false;
    try {
        const parsed = raw ? JSON.parse(raw) : null;
        return (
            !isValidJwt(parsed?.access_token) && !isValidJwt(parsed?.id_token)
        );
    } catch {
        return true;
    }
}

// Scans both storage backings: oidc-client-ts now uses sessionStorage
// for the `oidc.user:*` payload and we mirror `access_token` there too;
// pre-migration tabs may still have legacy entries in localStorage, so
// purge both so a stale corrupt JWT can't keep crashing the SPA.
export function purgeCorruptOidcStorage(): string[] {
    const removed: string[] = [];
    for (const store of [localStorage, sessionStorage]) {
        for (let i = store.length - 1; i >= 0; i--) {
            const key = store.key(i);
            if (!key) continue;
            if (
                key !== ACCESS_TOKEN_KEY &&
                !key.startsWith(OIDC_USER_KEY_PREFIX)
            ) {
                continue;
            }
            if (isCorruptOidcEntry(key, store.getItem(key))) {
                store.removeItem(key);
                removed.push(key);
            }
        }
    }
    return removed;
}

export function installCorruptTokenTrap(): void {
    window.addEventListener('unhandledrejection', (ev) => {
        const msg = ev.reason?.message || String(ev.reason);
        if (!msg.includes(PAYLOAD_ERROR_FRAGMENT)) return;
        ev.preventDefault();
        purgeCorruptOidcStorage();
        window.location.href = LOGIN_PATH;
    });
}
