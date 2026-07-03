import {
    AUTHZ_SYSTEM_PERSONA_KEYS,
    type FleetRole
} from '../../../types/api/authzCatalog';

export const FLEET_ROLES = {
    NONE: 'none' as const,
    ...Object.fromEntries(
        AUTHZ_SYSTEM_PERSONA_KEYS.map((key) => [key.toUpperCase(), key])
    )
} as Record<string, FleetRole>;
