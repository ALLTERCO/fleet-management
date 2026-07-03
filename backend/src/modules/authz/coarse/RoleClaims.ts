import {
    authzRolePriorityIndex,
    type FleetRole
} from '../../../types/api/authzCatalog';
import {FLEET_ROLES} from './FleetRoles';
import {matchSystemPersonaRoleKey} from './RoleKeys';

export interface ExtractedClaimRoles {
    roles: FleetRole[];
    claimKeyUsed: string | null;
}

interface ExtractTokenRolesParams {
    claims: Record<string, unknown>;
    userinfo: Record<string, unknown> | null;
    projectId: string;
}

export function extractTokenRoles({
    claims,
    userinfo,
    projectId
}: ExtractTokenRolesParams): ExtractedClaimRoles {
    const claimRoles = extractRolesFromClaims(claims, {projectId});
    if (claimRoles.roles[0] !== FLEET_ROLES.NONE || !userinfo) {
        return claimRoles;
    }

    const userinfoRoles = extractRolesFromClaims(userinfo, {projectId});
    if (userinfoRoles.roles[0] === FLEET_ROLES.NONE) {
        return claimRoles;
    }

    return {
        roles: userinfoRoles.roles,
        claimKeyUsed: userinfoRoles.claimKeyUsed
            ? `userinfo/${userinfoRoles.claimKeyUsed}`
            : null
    };
}

export function extractRolesFromClaims(
    claims: Record<string, unknown>,
    opts: {projectId?: string} = {}
): ExtractedClaimRoles {
    const roles: FleetRole[] = [];
    let claimKeyUsed: string | null = null;
    const acceptClaim = (value: unknown, key: string): boolean => {
        const before = roles.length;
        collectRoles(value, roles);
        if (roles.length > before) claimKeyUsed = key;
        return roles.length > before;
    };

    acceptStandardZitadelClaim(claims, acceptClaim);
    acceptProjectBoundClaim(claims, opts, acceptClaim);
    if (roles.length === 0 && claims.roles) acceptClaim(claims.roles, 'roles');
    if (roles.length === 0 && claims.role) acceptClaim(claims.role, 'role');
    acceptResourceAccessClaim(claims, roles, acceptClaim);

    const uniqueRoles = [...new Set(roles)];
    uniqueRoles.sort(
        (a, b) => authzRolePriorityIndex(a) - authzRolePriorityIndex(b)
    );
    return {
        roles: uniqueRoles.length > 0 ? uniqueRoles : ['none'],
        claimKeyUsed
    };
}

function acceptStandardZitadelClaim(
    claims: Record<string, unknown>,
    acceptClaim: (value: unknown, key: string) => boolean
): void {
    const claimKey = 'urn:zitadel:iam:org:project:roles';
    if (claims[claimKey]) acceptClaim(claims[claimKey], claimKey);
}

function acceptProjectBoundClaim(
    claims: Record<string, unknown>,
    opts: {projectId?: string},
    acceptClaim: (value: unknown, key: string) => boolean
): void {
    const projectKeys = opts.projectId
        ? [`urn:zitadel:iam:org:project:${opts.projectId}:roles`]
        : Object.keys(claims).filter(
              (key) =>
                  key.startsWith('urn:zitadel:iam:org:project:') &&
                  key.endsWith(':roles')
          );
    for (const key of projectKeys) {
        if (Object.hasOwn(claims, key) && acceptClaim(claims[key], key)) {
            return;
        }
    }
}

function acceptResourceAccessClaim(
    claims: Record<string, unknown>,
    roles: FleetRole[],
    acceptClaim: (value: unknown, key: string) => boolean
): void {
    if (roles.length > 0 || !claims.resource_access) return;
    const resourceAccess = claims.resource_access as Record<string, unknown>;
    for (const resource of Object.values(resourceAccess)) {
        if (
            resource &&
            typeof resource === 'object' &&
            'roles' in (resource as object) &&
            acceptClaim((resource as {roles: unknown}).roles, 'resource_access')
        ) {
            return;
        }
    }
}

function collectRoles(value: unknown, roles: FleetRole[]): void {
    if (!value) return;
    if (typeof value === 'object' && !Array.isArray(value)) {
        collectObjectRoleKeys(value, roles);
        return;
    }
    if (Array.isArray(value)) {
        collectArrayRoleKeys(value, roles);
        return;
    }
    if (typeof value === 'string') collectRoleKey(value, roles);
}

function collectObjectRoleKeys(value: object, roles: FleetRole[]): void {
    for (const roleKey of Object.keys(value)) {
        collectRoleKey(roleKey, roles);
    }
}

function collectArrayRoleKeys(value: unknown[], roles: FleetRole[]): void {
    for (const item of value) {
        if (typeof item === 'string') collectRoleKey(item, roles);
    }
}

function collectRoleKey(roleKey: string, roles: FleetRole[]): void {
    const matched = matchSystemPersonaRoleKey(roleKey);
    if (matched) roles.push(matched);
}
