/**
 * CRUD+E Permission Model for Fleet Manager
 *
 * This module defines the new permission system based on CRUD+E operations
 * (Create, Read, Update, Delete, Execute) per component.
 */

// ============================================================================
// Types
// ============================================================================

export type CrudOperation = 'create' | 'read' | 'update' | 'delete' | 'execute';

export type ComponentName =
    | 'devices'
    | 'actions'
    | 'groups'
    | 'dashboards'
    | 'waiting_room'
    | 'configurations'
    | 'plugins';

// Note: 'entities' permissions are derived from 'devices' -
// if you have access to a device, you have the same access to its entities

/**
 * Base CRUD permission flags for a component
 */
export interface ComponentPermission {
    create: boolean;
    read: boolean;
    update: boolean;
    delete: boolean;
}

/**
 * Extended permission with execute capability
 * Used for: devices, entities, actions
 */
export interface ExecutablePermission extends ComponentPermission {
    execute: boolean;
}

/**
 * Scoped permission with item-level access control
 * Used for: groups, dashboards
 */
export interface ScopedPermission<T extends string | number = string>
    extends ComponentPermission {
    scope: 'ALL' | 'SELECTED';
    selected?: T[];
}

/**
 * Scoped permission with execute capability
 * Used for: devices, entities, actions
 */
export interface ScopedExecutablePermission<T extends string | number = string>
    extends ExecutablePermission {
    scope: 'ALL' | 'SELECTED';
    selected?: T[];
}

/**
 * Full permission configuration for a user
 */
export interface FleetPermissionConfig {
    components: {
        // Scoped components with execute permission
        devices?: ScopedExecutablePermission<string>;

        // Scoped components without execute
        groups?: ScopedPermission<number>;
        dashboards?: ScopedPermission<number>;

        // Global components with execute (access derived from device permissions)
        actions?: ExecutablePermission;

        // Global components (no scope, no execute)
        waiting_room?: ComponentPermission;
        configurations?: ComponentPermission;

        // Scoped component for plugin access
        plugins?: ScopedPermission<string>;
    };
    // Note: entities permissions are derived from devices -
    // access to a device grants the same access to its entities
    // Note: actions visibility is derived from device access -
    // you can only see/interact with actions targeting devices you have access to
}

// ============================================================================
// Component Metadata
// ============================================================================

export interface ComponentDefinition {
    name: ComponentName;
    label: string;
    description: string;
    scoped: boolean;
    hasExecute: boolean;
    selectedType: 'string' | 'number' | null;
    availableOperations: CrudOperation[];
}

export const COMPONENT_DEFINITIONS: Record<ComponentName, ComponentDefinition> =
    {
        devices: {
            name: 'devices',
            label: 'Devices',
            description:
                'IoT devices and their entities (switches, sensors, etc.)',
            scoped: true,
            hasExecute: true,
            selectedType: 'string',
            availableOperations: [
                'create',
                'read',
                'update',
                'delete',
                'execute'
            ]
        },
        // Note: entities inherit permissions from their parent device
        actions: {
            name: 'actions',
            label: 'Actions',
            description:
                'Automated actions and macros (access derived from device permissions)',
            scoped: false,
            hasExecute: true,
            selectedType: null,
            availableOperations: [
                'create',
                'read',
                'update',
                'delete',
                'execute'
            ]
        },
        groups: {
            name: 'groups',
            label: 'Device Groups',
            description: 'Logical groupings of devices',
            scoped: true,
            hasExecute: false,
            selectedType: 'number',
            availableOperations: ['create', 'read', 'update', 'delete']
        },
        dashboards: {
            name: 'dashboards',
            label: 'Dashboards',
            description: 'UI dashboard configurations',
            scoped: true,
            hasExecute: false,
            selectedType: 'number',
            availableOperations: ['create', 'read', 'update', 'delete']
        },
        waiting_room: {
            name: 'waiting_room',
            label: 'Waiting Room',
            description: 'Device approval queue',
            scoped: false,
            hasExecute: false,
            selectedType: null,
            availableOperations: ['create', 'read', 'delete'] // No update - approve/reject only
        },
        configurations: {
            name: 'configurations',
            label: 'Configurations',
            description: 'Device profiles and settings',
            scoped: false,
            hasExecute: false,
            selectedType: null,
            availableOperations: ['create', 'read', 'update', 'delete']
        },
        plugins: {
            name: 'plugins',
            label: 'Plugins',
            description: 'System extensions',
            scoped: true,
            hasExecute: false,
            selectedType: 'string',
            availableOperations: ['create', 'read', 'update', 'delete']
        }
    };

