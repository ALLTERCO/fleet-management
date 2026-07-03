import type {AssignmentScope} from '@api/assignment';
import {
    AUTHZ_SYSTEM_PERSONA_SCOPE_TYPES,
    type AuthzScopeType,
    type AuthzSystemPersonaKey
} from '@api/authzCatalog';

// A picked boundary: any subset of the contract's scope dimensions. Derived
// from AssignmentScope so it can never drift from the wire shape.
export type ScopeSelection = Partial<Omit<AssignmentScope, 'all' | 'actions'>>;

export type ScopeDimensionKey = keyof ScopeSelection;

// Where a dimension's pick-list comes from. 'keys' = free-typed ids/keys (no
// browsable list); the rest map to a Pinia store the picker already loads.
export type ScopeSource =
    | 'devices'
    | 'locations'
    | 'groups'
    | 'tags'
    | 'dashboards'
    | 'keys';

export interface ScopeDimension {
    key: ScopeDimensionKey;
    label: string;
    icon: string;
    source: ScopeSource;
    // Matches the AssignmentScope value type: numeric ids vs string ids/keys.
    valueType: 'string' | 'number';
}

// One pickable resource: the wire value plus its human name.
export interface ScopeOption {
    value: string | number;
    label: string;
}

// Single source of truth for the scope picker — one entry per dimension with
// all its metadata. `key` is typed against the contract, so adding a dimension
// to AssignmentScope surfaces here too.
export const SCOPE_DIMENSIONS: readonly ScopeDimension[] = [
    {
        key: 'device_ids',
        label: 'Devices',
        icon: 'fa-microchip',
        source: 'devices',
        valueType: 'string'
    },
    {
        key: 'location_ids',
        label: 'Locations',
        icon: 'fa-location-dot',
        source: 'locations',
        valueType: 'number'
    },
    {
        key: 'device_group_ids',
        label: 'Device groups',
        icon: 'fa-folder-tree',
        source: 'groups',
        valueType: 'number'
    },
    {
        key: 'device_tags',
        label: 'Device tags',
        icon: 'fa-tag',
        source: 'tags',
        valueType: 'string'
    },
    {
        key: 'dashboard_ids',
        label: 'Dashboards',
        icon: 'fa-chart-bar',
        source: 'dashboards',
        valueType: 'number'
    },
    {
        key: 'plugin_keys',
        label: 'Plugins',
        icon: 'fa-plug',
        source: 'keys',
        valueType: 'string'
    },
    {
        key: 'report_ids',
        label: 'Reports',
        icon: 'fa-file-lines',
        source: 'keys',
        valueType: 'number'
    },
    {
        key: 'alert_ids',
        label: 'Alerts',
        icon: 'fa-bell',
        source: 'keys',
        valueType: 'string'
    },
    {
        key: 'notification_ids',
        label: 'Notifications',
        icon: 'fa-paper-plane',
        source: 'keys',
        valueType: 'string'
    },
    {
        key: 'automation_ids',
        label: 'Automations',
        icon: 'fa-robot',
        source: 'keys',
        valueType: 'string'
    },
    {
        key: 'integration_keys',
        label: 'Integrations',
        icon: 'fa-puzzle-piece',
        source: 'keys',
        valueType: 'string'
    },
    {
        key: 'organization_ids',
        label: 'Organizations',
        icon: 'fa-building',
        source: 'keys',
        valueType: 'string'
    },
    {
        key: 'waiting_room_ids',
        label: 'Waiting room',
        icon: 'fa-hourglass-half',
        source: 'keys',
        valueType: 'string'
    },
    {
        key: 'configuration_keys',
        label: 'Configuration',
        icon: 'fa-sliders',
        source: 'keys',
        valueType: 'string'
    }
] as const;

