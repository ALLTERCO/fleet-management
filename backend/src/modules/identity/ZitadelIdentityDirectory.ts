import {zitadelService} from '../zitadel';
import type {
    IdentityDirectory,
    ProjectRoleAssignment,
    ProjectRoleQuery,
    TenantMembershipQuery
} from './IdentityDirectory';

export class ZitadelIdentityDirectory implements IdentityDirectory {
    readonly roleAssignmentSource = 'project-role-assignments';

    isManagementApiAvailable(): boolean {
        return zitadelService.isManagementApiAvailable();
    }

    async getDeploymentRoleScopeId(): Promise<string> {
        return zitadelService.getFleetProjectId();
    }

    async getProjectRoles(
        query: ProjectRoleQuery
    ): Promise<ProjectRoleAssignment> {
        return zitadelService.getUserRoles(query.userId, query.organizationId);
    }

    async userBelongsToTenant(query: TenantMembershipQuery): Promise<boolean> {
        return zitadelService.userBelongsToTenant(query.userId, query.tenantId);
    }

    async hasInstanceAdministratorRole(query: {
        userId: string;
        roleKey: string;
    }): Promise<boolean> {
        return zitadelService.hasInstanceAdministratorRole(
            query.userId,
            query.roleKey
        );
    }

    async listOrganizationAdministrators(organizationId: string) {
        return zitadelService.listOrganizationAdministrators(organizationId);
    }

    async getIdentityPolicies() {
        return zitadelService.getIdentityPolicies();
    }

    async getServiceUserMetadata(userId: string) {
        const md = await zitadelService.getUserMetadata(userId);
        return {permissions: md.permissions};
    }
}

export const identityDirectory: IdentityDirectory =
    new ZitadelIdentityDirectory();
