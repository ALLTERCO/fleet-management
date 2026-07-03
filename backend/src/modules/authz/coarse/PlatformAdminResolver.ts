// Gate 2 of the coarse auth chain: does this user hold the instance-admin
// role (default IAM_OWNER) in the configured platform org? Answer becomes
// AuthContext.isPlatformAdmin downstream — the "trusted platform
// support" short-circuit for cross-tenant operations.

import {fmPlatformAdminRole} from '../../../config/zitadel';
import type {IdentityDirectory} from '../../identity';

export async function hasPlatformAdminAuthority(input: {
    userId: string;
    organizationId?: string;
    platformOrgId?: string;
    identityDirectory: IdentityDirectory;
}): Promise<boolean> {
    if (input.platformOrgId === undefined) return false;
    if (input.organizationId !== input.platformOrgId) return false;
    return input.identityDirectory.hasInstanceAdministratorRole({
        userId: input.userId,
        roleKey: fmPlatformAdminRole()
    });
}

export function hasTrustedPlatformAdmin(input: {
    isPlatformAdmin: boolean;
}): boolean {
    return input.isPlatformAdmin;
}
