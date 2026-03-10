/**
 * CRUD+E Permission Model Definitions for Fleet Manager
 *
 * This module defines the component-based permission model with CRUD+E operations
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

// Note: Entity permissions are derived from device permissions -
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
 */
export interface ExecutablePermission extends ComponentPermission {
    execute: boolean;
}

/**
 * Scoped permission with item-level access control
 */
export interface ScopedPermission<T extends string | number = string>
    extends ComponentPermission {
    scope: 'ALL' | 'SELECTED';
    selected?: T[];
}

/**
 * Scoped permission with execute capability
 */
export interface ScopedExecutablePermission<T extends string | number = string>
    extends ExecutablePermission {
    scope: 'ALL' | 'SELECTED';
    selected?: T[];
}

/**
 * Full permission configuration
 */
export interface FleetPermissionConfig {
    components: {
        devices?: ScopedExecutablePermission<string>;
        groups?: ScopedPermission<number>;
        dashboards?: ScopedPermission<number>;
        actions?: ExecutablePermission;
        waiting_room?: ComponentPermission;
        configurations?: ComponentPermission;
        plugins?: ScopedPermission<string>;
    };
    // Note: entities permissions are derived from devices -
    // access to a device grants the same access to its entities
    // Note: actions visibility is derived from device access -
    // you can only see/interact with actions targeting devices you have access to
}

// ============================================================================
// Component Definitions
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
                'Automated actions and macros (visibility based on device access)',
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
            availableOperations: ['create', 'read', 'delete']
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

// Ordered list for UI display
export const COMPONENT_ORDER: ComponentName[] = [
    'devices',
    'actions',
    'groups',
    'dashboards',
    'waiting_room',
    'configurations',
    'plugins'
];

// ============================================================================
// Presets
// ============================================================================

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
                scope: 'ALL',
                selected: []
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
                scope: 'ALL',
                selected: []
            },
            dashboards: {
                create: false,
                read: false,
                update: false,
                delete: false,
                scope: 'ALL',
                selected: []
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
                scope: 'ALL',
                selected: []
            }
        }
    };
}

/**
 * Viewer preset: read-only access to all components
 */
export function createViewerConfig(): FleetPermissionConfig {
    return {
        components: {
            devices: {
                create: false,
                read: true,
                update: false,
                delete: false,
                execute: false,
                scope: 'ALL',
                selected: []
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
                scope: 'ALL',
                selected: []
            },
            dashboards: {
                create: false,
                read: true,
                update: false,
                delete: false,
                scope: 'ALL',
                selected: []
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
                scope: 'ALL',
                selected: []
            }
        }
    };
}

/**
 * Admin preset: full access to all components
 */
export function createAdminConfig(): FleetPermissionConfig {
    return {
        components: {
            devices: {
                create: true,
                read: true,
                update: true,
                delete: true,
                execute: true,
                scope: 'ALL',
                selected: []
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
                scope: 'ALL',
                selected: []
            },
            dashboards: {
                create: true,
                read: true,
                update: true,
                delete: true,
                scope: 'ALL',
                selected: []
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
                scope: 'ALL',
                selected: []
            }
        }
    };
}

/**
 * Installer preset: can read devices and manage waiting room (approve/reject)
 */
export function createInstallerConfig(): FleetPermissionConfig {
    return {
        components: {
            devices: {
                create: false,
                read: true,
                update: false,
                delete: false,
                execute: false,
                scope: 'ALL',
                selected: []
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
                scope: 'ALL',
                selected: []
            },
            dashboards: {
                create: false,
                read: false,
                update: false,
                delete: false,
                scope: 'ALL',
                selected: []
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
                scope: 'ALL',
                selected: []
            }
        }
    };
}

/**
 * Operator preset: can execute but not modify configs
 */
export function createOperatorConfig(): FleetPermissionConfig {
    return {
        components: {
            devices: {
                create: false,
                read: true,
                update: false,
                delete: false,
                execute: true,
                scope: 'ALL',
                selected: []
            },
            actions: {
                create: false,
                read: true,
                update: false,
                delete: false,
                execute: true
            },
            groups: {
                create: false,
                read: true,
                update: false,
                delete: false,
                scope: 'ALL',
                selected: []
            },
            dashboards: {
                create: false,
                read: true,
                update: false,
                delete: false,
                scope: 'ALL',
                selected: []
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
                scope: 'ALL',
                selected: []
            }
        }
    };
}

// ============================================================================
// Legacy support - kept for backwards compatibility
// ============================================================================

/**
 * @deprecated Use COMPONENT_DEFINITIONS instead
 */
export const possiblePermissionsForUser: Record<string, string[]> = {
    Alexa: ['*', 'Disable', 'Enable'],
    Device: ['*', 'list', 'GetInfo', 'GetSetup', 'Call', 'Get'],
    Entity: ['*', 'GetInfo', 'List'],
    FleetManager: [
        '*',
        'GerVariables',
        'Subscribe',
        'Unsubscribe',
        'ListPlugins',
        'UploadPlugin',
        'ListCommands'
    ],
    GrafanaComponent: ['*', 'GetConfig', 'GetDashboard'],
    GroupComponents: [
        '*',
        'Create',
        'Add',
        'Remove',
        'List',
        'Get',
        'Delete',
        'Rename',
        'Set',
        'Find'
    ],
    Group: ['*', 'list', 'delete', 'view'],
    MailComponent: ['Send'],
    StorageComponent: [
        '*',
        'GetItem',
        'SetItem',
        'RemoveItem',
        'Keys',
        'GetAll'
    ],
    UserComponents: [
        '*',
        'Create',
        'Update',
        'Delete',
        'List',
        'Refresh',
        'Authenticate'
    ],
    WaitingRoomComponents: [
        '*',
        'GetPending',
        'GetDenied',
        'AcceptPending',
        'RejectPending'
    ],
    Permissions: ['*', 'List', 'Delete', 'View']
};
