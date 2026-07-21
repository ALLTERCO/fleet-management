import {type ComputedRef, computed} from 'vue';
import {useAuthStore} from '@/stores/auth';

// Single source of truth for "can the current user call backend RPC X".
// Each entry mirrors a backend @Component.CheckPermissions decorator.
// Content-resource RPCs still flow through canPerformComponent(...).

export type RpcPermissionRequest = {
    method: RpcName;
    selfUserId?: string;
};

export type RpcAccessContext = {
    isAdmin: boolean;
    canAccessPlatformAdmin: boolean;
    canReadPolicies: boolean;
    canViewAuditLog: boolean;
    canManageOrganizationSettings: boolean;
    userId?: string;
};

type RpcPermissionRule = {
    owns(method: RpcName): boolean;
    allows(access: RpcAccessContext, request: RpcPermissionRequest): boolean;
};

// Backend: provider-support checks — instance-level operations that cross
// tenant boundaries. Tenant admins must not see these.
const PROVIDER_SUPPORT_ONLY_RPCS: ReadonlySet<string> = new Set([
    'User.GetInstanceInfo',
    'User.DeleteSession',
    // canCrossOrganizationBoundary — reassigns a service user's org.
    'User.SetServiceUserOrg',
    // canUsePlatformAdmin — same family as the System.* debug toggles below.
    'User.SetAllowDebug',
    // Identity namespace — instance-wide Zitadel admin API.
    'Identity.ListIdentityProviders',
    'Identity.AddOidcProvider',
    'Identity.DeleteIdentityProvider',
    'Identity.RotateActionSigningKeys',
    'Identity.GetScimSettings',
    'Identity.SetScimEnabled',
    'Identity.GetJwtIntentSettings',
    'Identity.GetSmtpSettings',
    'Identity.SetSmtpSettings',
    'Identity.TestSmtpSettings',
    // permission.* — instance-wide Zitadel state.
    'permission.GetIdentityPolicies',
    'permission.ListAdministrators',
    // Instance-wide policies.
    'Restrictions.Get',
    'Restrictions.Set',
    'domain_policy.GetInstance',
    'domain_policy.SetInstance',
    // Instance controls.
    'System.DbWrites.Set',
    'System.Observability.Set',
    'System.Observability.Reset',
    'System.Log.SetLevel',
    // Plugin manage — installs code fleet-wide in the FM process.
    'Plugin.Upload',
    'Plugin.Remove'
]);

// Backend: `@Component.CheckPermissions(canManageAuthz)` or
// `(sender) => sender.isAdmin()` — listed in canonical wire-name form.
const ADMIN_ONLY_RPCS: ReadonlySet<string> = new Set([
    // Assignments / personas / groups (canManageAuthz on the backend)
    'assignment.create',
    'assignment.delete',
    'persona.create',
    'persona.update',
    'persona.delete',
    'user_group.create',
    'user_group.update',
    'user_group.delete',
    'user_group.addmembers',
    'user_group.removemembers',
    // Authz utility
    'User.SimulateV2',
    'User.AttachCustomPersona',
    'permission.GrantRoles',
    'permission.RevokeRoles',
    // Branding + identity policies
    'Branding.SetPolicy',
    'Branding.Activate',
    'Branding.Reset',
    'Branding.SetLogo',
    'Branding.DeleteLogo',
    'Branding.SetIcon',
    'Branding.DeleteIcon',
    'Branding.SetFont',
    'Branding.DeleteFont',
    'Branding.SetMailTemplate',
    'Branding.ResetMailTemplate',
    'Branding.GetPreview',
    'Privacy.SetPolicy',
    'Privacy.Reset',
    'domain_policy.SetPolicy',
    'domain_policy.Reset',
    'notification_policy.SetPolicy',
    'notification_policy.Reset',
    'login_text.SetText',
    'login_text.Reset',
    'message_text.SetText',
    'message_text.Reset',
    // Media assets
    'Media.Background.CreateUploadTicket',
    'Media.Background.Delete'
]);

// Backend: `@Component.CheckPermissions(canManageOrganizationSettings)`.
// This mirrors the backend's organizations:update capability instead of
// widening every organization manager into a frontend "admin".
const ORGANIZATION_SETTINGS_RPCS: ReadonlySet<string> = new Set([
    'User.CreateZitadelUser',
    'User.UpdateZitadelUser',
    'User.DeleteZitadelUser',
    'User.DeactivateUser',
    'User.ReactivateUser',
    'User.SendPasswordReset',
    'User.CreateServiceUser',
    'User.DeleteServiceUser',
    'User.CreatePAT',
    'User.RotatePAT',
    'User.RevokePAT',
    'User.BulkRotatePATs',
    'User.CreateScopedPAT',
    'User.RevokeScopedPAT',
    'User.RevokeAllUserPATs',
    'User.RotateScopedPAT'
]);

