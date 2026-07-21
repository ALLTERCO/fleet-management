import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {tuning} from '../../config/tuning';
import type CommandSender from '../../model/CommandSender';
import {
    canManageOrganizationSettings,
    canReadPolicies
} from '../../model/component/authzPermissions';
import Component from '../../model/component/Component';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ASSIGNMENT_CREATE_PARAMS_SCHEMA,
    type AssignmentCreateParams,
    type AssignmentScope
} from '../../types/api/assignment';
import {AUTHZ_SYSTEM_PERSONA_KEYS} from '../../types/api/authzCatalog';
import {USERNAME_UPLOAD_TICKET_PARAMS_SCHEMA} from '../../types/api/upload';
import {USER_DESCRIBE} from '../../types/api/user';
import * as AuditLogger from '../AuditLogger';
import {createAssignmentGrant, loadAttachablePersona} from '../authz/admin';
import {
    canCrossOrganizationBoundary,
    canUseAuthenticatedRead,
    canUsePlatformAdmin,
    hasTenantAdminAuthority,
    resolveUiCapabilities
} from '../authz/evaluator';
import {
    accessProvenanceFromShape,
    effectiveShapeNoAccessReason,
    summarizeAccessProvenance
} from '../authz/provenance';
import {
    buildEffectiveShape,
    simulate as resolverSimulate
} from '../authz/resolver';
import {tryGetAuthzRuntime} from '../authz/runtime';
import {isExplicitScope, SCOPE_NOT_EXPLICIT_MESSAGE} from '../authz/scopeGuard';
import {identityDirectory} from '../identity';
import {
    issueUploadTicket,
    uploadTicketResponse,
    uploadTicketUserFromSender
} from '../uploadTickets';
import {appendUploadAssetToken} from '../web/utils/uploadAssetTokens';
import {profilePicturesPath} from '../web/utils/uploadPaths';
import type {ConnectionContext} from '../web/ws/ConnectionContext';
import {
    createScopedPATImpl,
    listScopedPATsImpl,
    previewScopedPATImpl,
    revokeAllUserPATsImpl,
    revokeScopedPATImpl,
    rotateScopedPATImpl
} from './scopedPats';
import {
    createServiceUser as createServiceUserImpl,
    deleteServiceUser as deleteServiceUserImpl,
    listServiceUsers as listServiceUsersImpl,
    setServiceUserOrg as setServiceUserOrgImpl
} from './serviceUsers';
import {
    authenticateAlexa as authenticateAlexaImpl,
    authenticate as authenticateImpl,
    refreshAlexa as refreshAlexaImpl,
    refresh as refreshImpl,
    rotateToken as rotateTokenImpl
} from './sessionAuth';
import {
    deleteSession as deleteSessionImpl,
    getAuthMethods as getAuthMethodsImpl,
    getInstanceInfo as getInstanceInfoImpl,
    listSessions as listSessionsImpl
} from './sessions';
import {assertTargetInTenant} from './tenantGate';
import {ensureZitadelManagement} from './validation';
import {
    bulkRotatePats as bulkRotateZitadelPats,
    createPat as createZitadelPat,
    listPats as listZitadelPats,
    revokePat as revokeZitadelPat,
    rotatePat as rotateZitadelPat
} from './zitadelPats';
import {
    assertProfilePictureVisible,
    createZitadelUser as createZitadelUserImpl,
    deactivateZitadelUser as deactivateZitadelUserImpl,
    deleteZitadelUser as deleteZitadelUserImpl,
    listZitadelUsers as listZitadelUsersImpl,
    reactivateZitadelUser as reactivateZitadelUserImpl,
    sendPasswordReset as sendPasswordResetImpl,
    updateZitadelUser as updateZitadelUserImpl,
    zitadelAvailable as zitadelAvailableImpl
} from './zitadelUserCrud';

const CATALOG_KEYS: readonly string[] = AUTHZ_SYSTEM_PERSONA_KEYS;

