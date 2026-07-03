import {registerSW} from 'virtual:pwa-register';
import {SW_UPDATE_POLL_INTERVAL_MS} from '@/constants';
import {debug} from './debug';

let updatePending = false;
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | undefined;
const updateReloadBlockers = new Set<() => boolean>();

export function isUpdatePending(): boolean {
    return updatePending;
}

export function registerUpdateReloadBlocker(blocker: () => boolean): () => void {
    updateReloadBlockers.add(blocker);
    return () => updateReloadBlockers.delete(blocker);
}

// Guards against reload loops on browsers where skipWaiting is broken
// (e.g. Wall Display Android WebView).
const SW_RELOAD_KEY = 'sw_update_reload';

export function activateUpdate(targetUrl: string): void {
    if (sessionStorage.getItem(SW_RELOAD_KEY)) {
        sessionStorage.removeItem(SW_RELOAD_KEY);
        updatePending = false;
        return;
    }
    sessionStorage.setItem(SW_RELOAD_KEY, '1');

    if (applyUpdate) {
        applyUpdate(false).finally(() => {
            window.location.href = targetUrl;
        });
    } else {
        window.location.href = targetUrl;
    }
}

export function tryActivateUpdate(targetUrl: string): boolean {
    if (!canActivateUpdate()) return false;
    activateUpdate(targetUrl);
    return true;
}

export function initSwUpdate(): void {
    // Dev: skip PWA — SW over self-signed certs trips Chromium SSL warnings.
    if (window.__FM_RUNTIME_CONFIG__?.devMode) return;
    applyUpdate = registerSW({
        onNeedRefresh() {
            // Mark only — applied on the next navigation, never auto-reloaded.
            debug('[SW] new version waiting');
            updatePending = true;
        },
        onOfflineReady() {
            debug('[SW] app ready for offline use');
            sessionStorage.removeItem(SW_RELOAD_KEY);
        },
        onRegisteredSW(_swUrl, registration) {
            if (!registration) return;
            const check = () => registration.update().catch(() => undefined);
            // Only check for a new SW on focus/poll — never reload here.
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) check();
            });
            // Slow background poll while visible — covers kiosks.
            setInterval(() => {
                if (!document.hidden) check();
            }, SW_UPDATE_POLL_INTERVAL_MS);
        }
    });
}

function canActivateUpdate(): boolean {
    if (!updatePending) return false;
    if (document.visibilityState !== 'visible') return false;
    if (isBlockedUpdateRoute()) return false;
    if (hasReloadBlocker()) return false;
    return true;
}

function isBlockedUpdateRoute(): boolean {
    const path = window.location.pathname;
    return path === '/callback' || path.startsWith('/auth/signinwin');
}

function hasReloadBlocker(): boolean {
    for (const blocker of updateReloadBlockers) {
        try {
            if (blocker()) return true;
        } catch {
            return true;
        }
    }
    return false;
}
