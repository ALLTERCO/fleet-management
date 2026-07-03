import type {FleetRole} from '../../types/api/authzCatalog';

export interface ProjectRoleAssignment {
    roles: FleetRole[];
    roleKeys: string[];
}

export interface ProjectRoleQuery {
    userId: string;
    organizationId?: string;
}

export interface TenantMembershipQuery {
    userId: string;
    tenantId: string;
}

export interface InstanceAdminRoleQuery {
    userId: string;
    roleKey: string;
}

export interface OrganizationAdministrator {
    userId: string;
    preferredLoginName?: string;
    organizationId?: string;
    organizationName?: string;
    roles: string[];
    creationDate?: string;
}

export interface IdentityPolicies {
    login: Record<string, unknown> | null;
    passwordComplexity: Record<string, unknown> | null;
    passwordExpiry: Record<string, unknown> | null;
    lockout: Record<string, unknown> | null;
    security: Record<string, unknown> | null;
    branding: Record<string, unknown> | null;
    identityProviders: Array<Record<string, unknown>> | null;
}

export interface ServiceUserMetadata {
    permissions: string[];
}

export interface IdentityDirectory {
    readonly roleAssignmentSource: string;
    isManagementApiAvailable(): boolean;
    getDeploymentRoleScopeId(): Promise<string>;
    getProjectRoles(query: ProjectRoleQuery): Promise<ProjectRoleAssignment>;
    userBelongsToTenant(query: TenantMembershipQuery): Promise<boolean>;
    hasInstanceAdministratorRole(
        query: InstanceAdminRoleQuery
    ): Promise<boolean>;
    listOrganizationAdministrators(
        organizationId: string
    ): Promise<OrganizationAdministrator[]>;
    getIdentityPolicies(): Promise<IdentityPolicies>;
    getServiceUserMetadata(userId: string): Promise<ServiceUserMetadata>;
}
