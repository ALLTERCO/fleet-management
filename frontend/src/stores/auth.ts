import {defineStore} from 'pinia';
import {computed, ref, watch} from 'vue';
import type {
    ComponentName,
    CrudOperation,
    FleetPermissionConfig
} from '@/helpers/sharedInfo';
import zitadelAuth from '@/helpers/zitadelAuth';
import {sendRPC} from '@/tools/http';
import * as ws from '@/tools/websocket';

// User role type
export type UserRole = 'admin' | 'installer' | 'viewer' | 'none';

// User permissions info from backend
interface UserPermissions {
    role: UserRole;
    group: string;
    canWrite: boolean;
    isAdmin: boolean;
    isViewer: boolean;
    permissionConfig?: FleetPermissionConfig;
}

// Dev mode token storage key
const DEV_MODE_TOKEN_KEY = 'dev_mode_token';
const DEV_MODE_USERNAME_KEY = 'dev_mode_username';

export const useAuthStore = defineStore('auth', () => {
    // Permission state
    const userPermissions = ref<UserPermissions | null>(null);
    const permissionsLoaded = ref(false);
    const permissionsLoading = ref(false);

    // Dev mode state
    const devMode = ref(false);
    const devModeChecked = ref(false);
    const devModeToken = ref<string | null>(
        localStorage.getItem(DEV_MODE_TOKEN_KEY)
    );
    const devModeUsername = ref<string | null>(
        localStorage.getItem(DEV_MODE_USERNAME_KEY)
    );
    const loginError = ref<string | null>(null);

    // Check if user is logged in (works for both Zitadel and dev mode)
    const loggedIn = computed(() => {
        if (devMode.value) {
            return !!devModeToken.value;
        }
        if (!zitadelAuth) return false;
        return zitadelAuth.oidcAuth.isAuthenticated;
    });

    // Get current Zitadel user profile
    const zitadelUser = computed(() => {
        try {
            if (zitadelAuth) {
                return zitadelAuth.oidcAuth.userProfile;
            }
            return undefined;
        } catch (error) {
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

    /**
     * Check if we're in dev mode by fetching from backend API
     */
    async function checkDevMode(): Promise<boolean> {
        try {
            const response = await fetch('/api/variables');
            const data = await response.json();
            devMode.value = !!data['dev-mode'];
            devModeChecked.value = true;
            return devMode.value;
        } catch (error) {
            console.warn('Failed to check dev mode:', error);
            devMode.value = false;
            devModeChecked.value = true;
            return false;
        }
    }

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
        } catch (error: any) {
            console.error('Dev mode login failed:', error);
            loginError.value = error?.message || 'Login failed';
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
        return zitadelAuth?.oidcAuth?.accessToken || null;
    }

    // Role and permission computed properties
    const role = computed<UserRole | 'none'>(
        () => userPermissions.value?.role ?? 'none'
    );
    const canWrite = computed(() => userPermissions.value?.canWrite ?? false);
    const isAdmin = computed(() => userPermissions.value?.isAdmin ?? false);
    const isViewer = computed(() => userPermissions.value?.isViewer ?? false);
    const isReadOnly = computed(() => !canWrite.value);
    const permissionConfig = computed(
        () => userPermissions.value?.permissionConfig
    );

    /**
     * Check if user has no permissions at all (should see "contact admin" message)
     */
    const hasNoPermissions = computed(() => {
        if (!permissionsLoaded.value) return false;
        if (isAdmin.value) return false;

        const config = permissionConfig.value;
        if (!config?.components) return true;

        // Check if user has at least one read permission
        for (const comp of Object.values(config.components)) {
            if (comp && comp.read) return false;
        }
        return true;
    });

    /**
     * Check if user has a specific permission for a component
     */
    function hasComponentPermission(
        component: ComponentName,
        operation: CrudOperation
    ): boolean {
        // Admin has all permissions
        if (isAdmin.value) return true;

        const config = permissionConfig.value;
        if (!config?.components) return false;

        const comp = config.components[component];
        if (!comp) return false;

        if (operation === 'execute' && 'execute' in comp) {
            return comp.execute;
        }

        return (comp as any)[operation] ?? false;
    }

    /**
     * Check if user can read a component (shorthand)
     */
    function canReadComponent(component: ComponentName): boolean {
        return hasComponentPermission(component, 'read');
    }

    /**
     * Check if user has ALL scope for a component (not SELECTED)
     */
    function hasAllScope(component: ComponentName): boolean {
        if (isAdmin.value) return true;

        const config = permissionConfig.value;
        if (!config?.components) return false;

        const comp = config.components[component];
        if (!comp || !('scope' in comp)) return true; // Non-scoped components

        return comp.scope === 'ALL';
    }

    /**
     * Check if user can execute commands on a specific device
     */
    function canExecuteDevice(shellyID?: string): boolean {
        if (isAdmin.value) return true;

        const config = permissionConfig.value;
        if (!config?.components?.devices) return false;

        const devices = config.components.devices;
        if (!devices.execute) return false;

        // Check scope
        if (devices.scope === 'ALL') return true;
        if (devices.scope === 'SELECTED' && shellyID) {
            return devices.selected?.includes(shellyID) ?? false;
        }

        return false;
    }

    /**
     * Check if user can execute actions
     */
    function canExecuteActions(): boolean {
        if (isAdmin.value) return true;

        const config = permissionConfig.value;
        if (!config?.components?.actions) return false;

        return config.components.actions.execute ?? false;
    }

    // Fetch user permissions from backend
    async function fetchUserPermissions() {
        if (permissionsLoading.value) return;

        permissionsLoading.value = true;
        try {
            const response = await sendRPC('User.GetMe', {});
            userPermissions.value = response as UserPermissions;
            permissionsLoaded.value = true;
            console.debug('User permissions loaded:', userPermissions.value);
        } catch (error) {
            console.error('Failed to fetch user permissions:', error);
            // Default to no permissions (safest)
            userPermissions.value = {
                role: 'none',
                group: '',
                canWrite: false,
                isAdmin: false,
                isViewer: false
            };
            permissionsLoaded.value = true;
        } finally {
            permissionsLoading.value = false;
        }
    }

    // Handle login state changes
    async function handleLoginChanged(isLoggedIn: boolean) {
        if (isLoggedIn) {
            await ws.connect();
            // Fetch permissions after login (websocket is now open)
            await fetchUserPermissions();
        } else {
            ws.close();
            // Clear permissions on logout
            userPermissions.value = null;
            permissionsLoaded.value = false;
        }
    }

    // Logout (works for both Zitadel and dev mode)
    async function logout() {
        localStorage.setItem('last_logout_time', String(new Date().getTime()));
        userPermissions.value = null;
        permissionsLoaded.value = false;

        if (devMode.value) {
            // Dev mode logout - clear local tokens
            devModeToken.value = null;
            devModeUsername.value = null;
            localStorage.removeItem(DEV_MODE_TOKEN_KEY);
            localStorage.removeItem(DEV_MODE_USERNAME_KEY);
            localStorage.removeItem('dev_mode_refresh_token');
        } else if (zitadelAuth) {
            // Zitadel logout
            try {
                await zitadelAuth.oidcAuth.signOut();
            } catch (error) {
                console.error('Error during logout:', error);
            }
        }
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
        // Login state
        loggedIn,
        username,
        displayName,
        logout,
        handleLoginChanged,
        zitadelUser,

        // Dev mode
        devMode,
        devModeChecked,
        checkDevMode,
        devModeLogin,
        loginError,
        getAccessToken,

        // Permissions
        role,
        canWrite,
        isAdmin,
        isViewer,
        isReadOnly,
        permissionsLoaded,
        fetchUserPermissions,
        permissionConfig,
        hasComponentPermission,
        canReadComponent,
        hasAllScope,
        hasNoPermissions,
        canExecuteDevice,
        canExecuteActions
    };
});