// Live JWT roles for a user, filtered to keys the persona catalog knows.
async function loadCatalogBuiltInRoles(
    userId: string,
    organizationId: string
): Promise<string[]> {
    const live = await identityDirectory.getProjectRoles({
        userId,
        organizationId
    });
    return live.roleKeys.filter((k) => CATALOG_KEYS.includes(k));
}

function assertCatalogRoles(roles: string[]): string[] {
    const unknown = roles.filter((r) => !CATALOG_KEYS.includes(r));
    if (unknown.length > 0) {
        throw RpcError.InvalidParams(
            `unknown builtInRoles: ${unknown.join(', ')}`
        );
    }
    return roles;
}

function canCreateProfilePictureUploadTicket(
    sender: CommandSender,
    params: unknown
): boolean {
    const username = (params as {username?: unknown})?.username;
    return (
        typeof username === 'string' &&
        (canCrossOrganizationBoundary(sender) ||
            sender.getUser()?.username === username)
    );
}

const canRemoveProfilePicture = canCreateProfilePictureUploadTicket;

function canReadProfilePictureUrl(
    sender: CommandSender,
    params: unknown
): boolean {
    const username = (params as {username?: unknown})?.username;
    return typeof username === 'string' && sender.getUser() !== undefined;
}

function canReadEffectivePermissions(
    sender: CommandSender,
    params: unknown
): boolean {
    if (hasTenantAdminAuthority(sender)) return true;
    return sender.getUserId() === (params as {userId?: string})?.userId;
}

export interface UserComponentConfig {
    allowDebugUser: boolean;
}

// Validate + return the username param (rejects path traversal + odd chars).
function validatedUsername(params: unknown): string {
    const p = validateOrThrow<{username: string}>(
        params,
        USERNAME_UPLOAD_TICKET_PARAMS_SCHEMA
    );
    if (!/^[a-zA-Z0-9@._-]+$/.test(p.username) || p.username.includes('..')) {
        throw RpcError.InvalidParams('Invalid username');
    }
    return p.username;
}

export default class UserComponent extends Component<UserComponentConfig> {
    constructor() {
        super('user', {viewer_visible: true});

        this.methods.delete('setconfig');
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return USER_DESCRIBE;
    }

    // Instance-wide debug flag — provider support only.
    @Component.Expose('SetAllowDebug')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async setAllowDebug(params: {enabled: boolean}) {
        const enabled = params?.enabled;
        if (typeof enabled !== 'boolean') {
            throw RpcError.InvalidParams('enabled must be a boolean');
        }
        await this.setConfig({...this.config, allowDebugUser: enabled});
        return {allowDebugUser: this.config.allowDebugUser};
    }

    @Component.Expose('AuthenticateAlexa')
    @Component.NoPermissions
    async authenticateAlexa(
        params: {username?: unknown; endpoint?: unknown} | undefined,
        sender: CommandSender
    ) {
        return authenticateAlexaImpl(params, sender);
    }

    @Component.Expose('RefreshAlexa')
    @Component.NoPermissions
    async refreshAlexa(params: {refresh_token?: unknown} | undefined) {
        return refreshAlexaImpl(params);
    }

    @Component.Expose('Authenticate')
    @Component.NoPermissions
    async authenticate(
        params:
            | {
                  username?: unknown;
                  password?: unknown;
                  purpose?: unknown;
                  endpoint?: unknown;
              }
            | undefined
    ) {
        return authenticateImpl(params);
    }

    @Component.Expose('RotateToken')
    @Component.NoPermissions
    async rotateToken(
        params: {access_token?: unknown} | undefined,
        _sender: CommandSender,
        ctx?: ConnectionContext
    ) {
        return rotateTokenImpl(params, ctx);
    }

    @Component.Expose('Refresh')
    @Component.NoPermissions
    async refresh(params: {refresh_token?: unknown} | undefined) {
        return refreshImpl(params);
    }

    // Legacy User.Create / Update / Delete / List / Find removed —
    // they operated on a pre-Zitadel local pg user table that no longer
    // backs authentication. Self-service password change now goes
    // through the Zitadel self-service flow. ZitadelUser RPCs handle
    // admin-side user management.

