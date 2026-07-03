import {
    AUTHZ_ROLE_ALIASES,
    AUTHZ_SYSTEM_PERSONA_KEYS,
    type AuthzSystemPersonaKey,
    type FleetRole
} from '../../../types/api/authzCatalog';

export function matchSystemPersonaRoleKey(
    roleKey: string
): AuthzSystemPersonaKey | null {
    const normalized = roleKey.toLowerCase().trim();
    for (const key of AUTHZ_SYSTEM_PERSONA_KEYS) {
        if (normalized === key) return key;
        if (AUTHZ_ROLE_ALIASES[key].includes(normalized)) return key;
    }
    return null;
}

export function matchProviderRoleKey(roleKey: string): FleetRole | null {
    const normalized = roleKey.toLowerCase().trim();
    return matchSystemPersonaRoleKey(normalized);
}
