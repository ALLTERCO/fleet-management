export interface SystemRoleMutation {
    userId: string;
    roleKeys: string[];
    organizationId?: string;
}

export interface IdentityRoleManager {
    isSystemRoleManagementAvailable(): boolean;
    grantSystemRoles(mutation: SystemRoleMutation): Promise<void>;
    revokeSystemRoles(mutation: SystemRoleMutation): Promise<void>;
}
