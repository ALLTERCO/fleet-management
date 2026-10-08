// Classifies every browser-storage key the app writes, so signing out can drop
// what belonged to the account and keep what belongs to the browser.

import {clearRegistryCaches} from '@/composables/useRegistry';
import {clearRpcCaches} from '@/composables/useWsRpc';

/** Names a device, a tenant object, or the live connection. */
export const SESSION_SCOPED_STORAGE_KEYS: readonly string[] = [
    'fm-device-filters',
    'fm-dashboard-order',
    'cam-live-pref',
    'fm.locationsTree.expanded',
    'fm:bgops-jobs',
    'fm:firmware-update-session',
    'fm:ws:connectionId',
    'fm:ws:lastSeenStreamId',
    // Carries a group id and a free-text search over device names.
    'backups-filters',
    // Names the system alerts one account closed; the next account starts clean.
    'fm.banner.dismissed'
];

/** Same, for families whose key carries the identifier. */
export const SESSION_SCOPED_STORAGE_PREFIXES: readonly string[] = [
    'fm-dashboard-recents:',
    'fm-dashboard-scope:',
    // Names the devices, sites and searches one account looked at.
    'fm-search-recents:',
    'fm.savedFilters.',
    'bas:favorites:',
    // Business Manager packages own their browser preferences, but the host
    // owns identity teardown. A shared namespace lets every template keep its
    // keys isolated while ensuring no previous tenant's choices survive logout.
    'fm.template.'
];

/** Swept by the module that owns the key format, not by the list above. */
export const DELEGATED_STORAGE_PREFIXES: readonly string[] = [
    'rpc-cache:',
    '-registry-cache:'
];

/** Describes the browser, not the account, so signing out must keep it. */
export const GLOBAL_STORAGE_KEYS: readonly string[] = [
    'fm_ui_background',
    'fm_sidebar_hidden',
    'fm_sidebar_state',
    'fm_heatmap',
    'fm_debug',
    'fm_obs_level',
    'fm_observability',
    'fm_ws_telemetry',
    '_oidc_debug',
    'fm.settings.collapsed-groups',
    'fm.device-settings.collapsed-groups',
    // Which model-image URLs 404 here: a deployment fact, not an account one.
    'fm.deviceLogo.badUrls',
    'fw-sidebar-library-open',
    // Flows list or editor first on the Node-RED tab: a layout choice.
    'fm.nodeRed.view',
    'last_logout_time',
    'sw_update_reload',
    'chunk_reload',
    // Which identity provider this browser last talked to: a deployment fact,
    // and the signal that detects a rebuilt Zitadel, so sign-out keeps it.
    'fm_oidc_identity',
    // The websocket address device configurations propose: names the Fleet
    // deployment, not the account, so signing out keeps it.
    'propose-ws'
];

/** Owned by the sign-in and sign-out paths, not by the sweep below. */
export const CREDENTIAL_STORAGE_KEYS: readonly string[] = [
    'dev_mode_token',
    'dev_mode_username',
    'dev_mode_refresh_token',
    'access_token',
    // The silent re-auth counter: left behind, it refuses the next retry.
    '_oidc_reauth_retry'
];

function isSessionScoped(key: string): boolean {
    return (
        SESSION_SCOPED_STORAGE_KEYS.includes(key) ||
        SESSION_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
    );
}

function removeSessionScopedKeys(store: Storage): void {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key !== null && isSessionScoped(key)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
}

/** Drops every credential, from both stores since one may have moved. */
export function clearCredentialStorage(): void {
    for (const key of CREDENTIAL_STORAGE_KEYS) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    }
}

/** Drops everything the previous identity left behind. Idempotent. */
export function clearSessionScopedStorage(): void {
    clearRpcCaches();
    clearRegistryCaches();
    // Nothing pins a key to one store, so a survivor in the other one would
    // still be the previous identity's data.
    for (const store of [localStorage, sessionStorage]) {
        removeSessionScopedKeys(store);
    }
}