    @Component.NoAudit
    @Component.Expose('GetMe')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    async getMe(_params: any, sender: CommandSender) {
        return {
            roles: sender.getRoles(),
            group: sender.getGroup(),
            canWrite: sender.canWrite(),
            isAdmin: hasTenantAdminAuthority(sender),
            isPlatformAdmin: canUsePlatformAdmin(sender),
            isViewer: sender.isViewer(),
            effectiveShape: sender.getEffectiveShape(),
            uiCapabilities: resolveUiCapabilities(sender)
        };
    }

    @Component.NoAudit
    @Component.Expose('ProfilePicture.CreateUploadTicket')
    @Component.CheckPermissions(canCreateProfilePictureUploadTicket)
    async profilePictureCreateUploadTicket(
        params: unknown,
        sender: CommandSender
    ) {
        const username = validatedUsername(params);
        return uploadTicketResponse(
            await issueUploadTicket({
                kind: 'profile_picture',
                user: uploadTicketUserFromSender(sender),
                payload: {username}
            })
        );
    }

    @Component.NoAudit
    @Component.Expose('ProfilePicture.GetUrl')
    @Component.CheckPermissions(canReadProfilePictureUrl)
    async profilePictureGetUrl(params: unknown, sender: CommandSender) {
        const username = validatedUsername(params);
        await assertProfilePictureVisible(sender, username);
        const assetPath = `${username}.png`;
        return {
            url: `/uploads/profilePics/${appendUploadAssetToken(
                'profilePic',
                assetPath,
                tuning.upload.assetUrlTtlSec
            )}`
        };
    }

    @Component.Expose('ProfilePicture.Remove')
    @Component.CheckPermissions(canRemoveProfilePicture)
    async profilePictureRemove(params: unknown) {
        const username = validatedUsername(params);
        const file = `${profilePicturesPath}/${path.basename(username)}.png`;
        try {
            await fs.unlink(file);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        return {removed: true};
    }

    // ========================================================================
    // ZITADEL USER MANAGEMENT
    // ========================================================================

    @Component.Expose('ZitadelAvailable')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    async zitadelAvailable() {
        return zitadelAvailableImpl();
    }

    @Component.Expose('ListZitadelUsers')
    @Component.CheckPermissions(canReadPolicies)
    async listZitadelUsers(_params: unknown, sender: CommandSender) {
        return listZitadelUsersImpl(sender);
    }

    @Component.NoAudit
    @Component.Expose('GetEffectivePermissionsV2')
    @Component.CheckPermissions(canReadEffectivePermissions)
    async getEffectivePermissionsV2(
        {userId}: {userId: string},
        sender: CommandSender
    ) {
        if (!userId) throw RpcError.InvalidParams('userId required');
        const tenantId = sender.getOrganizationId();
        if (!tenantId) throw RpcError.InvalidParams('tenant context missing');
        const rt = tryGetAuthzRuntime();
        if (!rt) throw RpcError.InvalidParams('authz runtime not initialised');
        await this.#assertTargetTenantAuditedOnDeny(sender, userId, tenantId);
        const builtInRoles = await this.#resolveBuiltInRoles(
            sender,
            userId,
            tenantId
        );
        const shape = await buildEffectiveShape(
            {cache: rt.cache, db: rt.db, l1: rt.l1},
            userId,
            tenantId,
            builtInRoles
        );
        const provenance = summarizeAccessProvenance(
            builtInRoles,
            accessProvenanceFromShape(shape)
        );
        return {
            userId,
            tenantId,
            shape,
            provenance,
            hasCredentialBoundary:
                userId === sender.getUserId() && sender.hasCredentialBoundary(),
            noAccessReason: effectiveShapeNoAccessReason(shape)
        };
    }

