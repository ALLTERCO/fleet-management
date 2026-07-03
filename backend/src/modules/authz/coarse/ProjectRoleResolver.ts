// Gate 4 of the coarse auth chain: when the token's role claims are empty
// AND the org is platform-pinned or the configured tenant, ask the identity
// directory for the user's project roles. Skips the round-trip when the
// token already declared roles or when the org isn't one we look up.

import type {FleetRole} from '../../../types/api/authzCatalog';
import type {DeploymentTopology, IdentityDirectory} from '../../identity';

export async function loadDirectoryRolesIfNeeded(input: {
    userId: string;
    authOrgId: string;
    roles: readonly FleetRole[];
    roleSource: string | null;
    topology: DeploymentTopology;
    identityDirectory: IdentityDirectory;
}): Promise<{roles: FleetRole[]; roleSource: string | null}> {
    const roles = [...input.roles];
    if (
        !shouldLoadRolesFromDirectory({
            roles,
            organizationId: input.authOrgId,
            pinnedOrgId: input.topology.clientOrgId,
            platformOrgId: input.topology.platformOrgId
        })
    ) {
        return {roles, roleSource: input.roleSource};
    }
    const fromDirectory = await input.identityDirectory.getProjectRoles({
        userId: input.userId,
        organizationId: input.authOrgId
    });
    if (fromDirectory.roles[0] === 'none') {
        return {roles, roleSource: input.roleSource};
    }
    return {
        roles: fromDirectory.roles,
        roleSource: input.identityDirectory.roleAssignmentSource
    };
}

export function shouldLoadRolesFromDirectory(input: {
    roles: readonly FleetRole[];
    organizationId?: string;
    pinnedOrgId?: string;
    platformOrgId?: string;
}): boolean {
    if (
        input.pinnedOrgId !== undefined &&
        input.organizationId === input.pinnedOrgId
    ) {
        return true;
    }
    if (
        input.platformOrgId !== undefined &&
        input.organizationId === input.platformOrgId
    ) {
        return true;
    }
    if (input.roles[0] !== 'none') return false;
    return false;
}