// Backend: `@Component.CheckPermissions(canReadPolicies)` — admin OR auditor.
const POLICY_READABLE_RPCS: ReadonlySet<string> = new Set([
    'assignment.list',
    'assignment.listforresource',
    'assignment.listforsubject',
    'assignment.listforpersona',
    'assignment.listunused',
    'persona.list',
    'persona.get',
    'user_group.list',
    'user_group.get',
    'user_group.listmembers',
    'User.ListZitadelUsers',
    'User.ListServiceUsers',
    'User.ListPATs',
    'User.ListScopedPATs',
    'authz_audit.list'
]);

// Backend: `@Component.CheckPermissions(canViewAuditLog)` — admin OR auditor.
// (Same shape as canReadPolicies today; the wire layer is named differently
//  because the backend may diverge them later.)
const AUDIT_VIEWABLE_RPCS: ReadonlySet<string> = new Set([
    'audit.list',
    'audit.get'
]);

// Backend: admin OR self — caller may invoke for own userId.
const ADMIN_OR_SELF_RPCS: ReadonlySet<string> = new Set([
    'User.GetEffectivePermissionsV2'
]);

const RPC_PERMISSION_RULES: readonly RpcPermissionRule[] = [
    roleRule(
        PROVIDER_SUPPORT_ONLY_RPCS,
        (access) => access.canAccessPlatformAdmin
    ),
    roleRule(ADMIN_ONLY_RPCS, (access) => access.isAdmin),
    roleRule(
        ORGANIZATION_SETTINGS_RPCS,
        (access) => access.canManageOrganizationSettings
    ),
    roleRule(POLICY_READABLE_RPCS, (access) => access.canReadPolicies),
    roleRule(AUDIT_VIEWABLE_RPCS, (access) => access.canViewAuditLog),
    adminOrSelfRule()
];

export type RpcName = string;

export interface RpcPermissions {
    /** Synchronous one-shot check. */
    canCall(method: RpcName, opts?: {selfUserId?: string}): boolean;
    /** Reactive wrapper for templates / `:disabled` props. */
    canCallRef(
        method: RpcName,
        opts?: {selfUserId?: string}
    ): ComputedRef<boolean>;
}

export function canCallRpc(
    access: RpcAccessContext,
    request: RpcPermissionRequest
): boolean {
    const rule = RPC_PERMISSION_RULES.find((candidate) =>
        candidate.owns(request.method)
    );
    if (!rule) return true;
    return rule.allows(access, request);
}

export function useRpcPermissions(): RpcPermissions {
    const auth = useAuthStore();

    function canCall(method: RpcName, opts?: {selfUserId?: string}): boolean {
        return canCallRpc(authAccessContext(auth), {
            method,
            selfUserId: opts?.selfUserId
        });
    }

    function canCallRef(
        method: RpcName,
        opts?: {selfUserId?: string}
    ): ComputedRef<boolean> {
        return computed(() => canCall(method, opts));
    }

    return {canCall, canCallRef};
}

function roleRule(
    methods: ReadonlySet<string>,
    allows: (access: RpcAccessContext) => boolean
): RpcPermissionRule {
    return {
        owns: (method) => methods.has(method),
        allows
    };
}

function adminOrSelfRule(): RpcPermissionRule {
    return {
        owns: (method) => ADMIN_OR_SELF_RPCS.has(method),
        allows: (access, request) =>
            access.isAdmin ||
            (!!request.selfUserId &&
                !!access.userId &&
                request.selfUserId === access.userId)
    };
}

function authAccessContext(
    auth: ReturnType<typeof useAuthStore>
): RpcAccessContext {
    return {
        isAdmin: auth.isAdmin,
        canAccessPlatformAdmin: auth.canAccessPlatformAdmin,
        canReadPolicies: auth.canReadPolicies,
        canViewAuditLog: auth.canViewAuditLog,
        canManageOrganizationSettings: auth.canPerformComponent(
            'organizations',
            'update'
        ),
        userId: auth.zitadelUser?.sub
    };
}
