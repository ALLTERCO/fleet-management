// Authz vocabulary (resource types, verbs, action suggestions, system
// persona keys). One source — backend + frontend both read from here.

import type {ComponentName} from './permissions';

export const AUTHZ_RESOURCE_TYPES = [
    'device',
    'action',
    'group',
    'dashboard',
    'waiting_room',
    'configuration',
    'plugin',
    'report',
    'location',
    'tag',
    'organization',
    'alert',
    'notification',
    'integration',
    'automation',
    'grafana',
    'analytics'
] as const;

export type AuthzResourceType = (typeof AUTHZ_RESOURCE_TYPES)[number];

// `write` is the umbrella verb over create/update/delete on devices (legacy).
export const AUTHZ_VERBS = [
    'read',
    'write',
    'create',
    'update',
    'delete',
    'execute',
    '*'
] as const;

export type AuthzVerb = (typeof AUTHZ_VERBS)[number];

export const AUTHZ_RESOURCE_BY_COMPONENT: Record<
    ComponentName,
    AuthzResourceType
> = {
    devices: 'device',
    actions: 'action',
    groups: 'group',
    dashboards: 'dashboard',
    waiting_room: 'waiting_room',
    configurations: 'configuration',
    plugins: 'plugin',
    reports: 'report',
    locations: 'location',
    tags: 'tag',
    organizations: 'organization',
    alerts: 'alert',
    notifications: 'notification',
    integrations: 'integration',
    grafana: 'grafana',
    analytics: 'analytics'
};

export const AUTHZ_ACTION_SUGGESTIONS: readonly string[] = (() => {
    const out: string[] = ['*'];
    for (const r of AUTHZ_RESOURCE_TYPES) {
        for (const v of AUTHZ_VERBS) {
            out.push(`${r}:${v}`);
        }
    }
    return out;
})();

export const AUTHZ_RESOURCE_SUGGESTIONS: readonly string[] = [
    '*',
    ...AUTHZ_RESOURCE_TYPES
];

// Single source of truth for system-managed personas. Order = priority,
// highest first. Used by:
//   - SQL migrations (6112/6128/6130/6131) seed rows with these keys
//   - permission.GrantRoles allowlist (filters Zitadel role grants)
//   - permission.GetRoles filter (drops unknown role keys)
//   - extractRolesFromClaims sort order (roles[0] = priority pick)
//   - bootstrap-zitadel.sh ensure_project_role calls (must mirror this list)
//   - CommandSender.group is the same string as the persona key
export const AUTHZ_SYSTEM_PERSONA_KEYS = [
    'admin',
    'manager',
    'editor',
    'installer',
    'operator',
    'automation_admin',
    'auditor',
    'viewer'
] as const;

export type AuthzSystemPersonaKey = (typeof AUTHZ_SYSTEM_PERSONA_KEYS)[number];

// Aliases tolerated by extractRolesFromClaims when reading JWT role claims
// from external IdPs that use slightly different vocab.
export const AUTHZ_ROLE_ALIASES: Record<AuthzSystemPersonaKey, string[]> = {
    admin: ['administrator'],
    manager: [],
    editor: [],
    installer: ['install'],
    operator: [],
    automation_admin: ['automation-admin', 'automationadmin'],
    auditor: ['compliance'],
    viewer: ['read', 'readonly']
};

// Scope-type vocabulary for assignment/PAT scopes. Differs from resource
// types: 'tenant' = all:true, 'action' = actions narrowing, and the device
// family is spelled out per selector.
export const AUTHZ_SCOPE_TYPES = [
    'tenant',
    'action',
    'dashboard',
    'device',
    'device_group',
    'location',
    'tag',
    'waiting_room',
    'configuration',
    'plugin',
    'report',
    'organization',
    'alert',
    'notification',
    'integration',
    'automation'
] as const;

export type AuthzScopeType = (typeof AUTHZ_SCOPE_TYPES)[number];

const TENANT_READ_SCOPE_TYPES: readonly AuthzScopeType[] = AUTHZ_SCOPE_TYPES;

// Scope types each system persona may be assigned on. Backend enforcement
// (PersonaScopeCompatibilityValidator) and the frontend scope picker both
// read this — one matrix, one home.
export const AUTHZ_SYSTEM_PERSONA_SCOPE_TYPES: Record<
    AuthzSystemPersonaKey,
    readonly AuthzScopeType[]
> = {
    viewer: TENANT_READ_SCOPE_TYPES,
    auditor: TENANT_READ_SCOPE_TYPES,
    operator: [
        'device',
        'device_group',
        'location',
        'tag',
        'action',
        'alert',
        'notification'
    ],
    installer: [
        'device',
        'device_group',
        'location',
        'tag',
        'waiting_room',
        'configuration',
        'dashboard',
        'report'
    ],
    editor: [
        'dashboard',
        'device',
        'device_group',
        'location',
        'tag',
        'report',
        'alert',
        'notification',
        'integration',
        'configuration'
    ],
    manager: TENANT_READ_SCOPE_TYPES,
    automation_admin: [
        'automation',
        'action',
        'integration',
        'notification',
        'alert'
    ],
    admin: TENANT_READ_SCOPE_TYPES
};

// Full tenant access by these personas is high-risk: the backend requires a
// reason and an expiry on such grants. Enforcement and every grant UI read
// the same rule from here.
export const AUTHZ_HIGH_RISK_PERSONA_KEYS = ['admin', 'manager'] as const;

export function authzGrantIsHighRisk(
    personaKey: string,
    scopeAll: boolean
): boolean {
    return (
        scopeAll &&
        (AUTHZ_HIGH_RISK_PERSONA_KEYS as readonly string[]).includes(personaKey)
    );
}

// Catalog personas plus the no-access sentinel. Provider support authority is
// an internal AuthContext flag, not a tenant-visible role.
export type FleetRole = AuthzSystemPersonaKey | 'none';

// Priority sort key. roles[0] of a sorted array = primary.
export const AUTHZ_ROLE_PRIORITY: readonly string[] = [
    ...AUTHZ_SYSTEM_PERSONA_KEYS,
    'none'
];

export function authzRolePriorityIndex(role: string): number {
    const i = AUTHZ_ROLE_PRIORITY.indexOf(role);
    return i === -1 ? AUTHZ_ROLE_PRIORITY.length : i;
}
