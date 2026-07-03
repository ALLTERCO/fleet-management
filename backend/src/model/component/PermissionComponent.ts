// permission.* — authz reads + writes (moved off user.*).

import {authzAuditWriter} from '../../modules/authz/audit';
import {canUsePlatformAdmin} from '../../modules/authz/evaluator';
import {identityDirectory, identityRoleManager} from '../../modules/identity';
import {clearUserinfoCache} from '../../modules/user/cache';
import {evictUserSessionEverywhere} from '../../modules/user/evictUserSession';
import {
    assertTargetInTenant,
    assertTargetOwnedByTenant
} from '../../modules/user/tenantGate';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {AUTHZ_SYSTEM_PERSONA_KEYS} from '../../types/api/authzCatalog';
import {
    PERMISSION_DESCRIBE,
    PERMISSION_EMPTY_PARAMS,
    PERMISSION_GET_FOR_USER_PARAMS,
    PERMISSION_GRANT_ROLES_PARAMS,
    PERMISSION_REVOKE_ROLES_PARAMS
} from '../../types/api/permission';
import type CommandSender from '../CommandSender';
import {
    canManageOrganizationSettings,
    canReadPolicies
} from './authzPermissions';
import Component from './Component';

const CATALOG_KEYS: readonly string[] = AUTHZ_SYSTEM_PERSONA_KEYS;

function assertManagementApi() {
    if (!identityDirectory.isManagementApiAvailable()) {
        throw RpcError.InvalidParams('Zitadel Management API not available');
    }
}

function assertSystemRoleManagement() {
    if (!identityRoleManager.isSystemRoleManagementAvailable()) {
        throw RpcError.InvalidParams(
            'Identity role management API not available'
        );
    }
}

export default class PermissionComponent extends Component {
    constructor() {
        super('permission', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return PERMISSION_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('GetRoles')
    @Component.CheckPermissions(canReadPolicies)
    async getRoles(params: unknown, sender: CommandSender) {
        const {userId} = validateOrThrow<{userId: string}>(
            params,
            PERMISSION_GET_FOR_USER_PARAMS
        );
        const orgId = sender.getOrganizationId();
        if (!orgId) throw RpcError.Unauthorized();
        // Read-only: FM presence is enough for authorized policy readers.
        await assertTargetInTenant(sender, userId, orgId);
        const live = await identityDirectory.getProjectRoles({
            userId,
            organizationId: orgId
        });
        const roleKeys = live.roleKeys.filter((k) => CATALOG_KEYS.includes(k));
        return {userId, roleKeys};
    }

    @Component.Expose('RevokeRoles')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async revokeRoles(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<{userId: string; roles: string[]}>(
            params,
            PERMISSION_REVOKE_ROLES_PARAMS
        );
        const orgId = sender.getOrganizationId();
        if (!orgId) throw RpcError.Unauthorized();
        // Refuse self-revoke of admin — otherwise the tenant
        // can lose its last administrator with no recovery path.
        if (sender.getUser()?.userId === v.userId) {
            const self = new Set(v.roles);
            if (self.has('admin')) {
                throw RpcError.InvalidParams(
                    'cannot revoke admin role from your own account'
                );
            }
        }
        assertSystemRoleManagement();
        // Identity-provider role mutation requires target home-org ownership.
        await assertTargetOwnedByTenant(sender, v.userId, orgId);
        const roles = Array.from(new Set(v.roles));
        await identityRoleManager.revokeSystemRoles({
            userId: v.userId,
            roleKeys: roles,
            organizationId: orgId
        });
        clearUserinfoCache();
        evictUserSessionEverywhere(v.userId, 'permission.revokeRoles');
        await authzAuditWriter.writePermissionRoleEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'revoke_roles',
            userId: v.userId,
            roles
        });
        return {success: true, userId: v.userId, roles};
    }

    @Component.Expose('GrantRoles')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async grantRoles(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<{userId: string; roles: string[]}>(
            params,
            PERMISSION_GRANT_ROLES_PARAMS
        );
        const orgId = sender.getOrganizationId();
        if (!orgId) throw RpcError.Unauthorized();
        assertSystemRoleManagement();
        // Identity-provider role mutation requires target home-org ownership.
        await assertTargetOwnedByTenant(sender, v.userId, orgId);
        const roles = Array.from(new Set(v.roles));
        await identityRoleManager.grantSystemRoles({
            userId: v.userId,
            roleKeys: roles,
            organizationId: orgId
        });
        clearUserinfoCache();
        evictUserSessionEverywhere(v.userId, 'permission.grantRoles');
        // Audit + invalidate tenant cache so mid-session role changes
        // propagate to live WS sessions without waiting for JWT refresh.
        await authzAuditWriter.writePermissionRoleEvent({
            tenantId: orgId,
            actorId: sender.getUser()?.username ?? 'unknown',
            operation: 'grant_roles',
            userId: v.userId,
            roles
        });
        return {success: true, userId: v.userId, roles};
    }

    // Provider-support only. The organization is resolved before the provider call.
    @Component.NoAudit
    @Component.Expose('ListAdministrators')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async listAdministrators(params: unknown, sender: CommandSender) {
        validateOrThrow<Record<string, never>>(params, PERMISSION_EMPTY_PARAMS);
        assertManagementApi();
        const organizationId = requireOrganizationId(sender);
        const items =
            await identityDirectory.listOrganizationAdministrators(
                organizationId
            );
        return {
            items,
            total: items.length,
            limit: 0,
            offset: 0,
            has_more: false
        };
    }

    // Instance-level Zitadel policy — provider support only.
    @Component.NoAudit
    @Component.Expose('GetIdentityPolicies')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async getIdentityPolicies(params: unknown) {
        validateOrThrow<Record<string, never>>(params, PERMISSION_EMPTY_PARAMS);
        assertManagementApi();
        return await identityDirectory.getIdentityPolicies();
    }
}
