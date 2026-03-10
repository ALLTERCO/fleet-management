import type {WebSocket} from 'ws';
import type {
    ComponentName,
    CrudOperation,
    FleetPermissionConfig,
    ScopedExecutablePermission,
    ScopedPermission
} from './permissions';
import {
    ADMIN_PERMISSIONS,
    INSTALLER_PERMISSIONS,
    VIEWER_PERMISSIONS,
    mapLegacyComponentName,
    methodToCrudOperation
} from './permissions';

// ── Shared group cache ──────────────────────────────────────────────
// Group data (list + reverse index) is the same for all users.
// Cache it at module level so new CommandSender instances don't refetch.
const sharedGroupData = {
    groups: null as Record<
        PropertyKey,
        {id: number; name: string; devices: string[]}
    > | null,
    deviceToGroups: null as Map<string, Set<number>> | null,
    version: -1
};

export default class CommandSender {
    private permissions: Set<string>;
    private group: string;
    private socket?: WebSocket;
    private permissionConfig?: FleetPermissionConfig;
    private username?: string;
    #deviceAccessCache = new Map<string, boolean>();
    #groupListCache: Record<
        PropertyKey,
        {id: number; name: string; devices: string[]}
    > | null = null;
    #groupListVersion = -1;
    // Reverse index: shellyID → Set<groupId> for O(1) membership lookups
    #deviceToGroups: Map<string, Set<number>> | null = null;

    constructor(
        permissions: string[],
        group: string,
        additional?: {
            socket?: WebSocket;
            permissionConfig?: FleetPermissionConfig;
            username?: string;
        }
    ) {
        this.permissions = new Set(permissions);
        this.group = group;
        this.socket = additional?.socket;
        this.permissionConfig = additional?.permissionConfig;
        this.username = additional?.username;
    }

    /**
     * Get user info for audit logging
     */
    getUser(): {username?: string} | undefined {
        if (this.username) {
            return {username: this.username};
        }
        return undefined;
    }

    /**
     * Check if user is an admin (full access)
     */
    isAdmin(): boolean {
        return this.group === 'admin' || this.permissions.has('*');
    }

    /**
     * Check if user is a viewer (read-only access with at least read permissions)
     */
    isViewer(): boolean {
        if (this.isAdmin()) return false;
        if (this.group === 'viewer') return true;

        // Check if user has any read permissions
        if (this.permissionConfig) {
            for (const comp of Object.values(
                this.permissionConfig.components
            )) {
                if (comp?.read) return true;
            }
        }

        return false;
    }

    /**
     * Check if user is an installer (can manage waiting room)
     */
    isInstaller(): boolean {
        if (this.isAdmin()) return false;
        return this.group === 'installer';
    }

