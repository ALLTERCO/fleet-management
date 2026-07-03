import {
    AUTHZ_ROLE_PRIORITY,
    type FleetRole
} from '../../../types/api/authzCatalog';

const COARSE_PERMISSIONS_BY_ROLE: Record<string, string[]> = {
    admin: ['*'],
    manager: ['read:*', 'write:*'],
    editor: ['read:*', 'update:*'],
    installer: ['read:*', 'waitingroom:*'],
    operator: ['read:*', 'execute:*'],
    automation_admin: ['read:*', 'automation:*'],
    auditor: ['read:*', 'audit:read'],
    viewer: ['read:*'],
    none: []
};

export const ROLE_PERMISSIONS: Record<FleetRole, string[]> = Object.freeze(
    Object.fromEntries(
        AUTHZ_ROLE_PRIORITY.map((role) => [
            role,
            COARSE_PERMISSIONS_BY_ROLE[role] ?? []
        ])
    )
) as Record<FleetRole, string[]>;

// group = legacy user_t.group: top-priority role key ('' for none), not the role list.
export function mapRolesToPermissions(roles: readonly FleetRole[]): {
    permissions: string[];
    group: string;
} {
    const primary = roles[0] ?? 'none';
    const merged = new Set<string>();
    for (const role of roles) {
        for (const permission of ROLE_PERMISSIONS[role] ?? []) {
            merged.add(permission);
        }
    }
    return {
        permissions: Array.from(merged),
        group: roleToGroup(primary)
    };
}

function roleToGroup(role: FleetRole): string {
    return role === 'none' ? '' : role;
}
