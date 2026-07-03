import {zitadelService} from '../zitadel';
import type {
    IdentityRoleManager,
    SystemRoleMutation
} from './IdentityRoleManager';

export class ZitadelIdentityRoleManager implements IdentityRoleManager {
    isSystemRoleManagementAvailable(): boolean {
        return zitadelService.isManagementApiAvailable();
    }

    async grantSystemRoles(mutation: SystemRoleMutation): Promise<void> {
        await zitadelService.ensureProjectRoles(
            mutation.userId,
            mutation.roleKeys,
            mutation.organizationId
        );
    }

    async revokeSystemRoles(mutation: SystemRoleMutation): Promise<void> {
        await zitadelService.removeProjectRoles(
            mutation.userId,
            mutation.roleKeys,
            mutation.organizationId
        );
    }
}

export const identityRoleManager: IdentityRoleManager =
    new ZitadelIdentityRoleManager();