    /**
     * Check if user has no permissions at all
     */
    hasNoPermissions(): boolean {
        if (this.isAdmin()) return false;
        if (this.permissions.has('*') || this.permissions.has('read:*'))
            return false;

        // Check if user has any permissions in the CRUD config
        if (this.permissionConfig) {
            for (const comp of Object.values(
                this.permissionConfig.components
            )) {
                if (!comp) continue;
                if (comp.read || comp.create || comp.update || comp.delete) {
                    return false;
                }
                if ('execute' in comp && comp.execute) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Check if user can perform write operations.
     * Returns true if user has any create/update/delete/execute permissions.
     */
    canWrite(): boolean {
        if (this.isAdmin()) return true;

        // Check new CRUD config
        if (this.permissionConfig) {
            for (const comp of Object.values(
                this.permissionConfig.components
            )) {
                if (!comp) continue;
                if (comp.create || comp.update || comp.delete) {
                    return true;
                }
                if ('execute' in comp && comp.execute) {
                    return true;
                }
            }
            return false;
        }

        // Fallback: viewers cannot write
        return !this.isViewer();
    }

    /**
     * Get the user's role
     */
    getRole(): 'admin' | 'installer' | 'viewer' | 'none' {
        if (this.isAdmin()) return 'admin';
        if (this.hasNoPermissions()) return 'none';
        if (this.group === 'installer') return 'installer';
        return 'viewer';
    }

    /**
     * Get the user's group
     */
    getGroup(): string {
        return this.group;
    }

    /**
     * Get the permission config (for inspection/debugging)
     */
    getPermissionConfig(): FleetPermissionConfig | undefined {
        return this.permissionConfig;
    }

    // ========================================================================
    // New CRUD Permission Methods
    // ========================================================================

    /**
     * Check if user has a specific CRUD permission for a component.
     * This is the primary method for the new permission model.
     */
    hasCrudPermission(
        component: ComponentName,
        operation: CrudOperation
    ): boolean {
        if (this.isAdmin()) return true;

        // Get the effective config (from metadata or role-based)
        const config = this.#getEffectiveConfig();
        if (!config) return false;

        const compPerms = config.components[component];
        if (!compPerms) return false;

        // Check the specific operation
        if (operation === 'execute') {
            // Only some components have execute
            if ('execute' in compPerms) {
                return compPerms.execute === true;
            }
            return false;
        }

        return compPerms[operation] === true;
    }

    /**
     * Check if user can access a specific item within a scoped component.
     * For non-scoped components or scope=ALL, returns true if read permission exists.
     */
    canAccessItem(component: ComponentName, itemId: string | number): boolean {
        if (this.isAdmin()) return true;

        const config = this.#getEffectiveConfig();
        if (!config) return false;

        const compPerms = config.components[component];
        if (!compPerms) return false;

        // Need at least read permission
        if (!compPerms.read) return false;

        // Check if component is scoped
        if (!('scope' in compPerms)) {
            // Non-scoped component - read permission is sufficient
            return true;
        }

        const scopedPerms = compPerms as ScopedPermission<string | number>;

        if (scopedPerms.scope === 'ALL') {
            return true;
        }

        // SELECTED scope - check if item is in the selected list
        if (scopedPerms.selected) {
            return scopedPerms.selected.includes(itemId as never);
        }

        return false;
    }

    /**
     * Combined check: CRUD permission + item access (if applicable).
     * This is the main method to use for permission checks.
     *
     * @param component - The component being accessed
     * @param operation - The CRUD operation being performed
     * @param itemId - Optional item ID for scoped components
     */
    canPerformOnItem(
        component: ComponentName,
        operation: CrudOperation,
        itemId?: string | number
    ): boolean {
        if (this.isAdmin()) return true;

        // First check CRUD permission
        if (!this.hasCrudPermission(component, operation)) {
            return false;
        }

        // If no item specified, CRUD check is sufficient
        if (itemId === undefined) {
            return true;
        }

        // For scoped components with specific items, check item access
        const config = this.#getEffectiveConfig();
        if (!config) return false;

        const compPerms = config.components[component];
        if (!compPerms || !('scope' in compPerms)) {
            // Non-scoped component
            return true;
        }

        const scopedPerms = compPerms as ScopedPermission<string | number>;

        if (scopedPerms.scope === 'ALL') {
            return true;
        }

        // SELECTED scope - verify item is in allowed list
        if (scopedPerms.selected) {
            return scopedPerms.selected.includes(itemId as never);
        }

        return false;
    }

    /**
     * Check permission using component class name and method name.
     * Maps legacy names to new CRUD model.
     */
    canPerformMethod(
        componentClassName: string,
        methodName: string,
        itemId?: string | number
    ): boolean {
        if (this.isAdmin()) return true;

        const component = mapLegacyComponentName(componentClassName);
        const operation = methodToCrudOperation(methodName);

        if (!component || !operation) {
            // Unknown component/method - fall back to legacy check
            return this.hasPermission(`${componentClassName}.${methodName}`);
        }

        return this.canPerformOnItem(component, operation, itemId);
    }

    /**
     * Get the effective permission config.
     * Uses stored config if available, otherwise derives from role.
     */
    #getEffectiveConfig(): FleetPermissionConfig | null {
        if (this.permissionConfig) {
            return this.permissionConfig;
        }

        // Derive from role
        if (this.isAdmin()) {
            return ADMIN_PERMISSIONS;
        }

        if (this.isInstaller()) {
            return INSTALLER_PERMISSIONS;
        }

        if (this.isViewer()) {
            return VIEWER_PERMISSIONS;
        }

        // No role - return null (no permissions)
        return null;
    }

    // ========================================================================
    // Legacy Permission Methods (kept for backward compatibility)
    // ========================================================================

    /**
     * Legacy permission check using permission strings.
     * @deprecated Use hasCrudPermission() or canPerformOnItem() instead
     */
    hasPermission(permission: string): boolean {
        return this.isAdmin() || this.#hasPermissionRule(permission);
    }

    hasExactPermission(permission: string): boolean {
        return this.isAdmin() || this.permissions.has(permission);
    }

    /**
     * Check if user can access a specific device.
     * Checks direct device access first, then falls back to group membership
     * (if a device is in a group the user has access to, the user can access the device).
     */
    async canAccessDevice(shellyId: string): Promise<boolean> {
        if (this.isAdmin()) return true;

        const cached = this.#deviceAccessCache.get(shellyId);
        if (cached !== undefined) return cached;

        const allowed = await this.#checkDeviceAccess(shellyId);
        this.#deviceAccessCache.set(shellyId, allowed);
        return allowed;
    }

    async #checkDeviceAccess(shellyId: string): Promise<boolean> {
        // Try new CRUD model first
        if (this.permissionConfig) {
            // Direct device access (device is in selected list or scope is ALL)
            if (this.canPerformOnItem('devices', 'read', shellyId)) {
                return true;
            }
            // Device not directly accessible — check if it's in an accessible group
            if (this.hasCrudPermission('groups', 'read')) {
                return this.#isPartOfAnAccessedGroup(shellyId);
            }
            return false;
        }

        // Legacy check
        const hasDirectAccess = this.hasPermission(`device.get.${shellyId}`);
        return (
            hasDirectAccess || (await this.#isPartOfAnAccessedGroup(shellyId))
        );
    }

    async #isPartOfAnAccessedGroup(shellyID: string): Promise<boolean> {
        await this.#warmGroupListCache();
        return this.#isInCachedGroup(shellyID);
    }

    #isInCachedGroup(shellyID: string): boolean {
        // O(1) lookup via reverse index (built in #warmGroupListCache)
        if (this.#deviceToGroups) {
            return this.#deviceToGroups.has(shellyID);
        }
        // Fallback if index not yet built
        if (!this.#groupListCache) return false;
        for (const group of Object.values(this.#groupListCache)) {
            if (group.devices.includes(shellyID)) {
                return true;
            }
        }
        return false;
    }

    async #warmGroupListCache(): Promise<void> {
        // Lazy imports to break circular dependency:
        // CommandSender → Commander → CommandSender
        const {getGroupVersion} = await import(
            '../modules/EventDistributor.js'
        );
        const currentVersion = getGroupVersion();

        // Fast path: reuse shared module-level cache if version matches.
        // This avoids a group.list RPC for every new CommandSender instance.
        if (
            sharedGroupData.version === currentVersion &&
            sharedGroupData.groups
        ) {
            if (this.#groupListVersion !== currentVersion) {
                this.#deviceAccessCache.clear();
            }
            this.#groupListCache = sharedGroupData.groups;
            this.#deviceToGroups = sharedGroupData.deviceToGroups;
            this.#groupListVersion = currentVersion;
            return;
        }

        if (
            this.#groupListCache === null ||
            this.#groupListVersion !== currentVersion
        ) {
            if (this.#groupListVersion !== currentVersion) {
                this.#deviceAccessCache.clear();
                this.#deviceToGroups = null;
            }
            const Commander = await import('../modules/Commander.js');
            this.#groupListCache = await Commander.exec(this, 'group.list');
            this.#groupListVersion = currentVersion;

            // Build reverse index: shellyID → Set<groupId> for O(1) lookups
            const idx = new Map<string, Set<number>>();
            if (this.#groupListCache) {
                for (const group of Object.values(this.#groupListCache)) {
                    for (const shellyID of group.devices) {
                        let s = idx.get(shellyID);
                        if (!s) {
                            s = new Set();
                            idx.set(shellyID, s);
                        }
                        s.add(group.id);
                    }
                }
            }
            this.#deviceToGroups = idx;

            // Update shared cache so other CommandSender instances benefit
            sharedGroupData.groups = this.#groupListCache;
            sharedGroupData.deviceToGroups = this.#deviceToGroups;
            sharedGroupData.version = currentVersion;
        }
    }

    #checkDeviceAccessSync(shellyId: string): boolean {
        if (this.permissionConfig) {
            if (this.canPerformOnItem('devices', 'read', shellyId)) {
                return true;
            }
            if (this.hasCrudPermission('groups', 'read')) {
                return this.#isInCachedGroup(shellyId);
            }
            return false;
        }
        return (
            this.hasPermission(`device.get.${shellyId}`) ||
            this.#isInCachedGroup(shellyId)
        );
    }

    /**
     * Synchronous permission check — returns cached result or undefined on miss.
     * Use in hot paths (notifyAll) to avoid async overhead when caches are warm.
     */
    canAccessDeviceSync(shellyId: string): boolean | undefined {
        if (this.isAdmin()) return true;
        return this.#deviceAccessCache.get(shellyId);
    }

    /**
     * Batch permission check — pre-warms group cache with 1 await,
     * then checks all devices synchronously. Zero event-loop yields in the loop.
     */
    async filterAccessibleDevices(shellyIDs: string[]): Promise<Set<string>> {
        if (this.isAdmin()) return new Set(shellyIDs);

        await this.#warmGroupListCache();

        const accessible = new Set<string>();
        for (const shellyId of shellyIDs) {
            const cached = this.#deviceAccessCache.get(shellyId);
            if (cached !== undefined) {
                if (cached) accessible.add(shellyId);
                continue;
            }
            const allowed = this.#checkDeviceAccessSync(shellyId);
            this.#deviceAccessCache.set(shellyId, allowed);
            if (allowed) accessible.add(shellyId);
        }
        return accessible;
    }

    #hasPermissionRule(requiredPermission: string) {
        const requiredParts = requiredPermission.split('.');
        if (requiredParts.length < 2) return false;

        for (const userPermission of this.permissions) {
            const userParts = userPermission.split('.');

            let match = true;
            for (let i = 0; i < requiredParts.length; i++) {
                if (userParts[i] === '*') {
                    match = true;
                    break;
                }
                if (
                    userParts[i]?.toLowerCase() !==
                    requiredParts[i]?.toLowerCase()
                ) {
                    match = false;
                    break;
                }
            }

            if (match) return true;
        }

        return false;
    }

    getSocket() {
        return this.socket;
    }

    toString() {
        return `CommandSender(${this.group})[${Array.from(this.permissions).join(',')}]`;
    }

    static readonly INTERNAL = new CommandSender(['*'], 'admin');
    static readonly PLUGIN = new CommandSender(['*'], 'plugins');
}