// One grant targets ONE kind of resource. The resolver ANDs every filled
// dimension against a single resource, so mixing kinds (devices + dashboards)
// matches nothing. The picker therefore writes exactly one dimension.
export type ScopeKindKey =
    | 'devices'
    | 'dashboards'
    | 'alerts'
    | 'notifications'
    | 'integrations'
    | 'reports';

export interface ScopeKind {
    key: ScopeKindKey;
    label: string;
    icon: string;
    // The wire dimension this kind writes. Devices pick their selector
    // (by device / group / location / tag) separately.
    dimension: ScopeDimensionKey | null;
    // Scope types in the shared authz-catalog vocabulary. A kind is offered
    // when the role's matrix allows at least one of them.
    scopeTypes: readonly AuthzScopeType[];
}

export const SCOPE_KINDS: readonly ScopeKind[] = [
    {
        key: 'devices',
        label: 'Devices',
        icon: 'fa-microchip',
        dimension: null,
        scopeTypes: ['device', 'device_group', 'location', 'tag']
    },
    {
        key: 'dashboards',
        label: 'Dashboards',
        icon: 'fa-chart-bar',
        dimension: 'dashboard_ids',
        scopeTypes: ['dashboard']
    },
    {
        key: 'alerts',
        label: 'Alerts',
        icon: 'fa-bell',
        dimension: 'alert_ids',
        scopeTypes: ['alert']
    },
    {
        key: 'notifications',
        label: 'Notification destinations',
        icon: 'fa-paper-plane',
        dimension: 'notification_ids',
        scopeTypes: ['notification']
    },
    {
        key: 'integrations',
        label: 'Integrations',
        icon: 'fa-puzzle-piece',
        dimension: 'integration_keys',
        scopeTypes: ['integration']
    },
    {
        key: 'reports',
        label: 'Reports',
        icon: 'fa-file-lines',
        dimension: 'report_ids',
        scopeTypes: ['report']
    }
] as const;

// Devices can be chosen one way per grant. The backend INTERSECTS device
// selectors when several are set, so the picker offers exactly one.
export type DeviceSelectorKey =
    | 'device_ids'
    | 'device_group_ids'
    | 'location_ids'
    | 'device_tags';

export const DEVICE_SELECTORS: ReadonlyArray<{
    key: DeviceSelectorKey;
    label: string;
    scopeType: AuthzScopeType;
}> = [
    {key: 'device_ids', label: 'Specific devices', scopeType: 'device'},
    {
        key: 'device_group_ids',
        label: 'Devices in groups',
        scopeType: 'device_group'
    },
    {key: 'location_ids', label: 'Devices in locations', scopeType: 'location'},
    {key: 'device_tags', label: 'Devices with tags', scopeType: 'tag'}
] as const;

function isSystemPersonaKey(key: string): key is AuthzSystemPersonaKey {
    return key in AUTHZ_SYSTEM_PERSONA_SCOPE_TYPES;
}

// Kinds offerable for a role, read from the shared persona↔scope-type matrix
// (the same one backend enforcement validates against). Custom personas have
// no matrix row — the backend accepts any explicit scope for them.
export function scopeKindsForPersona(
    personaKey: string | undefined
): ScopeKind[] {
    if (!personaKey || !isSystemPersonaKey(personaKey)) {
        return [...SCOPE_KINDS];
    }
    const allowed = new Set(AUTHZ_SYSTEM_PERSONA_SCOPE_TYPES[personaKey]);
    return SCOPE_KINDS.filter((kind) =>
        kind.scopeTypes.some((type) => allowed.has(type))
    );
}

// Build a wire scope from a picked selection: full access, or only the
// non-empty picked dimensions. Null means "narrowed, but nothing picked".
export function buildScope(
    scopeAll: boolean,
    picked: ScopeSelection
): AssignmentScope | null {
    if (scopeAll) return {all: true};
    const dimensions = Object.entries(picked).filter(
        ([, value]) => Array.isArray(value) && value.length > 0
    );
    return dimensions.length
        ? (Object.fromEntries(dimensions) as AssignmentScope)
        : null;
}
