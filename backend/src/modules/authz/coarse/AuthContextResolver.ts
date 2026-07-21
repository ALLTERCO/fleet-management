// Orchestrator for the four coarse-auth gates. Each gate lives in its
// own file so it is independently testable; this file wires them in
// the order: organization → role load → platform-admin → pinned policy
// → fleet-manager access.

import type {FleetRole} from '../../../types/api/authzCatalog';
import type {DeploymentTopology, IdentityDirectory} from '../../identity';
import type {AuthContext} from './AuthContext';
import {isDefaultRootOrganizationOnly} from './OrganizationResolver';
import {
    effectiveOrganizationIdForAuthenticatedUser,
    isAllowedForPinnedOrganization
} from './PinnedTenantPolicy';
import {hasPlatformAdminAuthority} from './PlatformAdminResolver';
import {loadDirectoryRolesIfNeeded} from './ProjectRoleResolver';

export interface AuthContextResolutionSuccess {
    ok: true;
    context: AuthContext;
    roleSource: string | null;
}

export interface AuthContextResolutionFailure {
    ok: false;
    reason: 'org_mismatch';
}

export type AuthContextResolution =
    | AuthContextResolutionSuccess
    | AuthContextResolutionFailure;

export async function resolveAuthContext(input: {
    userId: string;
    authOrgId: string;
    roles: readonly FleetRole[];
    roleSource: string | null;
    topology: DeploymentTopology;
    identityDirectory: IdentityDirectory;
    hasFineGrainedAccess: (input: {
        userId: string;
        tenantId: string;
    }) => Promise<boolean>;
}): Promise<AuthContextResolution> {
    const roleResolution = await loadDirectoryRolesIfNeeded(input);
    if (
        isDefaultRootOrganizationOnly({
            organizationId: input.authOrgId,
            rootOrgId: input.topology.rootOrgId,
            clientOrgId: input.topology.clientOrgId,
            platformOrgId: input.topology.platformOrgId
        })
    ) {
        return {ok: false, reason: 'org_mismatch'};
    }
    const roles = [...roleResolution.roles];
    const isPlatformAdmin = await hasPlatformAdminAuthority({
        userId: input.userId,
        organizationId: input.authOrgId,
        platformOrgId: input.topology.platformOrgId,
        identityDirectory: input.identityDirectory
    });
    if (
        !isAllowedForPinnedOrganization({
            isPlatformAdmin,
            organizationId: input.authOrgId,
            pinnedOrgId: input.topology.clientOrgId
        })
    ) {
        return {ok: false, reason: 'org_mismatch'};
    }
    const effectiveOrgId = effectiveOrganizationIdForAuthenticatedUser({
        isPlatformAdmin,
        organizationId: input.authOrgId,
        pinnedOrgId: input.topology.clientOrgId
    });
    // A valid, org-matched user with no Fleet Manager access is still admitted,
    // with an empty permission set — the app routes them to /no-permissions
    // instead of failing the login. Wrong-org tokens are already rejected by the
    // organization checks above.
    const hasAccess = await hasFleetManagerAccess({
        userId: input.userId,
        tenantId: effectiveOrgId,
        roles,
        isPlatformAdmin,
        hasFineGrainedAccess: input.hasFineGrainedAccess
    });
    return {
        ok: true,
        roleSource: roleResolution.roleSource,
        context: {
            userId: input.userId,
            authOrgId: input.authOrgId,
            effectiveOrgId,
            roles: hasAccess ? roles : [],
            isPlatformAdmin,
            tenantPinned: input.topology.clientOrgId !== undefined
        }
    };
}

async function hasFleetManagerAccess(input: {
    userId: string;
    tenantId: string;
    roles: readonly FleetRole[];
    isPlatformAdmin: boolean;
    hasFineGrainedAccess: (input: {
        userId: string;
        tenantId: string;
    }) => Promise<boolean>;
}): Promise<boolean> {
    if (input.isPlatformAdmin) return true;
    if (input.roles.some((role) => role !== 'none')) return true;
    return input.hasFineGrainedAccess({
        userId: input.userId,
        tenantId: input.tenantId
    });
}
