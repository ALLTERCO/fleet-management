import type {
    EffectiveScope,
    EffectiveShape,
    EffectiveStatement
} from '@api/authz';
import {
    AUTHZ_RESOURCE_BY_COMPONENT,
    type AUTHZ_SYSTEM_PERSONA_KEYS
} from '@api/authzCatalog';
import {defineStore} from 'pinia';
import {computed, onScopeDispose, ref, watch} from 'vue';
import {clearRegistryCaches} from '@/composables/useRegistry';
import {clearRpcCaches} from '@/composables/useWsRpc';
import {LOGIN_PATH} from '@/constants';
import {redirectToLogin} from '@/helpers/authNavigation';
import type {
    ComponentCapabilityMap,
    ComponentName,
    CrudOperation,
    UiCapabilities
} from '@/helpers/sharedInfo';
import {getZitadelAuth, setAuthLifecycleHandlers} from '@/helpers/zitadelAuth';
import {debug} from '@/tools/debug';
import {sendRPC} from '@/tools/http';
import * as ws from '@/tools/websocket';

// Drive the wire role enum off the catalog so adding/removing a persona
// updates every consumer (route guards, dropdowns, audit views, etc.).
export type UserRole = (typeof AUTHZ_SYSTEM_PERSONA_KEYS)[number] | 'none';

interface UserPermissions {
    // Sorted by catalog priority. roles[0] is the priority pick.
    roles: readonly UserRole[];
    group: string;
    canWrite: boolean;
    isAdmin: boolean;
    isViewer: boolean;
    isPlatformAdmin?: boolean;
    // Null for admin / trusted — gates short-circuit to allow.
    effectiveShape: EffectiveShape | null;
    uiCapabilities?: UiCapabilities;
}

const DEV_MODE_TOKEN_KEY = 'dev_mode_token';
const DEV_MODE_USERNAME_KEY = 'dev_mode_username';

// HttpOnly cookies can only be cleared by the server.
async function clearServerSessionCookie(): Promise<void> {
    try {
        await fetch('/api/auth/session', {
            method: 'DELETE',
            credentials: 'same-origin'
        });
    } catch (error) {
        debug('clearServerSessionCookie failed', error);
    }
}

const NO_PERMISSIONS: UserPermissions = {
    roles: [],
    group: '',
    canWrite: false,
    isAdmin: false,
    isViewer: false,
    effectiveShape: {statements: []}
};

const EMPTY_UI_CAPABILITIES: UiCapabilities = {
    components: {} as ComponentCapabilityMap
};

setAuthLifecycleHandlers({
    rotateToken: async (accessToken) => {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'User.RotateToken', {
                access_token: accessToken
            });
        } catch (error) {
            debug('inline token rotate failed:', error);
        }
    },
    signOut: async (reason) => {
        await useAuthStore().signOut(reason);
    }
});

// Device writes collapse to a single `device:write` umbrella.
function authzAction(component: ComponentName, op: CrudOperation): string {
    const resource = AUTHZ_RESOURCE_BY_COMPONENT[component];
    if (component === 'devices' && op !== 'read') return `${resource}:write`;
    return `${resource}:${op}`;
}

function actionMatches(stmt: EffectiveStatement, action: string): boolean {
    if (stmt.notActions?.length) {
        for (const p of stmt.notActions)
            if (patternMatches(p, action)) return false;
    }
    for (const p of stmt.actions) if (patternMatches(p, action)) return true;
    return false;
}

function patternMatches(pattern: string, target: string): boolean {
    if (pattern === target || pattern === '*') return true;
    const colon = target.indexOf(':');
    if (colon < 0) return false;
    const tRes = target.slice(0, colon);
    const tVerb = target.slice(colon + 1);
    return pattern === `${tRes}:*` || pattern === `*:${tVerb}`;
}

function resourceMatches(stmt: EffectiveStatement, resource: string): boolean {
    if (stmt.notResourceTypes?.includes(resource)) return false;
    return (
        stmt.resourceTypes.includes(resource) ||
        stmt.resourceTypes.includes('*')
    );
}