// ============================================================================
// Presets
// ============================================================================

/**
 * Viewer preset: read-only access to all components
 */
export const VIEWER_PERMISSIONS: FleetPermissionConfig = {
    components: {
        devices: {
            create: false,
            read: true,
            update: false,
            delete: false,
            execute: false,
            scope: 'ALL'
        },
        actions: {
            create: false,
            read: true,
            update: false,
            delete: false,
            execute: false
        },
        groups: {
            create: false,
            read: true,
            update: false,
            delete: false,
            scope: 'ALL'
        },
        dashboards: {
            create: false,
            read: true,
            update: false,
            delete: false,
            scope: 'ALL'
        },
        waiting_room: {
            create: false,
            read: true,
            update: false,
            delete: false
        },
        configurations: {
            create: false,
            read: true,
            update: false,
            delete: false
        },
        plugins: {
            create: false,
            read: true,
            update: false,
            delete: false,
            scope: 'ALL'
        }
    }
};

/**
 * Admin preset: full access to all components
 */
export const ADMIN_PERMISSIONS: FleetPermissionConfig = {
    components: {
        devices: {
            create: true,
            read: true,
            update: true,
            delete: true,
            execute: true,
            scope: 'ALL'
        },
        actions: {
            create: true,
            read: true,
            update: true,
            delete: true,
            execute: true
        },
        groups: {
            create: true,
            read: true,
            update: true,
            delete: true,
            scope: 'ALL'
        },
        dashboards: {
            create: true,
            read: true,
            update: true,
            delete: true,
            scope: 'ALL'
        },
        waiting_room: {
            create: true,
            read: true,
            update: true,
            delete: true
        },
        configurations: {
            create: true,
            read: true,
            update: true,
            delete: true
        },
        plugins: {
            create: true,
            read: true,
            update: true,
            delete: true,
            scope: 'ALL'
        }
    }
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Installer preset: can read devices and manage waiting room (approve/reject)
 */
export const INSTALLER_PERMISSIONS: FleetPermissionConfig = {
    components: {
        devices: {
            create: false,
            read: true,
            update: false,
            delete: false,
            execute: false,
            scope: 'ALL'
        },
        actions: {
            create: false,
            read: false,
            update: false,
            delete: false,
            execute: false
        },
        groups: {
            create: false,
            read: true, // Installers can read groups (needed for FMA group selector)
            update: false,
            delete: false,
            scope: 'ALL'
        },
        dashboards: {
            create: false,
            read: false,
            update: false,
            delete: false,
            scope: 'ALL'
        },
        waiting_room: {
            create: true, // Accept pending devices
            read: true,
            update: false,
            delete: true // Reject pending devices
        },
        configurations: {
            create: false,
            read: true, // Installers can read configurations
            update: false,
            delete: false
        },
        plugins: {
            create: false,
            read: false,
            update: false,
            delete: false,
            scope: 'ALL'
        }
    }
};

/**
 * Create an empty permission config (all false)
 */
export function createEmptyConfig(): FleetPermissionConfig {
    return {
        components: {
            devices: {
                create: false,
                read: false,
                update: false,
                delete: false,
                execute: false,
                scope: 'ALL'
            },
            actions: {
                create: false,
                read: false,
                update: false,
                delete: false,
                execute: false
            },
            groups: {
                create: false,
                read: false,
                update: false,
                delete: false,
                scope: 'ALL'
            },
            dashboards: {
                create: false,
                read: false,
                update: false,
                delete: false,
                scope: 'ALL'
            },
            waiting_room: {
                create: false,
                read: false,
                update: false,
                delete: false
            },
            configurations: {
                create: false,
                read: false,
                update: false,
                delete: false
            },
            plugins: {
                create: false,
                read: false,
                update: false,
                delete: false,
                scope: 'ALL'
            }
        }
    };
}

/**
 * Get permission config based on role
 */
export function roleToPermissionConfig(
    role: 'admin' | 'installer' | 'viewer' | 'none'
): FleetPermissionConfig {
    switch (role) {
        case 'admin':
            return ADMIN_PERMISSIONS;
        case 'installer':
            return INSTALLER_PERMISSIONS;
        case 'viewer':
            return VIEWER_PERMISSIONS;
        default:
            return createEmptyConfig();
    }
}

/**
 * Parse and validate permission config from JSON (e.g., from fm_permissions).
 * Normalizes the config by filling in defaults for missing fields, so partial
 * configs (e.g., only specifying { groups: { read: true } }) work correctly.
 */
export function parsePermissionConfig(
    data: unknown
): FleetPermissionConfig | null {
    if (!data || typeof data !== 'object') {
        return null;
    }

    const obj = data as Record<string, unknown>;

    // Check if it's the new format with 'components' key
    if (!obj.components || typeof obj.components !== 'object') {
        return null;
    }

    const components = obj.components as Record<string, unknown>;

    // Start with an empty config and merge in the provided values
    const result = createEmptyConfig();

    for (const [name, value] of Object.entries(components)) {
        if (!value || typeof value !== 'object') continue;
        if (!(name in result.components)) continue;

        const src = value as Record<string, unknown>;
        const dest = result.components[name as ComponentName];
        if (!dest) continue;

        // Merge CRUD booleans (default to false if missing)
        dest.create = src.create === true;
        dest.read = src.read === true;
        dest.update = src.update === true;
        dest.delete = src.delete === true;

        // Merge execute for executable components
        if ('execute' in dest) {
            (dest as any).execute = src.execute === true;
        }

        // Merge scope for scoped components (default to 'ALL' if missing)
        if ('scope' in dest) {
            const scopedDest = dest as ScopedPermission<string | number>;
            if (src.scope === 'SELECTED') {
                scopedDest.scope = 'SELECTED';
                scopedDest.selected = Array.isArray(src.selected)
                    ? (src.selected as (string | number)[])
                    : [];
            } else {
                scopedDest.scope = 'ALL';
            }
        }
    }

    return result;
}

/**
 * Check if config has any write permissions (create, update, delete, execute)
 */
export function configHasWritePermissions(
    config: FleetPermissionConfig
): boolean {
    for (const comp of Object.values(config.components)) {
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

/**
 * Map old component/method names to new component names
 */
export function mapLegacyComponentName(name: string): ComponentName | null {
    const normalized = name.toLowerCase();
    const mapping: Record<string, ComponentName> = {
        device: 'devices',
        devices: 'devices',
        entity: 'devices', // Entities inherit permissions from devices
        entities: 'devices', // Entities inherit permissions from devices
        action: 'actions',
        actions: 'actions',
        group: 'groups',
        groups: 'groups',
        groupcomponents: 'groups',
        dashboard: 'dashboards',
        dashboards: 'dashboards',
        waitingroom: 'waiting_room',
        waiting_room: 'waiting_room',
        waitingroomcomponents: 'waiting_room',
        storage: 'configurations',
        storagecomponent: 'configurations',
        configurations: 'configurations',
        config: 'configurations',
        plugin: 'plugins',
        plugins: 'plugins',
        fleetmanager: 'plugins' // Plugin management is in FleetManager
    };
    return mapping[normalized] ?? null;
}

/**
 * Map method name to CRUD operation
 */
export function methodToCrudOperation(method: string): CrudOperation | null {
    const methodLower = method.toLowerCase();

    // Create operations
    const createPatterns = [
        'create',
        'add',
        'upload',
        'accept',
        'new',
        'insert'
    ];
    if (createPatterns.some((p) => methodLower.startsWith(p))) {
        return 'create';
    }

    // Read operations
    const readPatterns = [
        'list',
        'get',
        'find',
        'fetch',
        'keys',
        'search',
        'query'
    ];
    if (readPatterns.some((p) => methodLower.startsWith(p))) {
        return 'read';
    }

    // Delete operations (check before update to catch 'remove')
    const deletePatterns = ['delete', 'remove', 'reject', 'purge', 'drop'];
    if (deletePatterns.some((p) => methodLower.startsWith(p))) {
        return 'delete';
    }

    // Execute operations
    const executePatterns = ['call', 'run', 'execute', 'trigger', 'set'];
    if (executePatterns.some((p) => methodLower.startsWith(p))) {
        return 'execute';
    }

    // Update operations (broader patterns)
    const updatePatterns = [
        'update',
        'rename',
        'enable',
        'disable',
        'modify',
        'change',
        'edit'
    ];
    if (updatePatterns.some((p) => methodLower.startsWith(p))) {
        return 'update';
    }

    return null;
}
