// Canonical Fleet Manager component vocabulary. Authz lives in
// types/api/authz.ts (wire shape) + modules/authz/ (resolver).
// This file owns the FE-facing component metadata + RPC method classifier.

// SSOT for the CRUD+E vocabulary — the type derives from the list.
export const CRUD_OPERATIONS = [
    'create',
    'read',
    'update',
    'delete',
    'execute'
] as const;

export type CrudOperation = (typeof CRUD_OPERATIONS)[number];

export type ComponentName =
    | 'devices'
    | 'actions'
    | 'groups'
    | 'dashboards'
    | 'waiting_room'
    | 'configurations'
    | 'plugins'
    | 'reports'
    | 'locations'
    | 'tags'
    | 'organizations'
    | 'alerts'
    | 'notifications'
    | 'integrations'
    | 'grafana'
    | 'analytics';

// Entities inherit permissions from their parent device.
// Action visibility is derived from device access.

export interface ComponentDefinition {
    name: ComponentName;
    label: string;
    description: string;
    scoped: boolean;
    hasExecute: boolean;
    selectedType: 'string' | 'number' | null;
    availableOperations: CrudOperation[];
}

export type ComponentCapabilityMap = Record<
    ComponentName,
    Partial<Record<CrudOperation, boolean>>
>;

export interface UiCapabilities {
    components: ComponentCapabilityMap;
}

export const COMPONENT_ORDER: ComponentName[] = [
    'devices',
    'actions',
    'groups',
    'dashboards',
    'waiting_room',
    'configurations',
    'plugins',
    'reports',
    'locations',
    'tags',
    'organizations',
    'alerts',
    'notifications',
    'integrations',
    'grafana',
    'analytics'
];

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
        },
        reports: {
            name: 'reports',
            label: 'Reports',
            description: 'Energy reports, CSV exports, and report configs',
            scoped: false,
            hasExecute: false,
            selectedType: null,
            // 'update' gates generate-report; the underlying config isn't mutated.
            availableOperations: ['create', 'read', 'update', 'delete']
        },
        locations: {
            name: 'locations',
            label: 'Locations',
            description: 'Physical scope hierarchy (site/building/floor/room)',
            scoped: true,
            hasExecute: false,
            selectedType: 'number',
            availableOperations: ['create', 'read', 'update', 'delete']
        },
        tags: {
            name: 'tags',
            label: 'Tags',
            description: 'Label/category layer for subjects across the org',
            scoped: true,
            hasExecute: false,
            selectedType: 'number',
            availableOperations: ['create', 'read', 'update', 'delete']
        },
        organizations: {
            name: 'organizations',
            label: 'Organization',
            description: 'Organization profile (single per tenant)',
            scoped: false,
            hasExecute: false,
            selectedType: null,
            availableOperations: ['read', 'update']
        },
        alerts: {
            name: 'alerts',
            label: 'Alerts',
            description: 'Alert rules, active alerts, and alert actions',
            scoped: false,
            hasExecute: false,
            selectedType: null,
            availableOperations: ['create', 'read', 'update', 'delete']
        },
        notifications: {
            name: 'notifications',
            label: 'Notifications',
            description: 'Inbox items, destinations, and delivery history',
            scoped: false,
            hasExecute: false,
            selectedType: null,
            availableOperations: ['create', 'read', 'update', 'delete']
        },
        integrations: {
            name: 'integrations',
            label: 'Integrations',
            description: 'Outbound delivery endpoints and provider settings',
            scoped: false,
            hasExecute: false,
            selectedType: null,
            availableOperations: ['create', 'read', 'update', 'delete']
        },
        grafana: {
            name: 'grafana',
            label: 'Grafana',
            description: 'FM-proxied Grafana UI (SaaS add-on)',
            scoped: false,
            hasExecute: false,
            selectedType: null,
            availableOperations: ['read']
        },
        analytics: {
            name: 'analytics',
            label: 'Analytics',
            description:
                'Investigation flows over EM tables (brush-to-compare, attribution).',
            scoped: false,
            hasExecute: false,
            selectedType: null,
            availableOperations: ['read']
        }
    };

// Map old component/method names to new component names.
export function mapLegacyComponentName(name: string): ComponentName | null {
    const normalized = name.toLowerCase();
    const mapping: Record<string, ComponentName> = {
        device: 'devices',
        devices: 'devices',
        entity: 'devices',
        entities: 'devices',
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
        report: 'reports',
        reports: 'reports',
        location: 'locations',
        locations: 'locations',
        tag: 'tags',
        tags: 'tags',
        organization: 'organizations',
        organizations: 'organizations',
        alert: 'alerts',
        alerts: 'alerts',
        notification: 'notifications',
        notifications: 'notifications',
        integration: 'integrations',
        integrations: 'integrations',
        grafana: 'grafana',
        analytics: 'analytics'
    };
    return mapping[normalized] ?? null;
}

// Classify an RPC method name into a CRUD verb based on its prefix.
export function methodToCrudOperation(method: string): CrudOperation | null {
    const methodLower = method.toLowerCase();
    const createPatterns = [
        'create',
        'add',
        'upload',
        'accept',
        'new',
        'insert'
    ];
    if (createPatterns.some((p) => methodLower.startsWith(p))) return 'create';

    const readPatterns = [
        'list',
        'get',
        'find',
        'fetch',
        'keys',
        'search',
        'query'
    ];
    if (readPatterns.some((p) => methodLower.startsWith(p))) return 'read';

    const deletePatterns = ['delete', 'remove', 'reject', 'purge', 'drop'];
    if (deletePatterns.some((p) => methodLower.startsWith(p))) return 'delete';

    const executePatterns = ['call', 'run', 'execute', 'trigger', 'set'];
    if (executePatterns.some((p) => methodLower.startsWith(p)))
        return 'execute';

    const updatePatterns = [
        'update',
        'rename',
        'enable',
        'disable',
        'modify',
        'change',
        'edit'
    ];
    if (updatePatterns.some((p) => methodLower.startsWith(p))) return 'update';

    return null;
}