// Evaluate transient (time.window) condition against now. Backend strips
// session-stable conditions (mfa, ip) before shipping the shape.
function conditionMatches(stmt: EffectiveStatement): boolean {
    const win = stmt.condition?.time?.window;
    if (!win) return true;
    const now = Date.now();
    const start = Date.parse(win.start);
    const end = Date.parse(win.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return now >= start && now <= end;
}

function statementMatches(
    stmt: EffectiveStatement,
    action: string,
    resource: string
): boolean {
    return (
        actionMatches(stmt, action) &&
        resourceMatches(stmt, resource) &&
        conditionMatches(stmt)
    );
}

function allowedBy(
    shape: EffectiveShape,
    action: string,
    resource: string
): EffectiveStatement[] {
    const out: EffectiveStatement[] = [];
    for (const s of shape.statements) {
        if (s.effect === 'Allow' && statementMatches(s, action, resource)) {
            out.push(s);
        }
    }
    return out;
}

// Empty scope grants nothing (matches backend scopeIsExplicit guard).
function scopeIsExplicit(scope: EffectiveScope): boolean {
    return Boolean(
        scope.all ||
            scope.device_ids?.length ||
            scope.location_ids?.length ||
            scope.device_group_ids?.length ||
            scope.device_tags?.length ||
            scope.dashboard_ids?.length ||
            scope.plugin_keys?.length
    );
}

// Backend pre-resolves indirect device-membership scopes into concrete
// device_ids before shipping the shape, so FE can do exact-id matching.
function scopeIncludesItem(
    stmt: EffectiveStatement,
    component: ComponentName,
    itemId: string | number
): boolean {
    const scope = stmt.scope;
    if (!scopeIsExplicit(scope)) return false;
    if (scope.all) return true;
    if (component === 'devices') {
        return scope.device_ids?.includes(String(itemId)) ?? false;
    }
    if (component === 'dashboards') {
        return scope.dashboard_ids?.includes(Number(itemId)) ?? false;
    }
    if (component === 'locations') {
        return scope.location_ids?.includes(Number(itemId)) ?? false;
    }
    if (component === 'plugins') {
        return scope.plugin_keys?.includes(String(itemId)) ?? false;
    }
    // No entity-level scoping for these — only scope.all (above) grants.
    if (component === 'groups' || component === 'tags') return false;
    return true;
}

// Launch payload from Mobile.GetBootstrap — read by other stores on first paint.
export interface LaunchBootstrap {
    serverTime: string;
    devices: {visible: boolean; items: unknown[]; total: number};
    waitingRoom: {
        visible: boolean;
        pendingCount: number;
        pending: Record<string, unknown>;
    };
    alerts: {visible: boolean; openCount: number; criticalCount: number};
}

export type SessionStatus =
    | 'booting'
    | 'authenticated'
    | 'renewing'
    | 'unauthenticated';

const SESSION_CHANNEL = 'fm-session';
const TAB_ID = Math.random().toString(36).slice(2);
const sessionChannel =
    typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(SESSION_CHANNEL)
        : null;
type SessionMessage = {
    type?: string;
    reason?: string;
    tabId?: string;
};
type SessionMessageHandler = (message: SessionMessage) => void;
const sessionMessageHandlers = new Set<SessionMessageHandler>();

sessionChannel?.addEventListener('message', (event: MessageEvent) => {
    const message = parseSessionMessage(event.data);
    if (!message) return;
    for (const handler of sessionMessageHandlers) handler(message);
});

function parseSessionMessage(data: unknown): SessionMessage | null {
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    return {
        type: typeof record.type === 'string' ? record.type : undefined,
        reason: typeof record.reason === 'string' ? record.reason : undefined,
        tabId: typeof record.tabId === 'string' ? record.tabId : undefined
    };
}

export const useAuthStore = defineStore('auth', () => {
    const status = ref<SessionStatus>('booting');

    // Permission state
    const userPermissions = ref<UserPermissions | null>(null);
    const permissionsLoaded = ref(false);
    const permissionsLoading = ref(false);
    const launchBootstrap = ref<LaunchBootstrap | null>(null);

    // Computed counters from launch bootstrap, kept live by Mobile.SyncDelta.
    const waitingRoomCount = computed(
        () => launchBootstrap.value?.waitingRoom.pendingCount ?? 0
    );
    const alertOpenCount = computed(
        () => launchBootstrap.value?.alerts.openCount ?? 0
    );
    const alertCriticalCount = computed(
        () => launchBootstrap.value?.alerts.criticalCount ?? 0
    );

    // Source: FM_DEV_MODE env → entrypoint → runtime-config.js.
    const devMode = computed(() => !!window.__FM_RUNTIME_CONFIG__?.devMode);
    const devModeToken = ref<string | null>(
        localStorage.getItem(DEV_MODE_TOKEN_KEY)
    );
    // Rehydrate the cookie mirror on app boot so already-logged-in dev
    // sessions can fetch authenticated static assets (floor-plans etc.)
    // via <img> before they perform any token-setting action.
    if (devModeToken.value) {
        // biome-ignore lint/suspicious/noDocumentCookie: CookieStore is not Baseline yet; auth runs everywhere.
        document.cookie = `token=${devModeToken.value}; path=/; SameSite=Strict`;
    }
    const devModeUsername = ref<string | null>(
        localStorage.getItem(DEV_MODE_USERNAME_KEY)
    );
    const loginError = ref<string | null>(null);

    // Check if user is logged in (works for both Zitadel and dev mode)
    const loggedIn = computed(() => {
        if (devMode.value) {
            return !!devModeToken.value;
        }
        const auth = getZitadelAuth();
        if (!auth) return false;
        return auth.oidcAuth.isAuthenticated;
    });

    // Get current Zitadel user profile
    const zitadelUser = computed(() => {
        try {
            const auth = getZitadelAuth();
            if (auth) {
                return auth.oidcAuth.userProfile;
            }
            return undefined;
        } catch (_error) {
            return undefined;
        }
    });

    // Get username from Zitadel profile or dev mode
    const username = computed(() => {
        if (devMode.value) {
            return devModeUsername.value;
        }
        return (
            zitadelUser.value?.email || zitadelUser.value?.preferred_username
        );
    });

    // Display name: prefer human-readable name over email
    const displayName = computed(() => {
        if (devMode.value) {
            return devModeUsername.value;
        }
        const u = zitadelUser.value;
        return u?.name || u?.given_name || u?.preferred_username || u?.email;
    });
    const currentUserId = computed(() => {
        const sub = zitadelUser.value?.sub;
        return typeof sub === 'string' && sub.length > 0 ? sub : null;
    });

    /**
     * Login with username/password (dev mode only)
     */
    async function devModeLogin(
        usernameInput: string,
        password: string
    ): Promise<boolean> {
        loginError.value = null;
        try {
            const response = await sendRPC('User.Authenticate', {
                username: usernameInput,
                password: password
            });

            if (response?.access_token) {
                devModeToken.value = response.access_token;
                devModeUsername.value = usernameInput;
                localStorage.setItem(DEV_MODE_TOKEN_KEY, response.access_token);
                // Mirror to a cookie so authenticated <img> / static-asset
                // GETs (floor-plans etc.) can carry the token without a
                // custom header. selectHttpAuthToken reads cookies.token.
                // biome-ignore lint/suspicious/noDocumentCookie: CookieStore is not Baseline yet; auth runs everywhere.
                document.cookie = `token=${response.access_token}; path=/; SameSite=Strict`;
                // Clear any stale Zitadel token so it doesn't interfere
                sessionStorage.removeItem('access_token');
                localStorage.setItem(DEV_MODE_USERNAME_KEY, usernameInput);

                // Store refresh token if provided
                if (response.refresh_token) {
                    localStorage.setItem(
                        'dev_mode_refresh_token',
                        response.refresh_token
                    );
                }

                return true;
            }
            loginError.value = 'Invalid response from server';
            return false;
        } catch (error) {
            debug('Dev mode login failed:', error);
            loginError.value =
                error instanceof Error ? error.message : 'Login failed';
            return false;
        }
    }

    /**
     * Get the access token for API calls
     */
    function getAccessToken(): string | null {
        if (devMode.value) {
            return devModeToken.value;
        }
        // For Zitadel, the token is handled by the auth library
        return getZitadelAuth()?.oidcAuth?.accessToken || null;
    }

    const roles = computed<readonly UserRole[]>(
        () => userPermissions.value?.roles ?? []
    );
    // Priority pick = roles[0] (backend sorts by catalog priority).
    const role = computed<UserRole>(() => roles.value[0] ?? 'none');
    const canWrite = computed(() => userPermissions.value?.canWrite ?? false);
    const isAdmin = computed(() => userPermissions.value?.isAdmin ?? false);
    const canAccessPlatformAdmin = computed(
        () => userPermissions.value?.isPlatformAdmin === true
    );
    const isViewer = computed(() => userPermissions.value?.isViewer ?? false);
    const isAuditor = computed(() => roles.value.includes('auditor'));
    // Admin OR auditor — mirrors backend canViewAuditLog / canReadPolicies.
    const canViewAuditLog = computed(() => isAdmin.value || isAuditor.value);
    const canReadPolicies = computed(() => isAdmin.value || isAuditor.value);
    function hasRole(r: UserRole): boolean {
        return roles.value.includes(r);
    }
    const isReadOnly = computed(() => !canWrite.value);
    const effectiveShape = computed<EffectiveShape | null>(
        () => userPermissions.value?.effectiveShape ?? null
    );
    const uiCapabilities = computed<UiCapabilities>(
        () => userPermissions.value?.uiCapabilities ?? EMPTY_UI_CAPABILITIES
    );
    // Mirrors backend requireGrafanaPermission gate. Admin short-circuits;
    // otherwise we walk the policy shape for a matching Allow on `grafana:read`.
    const hasGrafanaAccess = computed(() => {
        if (isAdmin.value) return true;
        const shape = effectiveShape.value;
        if (!shape) return false;
        return allowedBy(shape, 'grafana:read', 'grafana').length > 0;
    });

    const hasNoPermissions = computed(() => {
        if (!permissionsLoaded.value) return false;
        if (isAdmin.value) return false;
        if (hasAnyBootstrapCapability()) return false;
        const shape = effectiveShape.value;
        if (!shape) return true;
        return shape.statements.every((s) => s.effect !== 'Allow');
    });

    function hasAnyBootstrapCapability(): boolean {
        return Object.values(uiCapabilities.value.components).some(
            (component) => Object.values(component ?? {}).some(Boolean)
        );
    }

    function hasComponentPermission(
        component: ComponentName,
        operation: CrudOperation
    ): boolean {
        if (isAdmin.value) return true;
        if (hasBootstrapCapability(component, operation)) return true;
        const shape = effectiveShape.value;
        if (!shape) return false;
        const action = authzAction(component, operation);
        const resource = AUTHZ_RESOURCE_BY_COMPONENT[component];
        return allowedBy(shape, action, resource).length > 0;
    }

    function hasBootstrapCapability(
        component: ComponentName,
        operation: CrudOperation
    ): boolean {
        return uiCapabilities.value.components[component]?.[operation] === true;
    }

    function canReadComponent(component: ComponentName): boolean {
        return hasComponentPermission(component, 'read');
    }

    function hasAllScope(component: ComponentName): boolean {
        if (isAdmin.value) return true;
        const shape = effectiveShape.value;
        if (!shape) return false;
        const resource = AUTHZ_RESOURCE_BY_COMPONENT[component];
        for (const s of shape.statements) {
            if (s.effect !== 'Allow') continue;
            if (!resourceMatches(s, resource)) continue;
            if (s.scope.all) return true;
        }
        return false;
    }

    // With itemId: matching Deny with matching scope wins, else any matching Allow.
    function canPerformComponent(
        component: ComponentName,
        operation: CrudOperation,
        itemId?: string | number
    ): boolean {
        if (isAdmin.value) return true;
        if (itemId === undefined) {
            return hasComponentPermission(component, operation);
        }
        if (!hasComponentPermission(component, operation)) return false;
        const shape = effectiveShape.value;
        if (!shape) return true;
        const action = authzAction(component, operation);
        const resource = AUTHZ_RESOURCE_BY_COMPONENT[component];
        for (const s of shape.statements) {
            if (s.effect !== 'Deny') continue;
            if (!statementMatches(s, action, resource)) continue;
            if (scopeIncludesItem(s, component, itemId)) return false;
        }
        const allows = allowedBy(shape, action, resource);
        return allows.some((s) => scopeIncludesItem(s, component, itemId));
    }

    function canExecuteDevice(shellyID?: string): boolean {
        return canPerformComponent('devices', 'execute', shellyID);
    }

    function canExecuteActions(): boolean {
        return hasComponentPermission('actions', 'execute');
    }

    type FetchUserPermissionsOptions = {
        rerunIfBusy?: boolean;
    };

    // Seq-token + status check: a sign-out racing this branch must NOT
    // resurrect permissions after `unauthenticated` was set.
    // Only explicit auth-change callers queue one rerun while busy; normal
    // startup/reconnect callers share the in-flight request.
    let fetchPermissionsSeq = 0;
    let refreshPending = false;
    let permissionsInFlight: Promise<void> | null = null;
    async function fetchUserPermissions(
        options: FetchUserPermissionsOptions = {}
    ) {
        if (permissionsLoading.value) {
            if (options.rerunIfBusy) refreshPending = true;
            return permissionsInFlight ?? undefined;
        }

        permissionsInFlight = doFetchUserPermissions();
        try {
            await permissionsInFlight;
        } finally {
            permissionsInFlight = null;
        }
    }

    async function doFetchUserPermissions() {
        const seq = ++fetchPermissionsSeq;
        const isCurrent = () =>
            seq === fetchPermissionsSeq && status.value !== 'unauthenticated';

        permissionsLoading.value = true;
        try {
            const bootstrap = (await sendRPC('Mobile.GetBootstrap', {})) as {
                permissions?: UserPermissions;
                serverTime: string;
                devices: LaunchBootstrap['devices'];
                waitingRoom: LaunchBootstrap['waitingRoom'];
                alerts: LaunchBootstrap['alerts'];
            };

            if (!isCurrent()) return;

            const perms = bootstrap.permissions;
            if (perms && typeof perms === 'object') {
                userPermissions.value = perms as UserPermissions;
            } else {
                userPermissions.value = NO_PERMISSIONS;
            }

            launchBootstrap.value = {
                serverTime: bootstrap.serverTime,
                devices: bootstrap.devices,
                waitingRoom: bootstrap.waitingRoom,
                alerts: bootstrap.alerts
            };
            permissionsLoaded.value = true;
            debug(
                'Launch bootstrap loaded:',
                userPermissions.value,
                launchBootstrap.value
            );
        } catch (error) {
            if (!isCurrent()) return;
            debug(
                'Mobile.GetBootstrap failed, falling back to User.GetMe:',
                error
            );
            try {
                const response = await sendRPC('User.GetMe', {});
                if (!isCurrent()) return;
                userPermissions.value = response as UserPermissions;
                permissionsLoaded.value = true;
            } catch (fallbackError) {
                if (!isCurrent()) return;
                debug('Failed to fetch user permissions:', fallbackError);
                userPermissions.value = NO_PERMISSIONS;
                permissionsLoaded.value = true;
            }
        } finally {
            if (seq === fetchPermissionsSeq) permissionsLoading.value = false;
        }
        // Skip the rerun if signOut happened while we were in-flight.
        if (
            refreshPending &&
            seq === fetchPermissionsSeq &&
            status.value !== 'unauthenticated'
        ) {
            refreshPending = false;
            void fetchUserPermissions({rerunIfBusy: true});
        } else if (status.value === 'unauthenticated') {
            refreshPending = false;
        }
    }

    let loginLifecycleInFlight: Promise<void> | null = null;

    async function handleLoginChanged(isLoggedIn: boolean) {
        if (isLoggedIn) {
            if (status.value === 'authenticated' && permissionsLoaded.value)
                return;
            if (loginLifecycleInFlight) return loginLifecycleInFlight;
            loginLifecycleInFlight = completeLoginLifecycle().finally(() => {
                loginLifecycleInFlight = null;
            });
            return loginLifecycleInFlight;
        } else {
            ws.close();
            userPermissions.value = null;
            permissionsLoaded.value = false;
            launchBootstrap.value = null;
            status.value = 'unauthenticated';
        }
    }

    async function completeLoginLifecycle() {
        status.value = 'booting';
        await ws.connect();
        await fetchUserPermissions();
        // Guard against signOut() racing this branch mid-await.
        if (permissionsLoaded.value && status.value === 'booting') {
            status.value = 'authenticated';
        }
    }

    // Session-lost teardown — distinct from user-initiated logout().
    async function signOut(reason: string, fromBroadcast = false) {
        if (status.value === 'unauthenticated') return;
        debug(`[session] signOut: ${reason}`);
        status.value = 'unauthenticated';
        ws.close();
        userPermissions.value = null;
        permissionsLoaded.value = false;
        launchBootstrap.value = null;
        devModeToken.value = null;
        devModeUsername.value = null;
        const zAuth = getZitadelAuth();
        if (zAuth) {
            await removeOidcUserBestEffort(zAuth);
        }
        sessionStorage.removeItem('access_token');
        localStorage.removeItem(DEV_MODE_TOKEN_KEY);
        localStorage.removeItem(DEV_MODE_USERNAME_KEY);
        localStorage.removeItem('dev_mode_refresh_token');
        await clearServerSessionCookie();
        // Expire the dev-mode mirror cookie (non-HttpOnly, used for <img> auth).
        // biome-ignore lint/suspicious/noDocumentCookie: CookieStore is not Baseline yet; auth runs everywhere.
        document.cookie =
            'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict';
        if (!fromBroadcast) {
            sessionChannel?.postMessage({
                type: 'signOut',
                reason,
                tabId: TAB_ID
            });
        }
        const path = window.location.pathname;
        if (path !== LOGIN_PATH && path !== '/callback') {
            await redirectToLogin();
        }
    }

    async function removeOidcUserBestEffort(
        zAuth: NonNullable<ReturnType<typeof getZitadelAuth>>
    ): Promise<void> {
        try {
            await zAuth.oidcAuth.mgr.removeUser();
        } catch (error) {
            debug('OIDC user cleanup failed during sign-out', error);
        }
    }

    function handleSessionMessage(message: SessionMessage): void {
        if (message.type !== 'signOut' || message.tabId === TAB_ID) return;
        void signOut(`cross-tab:${message.reason}`, true);
    }

    sessionMessageHandlers.add(handleSessionMessage);
    onScopeDispose(() => {
        sessionMessageHandlers.delete(handleSessionMessage);
    });

    // Logout (works for both Zitadel and dev mode)
    async function logout() {
        sessionChannel?.postMessage({
            type: 'signOut',
            reason: 'logout',
            tabId: TAB_ID
        });
        localStorage.setItem('last_logout_time', String(Date.now()));
        userPermissions.value = null;
        permissionsLoaded.value = false;

        // Clear composable caches to prevent cross-session data bleed
        clearSessionCaches();

        await clearServerSessionCookie();
        if (devMode.value) {
            // Dev mode logout - clear local tokens
            devModeToken.value = null;
            devModeUsername.value = null;
            localStorage.removeItem(DEV_MODE_TOKEN_KEY);
            localStorage.removeItem(DEV_MODE_USERNAME_KEY);
            localStorage.removeItem('dev_mode_refresh_token');
            // biome-ignore lint/suspicious/noDocumentCookie: CookieStore is not Baseline yet; auth runs everywhere.
            document.cookie =
                'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict';
        } else if (getZitadelAuth()) {
            // Zitadel logout
            try {
                await getZitadelAuth()!.oidcAuth.signOut();
            } catch (error) {
                debug('Error during logout:', error);
            }
        }
    }

    function clearSessionCaches(): void {
        clearRpcCaches();
        clearRegistryCaches();
    }

    // Watch login state and connect/disconnect websocket
    watch(
        loggedIn,
        (isLoggedIn) => {
            handleLoginChanged(isLoggedIn);
        },
        {immediate: true}
    );

    return {
        status,
        signOut,

        // Login state
        loggedIn,
        username,
        displayName,
        currentUserId,
        logout,
        handleLoginChanged,
        zitadelUser,

        // Dev mode
        devMode,
        devModeLogin,
        loginError,
        getAccessToken,

        // Permissions
        role,
        roles,
        hasRole,
        canWrite,
        isAdmin,
        canAccessPlatformAdmin,
        isViewer,
        isAuditor,
        canViewAuditLog,
        canReadPolicies,
        hasGrafanaAccess,
        isReadOnly,
        permissionsLoaded,
        fetchUserPermissions,
        effectiveShape,
        uiCapabilities,
        hasComponentPermission,
        canReadComponent,
        hasAllScope,
        canPerformComponent,
        hasNoPermissions,
        canExecuteDevice,
        canExecuteActions,

        // Launch payload from Mobile.GetBootstrap (read by other stores)
        launchBootstrap,
        waitingRoomCount,
        alertOpenCount,
        alertCriticalCount,
        updateWaitingRoom(count: number, pending: Record<string, unknown>) {
            if (!launchBootstrap.value) return;
            launchBootstrap.value = {
                ...launchBootstrap.value,
                waitingRoom: {
                    ...launchBootstrap.value.waitingRoom,
                    pendingCount: count,
                    pending
                }
            };
        },
        updateWaitingRoomCount(count: number) {
            if (!launchBootstrap.value) return;
            launchBootstrap.value = {
                ...launchBootstrap.value,
                waitingRoom: {
                    ...launchBootstrap.value.waitingRoom,
                    pendingCount: count
                }
            };
        },
        updateAlertCounts(open: number, critical: number) {
            if (!launchBootstrap.value) return;
            launchBootstrap.value = {
                ...launchBootstrap.value,
                alerts: {
                    ...launchBootstrap.value.alerts,
                    openCount: open,
                    criticalCount: critical
                }
            };
        }
    };
});