    // @NoAudit caller — log cross-tenant denial explicitly so the audit trail
    // does not lose this rejection.
    async #assertTargetTenantAuditedOnDeny(
        sender: CommandSender,
        userId: string,
        tenantId: string
    ): Promise<void> {
        try {
            await assertTargetInTenant(sender, userId, tenantId);
        } catch (err) {
            AuditLogger.logRpc({
                username: sender.getUser()?.username,
                actorUserId: sender.getUserId(),
                method: 'User.GetEffectivePermissionsV2.CrossTenantDenied',
                params: {userId},
                success: false,
                errorMessage: err instanceof Error ? err.message : String(err),
                organizationId: tenantId,
                ipAddress: sender.getSourceIp()
            });
            throw err;
        }
    }

    async #resolveBuiltInRoles(
        sender: CommandSender,
        userId: string,
        tenantId: string
    ): Promise<string[]> {
        if (userId === sender.getUserId()) return [...sender.getRoles()];
        const dir = await identityDirectory.getProjectRoles({
            userId,
            organizationId: tenantId
        });
        return dir.roles;
    }

    @Component.NoAudit
    @Component.Expose('SimulateV2')
    @Component.CheckPermissions(canReadPolicies)
    async simulateV2(
        params: {
            userId: string;
            action: string;
            resourceType: string;
            resourceId?: string | number;
            builtInRoles?: string[];
            context?: {
                mfaPresent?: boolean;
                sourceIp?: string;
                now?: number;
            };
        },
        sender: CommandSender
    ) {
        if (!params?.userId || !params.action || !params.resourceType) {
            throw RpcError.InvalidParams(
                'userId, action, resourceType required'
            );
        }
        const tenantId = sender.getOrganizationId();
        if (!tenantId) throw RpcError.InvalidParams('tenant context missing');
        // Target must be in the sender's tenant — otherwise simulate would
        // leak cross-tenant role and effective-shape info via the result.
        // @NoAudit method — log cross-tenant rejection explicitly.
        try {
            await assertTargetInTenant(sender, params.userId, tenantId);
        } catch (err) {
            AuditLogger.logRpc({
                username: sender.getUser()?.username,
                actorUserId: sender.getUserId(),
                method: 'User.SimulateV2.CrossTenantDenied',
                params: {userId: params.userId, action: params.action},
                success: false,
                errorMessage: err instanceof Error ? err.message : String(err),
                organizationId: tenantId,
                ipAddress: sender.getSourceIp()
            });
            throw err;
        }
        // Omitted = use the user's actual JWT roles. Explicit (incl. []) = override.
        const builtInRoles =
            params.builtInRoles === undefined
                ? await loadCatalogBuiltInRoles(params.userId, tenantId)
                : assertCatalogRoles(params.builtInRoles);
        const rt = tryGetAuthzRuntime();
        if (!rt) throw RpcError.InvalidParams('authz runtime not initialised');
        return await resolverSimulate(
            {cache: rt.cache, db: rt.db, l1: rt.l1},
            {
                userId: params.userId,
                tenantId,
                builtInRoles,
                action: params.action,
                resource: {
                    type: params.resourceType,
                    id: params.resourceId ?? '*'
                },
                context: params.context
            }
        );
    }

    @Component.Expose('AttachCustomPersona')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async attachCustomPersona(
        rawParams: {
            userId: string;
            personaId: string;
            scope: AssignmentScope;
            reason?: string | null;
            comment?: string | null;
            expiresAt?: string | null;
        },
        sender: CommandSender
    ) {
        // Same guards as Assignment.Create.
        const candidate = {
            subjectType: 'user' as const,
            subjectId: rawParams?.userId,
            personaId: rawParams?.personaId,
            scope: rawParams?.scope,
            reason: rawParams?.reason,
            comment: rawParams?.comment,
            expiresAt: rawParams?.expiresAt
        };
        const p = validateOrThrow<AssignmentCreateParams>(
            candidate,
            ASSIGNMENT_CREATE_PARAMS_SCHEMA
        );
        if (!isExplicitScope(p.scope)) {
            throw RpcError.InvalidParams(SCOPE_NOT_EXPLICIT_MESSAGE);
        }
        const tenantId = sender.getOrganizationId();
        if (!tenantId) throw RpcError.InvalidParams('tenant context missing');
        // ensureZitadelManagement() closes the DEV-mode fail-open path where
        // userBelongsToTenant returns true unconditionally; assertTargetInTenant
        // also accepts FM-presence + service-user metadata branches.
        ensureZitadelManagement();
        await assertTargetInTenant(sender, p.subjectId, tenantId);
        const actorId = sender.getUser()?.username ?? 'unknown';
        const persona = await loadAttachablePersona(p.personaId, tenantId);
        if (persona.is_system_managed) {
            throw RpcError.InvalidParams(
                'system-managed personas must be granted through Zitadel roles'
            );
        }
        const assignment = await createAssignmentGrant({
            tenantId,
            actorId,
            grantor: sender,
            subjectType: 'user',
            subjectId: p.subjectId,
            personaId: p.personaId,
            scope: p.scope,
            metadata: {
                reason: p.reason,
                comment: p.comment,
                expiresAt: p.expiresAt
            }
        });
        return {success: true, assignmentId: assignment.id};
    }

    @Component.Expose('CreateZitadelUser')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async createZitadelUser(
        params: {
            email: string;
            userName: string;
            firstName: string;
            lastName: string;
            displayName?: string;
            password?: string;
            passwordChangeRequired?: boolean;
        },
        sender: CommandSender
    ) {
        return createZitadelUserImpl(params, sender);
    }

    @Component.Expose('UpdateZitadelUser')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async updateZitadelUser(
        params: {
            userId: string;
            firstName?: string;
            lastName?: string;
            displayName?: string;
            email?: string;
        },
        sender: CommandSender
    ) {
        return updateZitadelUserImpl(params, sender);
    }

    @Component.Expose('SendPasswordReset')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async sendPasswordReset(params: {userId: string}, sender: CommandSender) {
        return sendPasswordResetImpl(params, sender);
    }

    @Component.Expose('DeactivateUser')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async deactivateZitadelUser(
        params: {userId: string},
        sender: CommandSender
    ) {
        return deactivateZitadelUserImpl(params, sender);
    }

    @Component.Expose('ReactivateUser')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async reactivateZitadelUser(
        params: {userId: string},
        sender: CommandSender
    ) {
        return reactivateZitadelUserImpl(params, sender);
    }

    // Hard delete follows the same tenant management authority as deactivate.
    // the impl layer prevents cross-org deletes.
    @Component.Expose('DeleteZitadelUser')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async deleteZitadelUser(params: {userId: string}, sender: CommandSender) {
        return deleteZitadelUserImpl(params, sender);
    }

    // ── Service Users (impl in ./serviceUsers) ───────────────────────

    @Component.Expose('ListServiceUsers')
    @Component.CheckPermissions(canReadPolicies)
    async listServiceUsers(_params: unknown, sender: CommandSender) {
        return listServiceUsersImpl(sender);
    }

    @Component.Expose('CreateServiceUser')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async createServiceUser(
        params: {
            userName: string;
            name: string;
            description?: unknown;
            role?: unknown;
            groupIds?: unknown;
            assignments?: unknown;
        },
        sender: CommandSender
    ) {
        return createServiceUserImpl(params, sender);
    }

    @Component.Expose('SetServiceUserOrg')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    async setServiceUserOrg(
        params: {
            userId: string;
            organizationId: string;
        },
        sender: CommandSender
    ) {
        return setServiceUserOrgImpl(params, sender);
    }

    @Component.Expose('DeleteServiceUser')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async deleteServiceUser(params: {userId: string}, sender: CommandSender) {
        return deleteServiceUserImpl(params, sender);
    }

    // ── Zitadel PATs (impl in ./zitadelPats) ─────────────────────────

    @Component.Expose('CreatePAT')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async createPAT(
        params: {userId: string; expirationDays?: number; name?: string},
        sender: CommandSender
    ) {
        return createZitadelPat(params, sender);
    }

    @Component.Expose('ListPATs')
    @Component.CheckPermissions(canReadPolicies)
    async listPATs(params: {userId: string}, sender: CommandSender) {
        return listZitadelPats(params, sender);
    }

    @Component.Expose('RevokePAT')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async revokePAT(
        params: {userId: string; tokenId: string},
        sender: CommandSender
    ) {
        return revokeZitadelPat(params, sender);
    }

    @Component.Expose('CreateScopedPAT')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async createScopedPAT(
        params: {
            userId: string;
            boundaryScope: AssignmentScope;
            purpose: string;
            audience?: string[];
            expirationDays?: number;
        },
        sender: CommandSender
    ) {
        return createScopedPATImpl(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('ListScopedPATs')
    @Component.CheckPermissions(canReadPolicies)
    async listScopedPATs(params: {userId?: string}, sender: CommandSender) {
        return listScopedPATsImpl(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('PreviewScopedPAT')
    @Component.CheckPermissions(canReadPolicies)
    async previewScopedPAT(
        params: {
            userId: string;
            boundaryScope: AssignmentScope;
        },
        sender: CommandSender
    ) {
        return previewScopedPATImpl(params, sender);
    }

    @Component.Expose('RevokeScopedPAT')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async revokeScopedPAT(params: {tokenId: string}, sender: CommandSender) {
        return revokeScopedPATImpl(params, sender);
    }

    @Component.Expose('RevokeAllUserPATs')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async revokeAllUserPATs(params: {userId: string}, sender: CommandSender) {
        return revokeAllUserPATsImpl(params, sender);
    }

    @Component.Expose('RotateScopedPAT')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async rotateScopedPAT(
        params: {tokenId: string; expirationDays?: number},
        sender: CommandSender
    ) {
        return rotateScopedPATImpl(params, sender);
    }

    @Component.Expose('RotatePAT')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async rotatePAT(
        params: {
            userId: string;
            tokenId: string;
            expirationDays?: number;
            graceMs?: number;
        },
        sender: CommandSender
    ) {
        return rotateZitadelPat(params, sender);
    }

    @Component.Expose('BulkRotatePATs')
    @Component.CheckPermissions(canManageOrganizationSettings)
    async bulkRotatePATs(
        params: {userId: string; expirationDays?: number; graceMs?: number},
        sender: CommandSender
    ) {
        return bulkRotateZitadelPats(params, sender);
    }

    // Returns global instance custom/trusted domains.
    @Component.NoAudit
    @Component.Expose('GetInstanceInfo')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    async getInstanceInfo() {
        return getInstanceInfoImpl();
    }

    @Component.NoAudit
    @Component.Expose('ListSessions')
    @Component.CheckPermissions(canReadPolicies)
    async listSessions(params: {userId?: string}, sender: CommandSender) {
        return listSessionsImpl(params, sender);
    }

    // Global provider support only — see sessions.ts header for off-board path.
    @Component.Expose('DeleteSession')
    @Component.CheckPermissions(canCrossOrganizationBoundary)
    async deleteSession(params: {sessionId: string}, sender: CommandSender) {
        return deleteSessionImpl(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('GetAuthMethods')
    @Component.CheckPermissions(canReadPolicies)
    async getUserAuthMethods(params: {userId: string}, sender: CommandSender) {
        return getAuthMethodsImpl(params, sender);
    }

    protected override checkConfigKey(key: string, value: any): boolean {
        switch (key) {
            case 'allowDebugUser':
                return typeof value === 'boolean';
            default:
                return false;
        }
    }

    protected override applyConfigKey(key: string, value: any) {
        switch (key) {
            case 'allowDebugUser': {
                const allowed = Boolean(value);
                this.config.allowDebugUser = allowed;
                break;
            }
        }
    }

    protected override getDefaultConfig() {
        return {
            allowDebugUser: false
        } satisfies UserComponentConfig;
    }

    override getConfig(_params?: any) {
        return Object.assign({}, {allowDebugUser: this.config.allowDebugUser});
    }
}
