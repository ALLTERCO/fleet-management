// Service user orchestration; UserComponent owns the RPC decorators.

import {getLogger} from 'log4js';
import type CommandSender from '../../model/CommandSender';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import type {AssignmentScope} from '../../types/api/assignment';
import {AUTHZ_SYSTEM_PERSONA_KEYS} from '../../types/api/authzCatalog';
import {isResourceNotFound, type RpcCallError} from '../../types/api/errors';
import {authzAuditActor, authzAuditWriter} from '../authz/audit';
import {canCrossOrganizationBoundary} from '../authz/evaluator';
import {serviceUserPrincipal} from '../authz/principals';
import {identityRoleManager} from '../identity';
import {ConnectionContext} from '../web/ws/ConnectionContext';
import {zitadelService} from '../zitadel';
import {evictCachedUserByCredentialId, evictCachedUserByUserId} from './cache';
import {
    assertServiceUserAccessAllowed,
    configureServiceUserAccess,
    emptyServiceUserAccess,
    type ServiceUserAssignmentInput
} from './serviceUserAccess';
import {publishUserSessionSignal} from './sessionNotifications';
import {assertTargetOwnedByTenant} from './tenantGate';
import {revokeAllScopedPatsForUser} from './tokenStore';
import {ensureZitadelManagement, requireString} from './validation';
import {guardNotSelf} from './zitadelUserCrud';

const logger = getLogger('service-users');

const VALID_ROLES = new Set<string>(AUTHZ_SYSTEM_PERSONA_KEYS);

interface CreateServiceUserParams {
    userName: string;
    name: string;
    description?: unknown;
    role?: unknown;
    groupIds?: unknown;
    assignments?: unknown;
}

export async function listServiceUsers(sender: CommandSender) {
    ensureZitadelManagement();
    const orgFilter = canCrossOrganizationBoundary(sender)
        ? undefined
        : requireOrganizationId(sender);
    const users = await zitadelService.listMachineUsers(orgFilter);
    const enriched = await Promise.all(
        users.map(async (u) => {
            const tokenCount = await countServiceUserTokens(u.userId);
            return {...u, tokenCount};
        })
    );
    return {items: enriched, total: enriched.length};
}

async function countServiceUserTokens(userId: string): Promise<number> {
    try {
        const tokens = await zitadelService.listPersonalAccessTokens(userId);
        return tokens.length;
    } catch (error) {
        logger.debug(
            'listServiceUsers: token count unavailable for %s: %s',
            userId,
            error instanceof Error ? error.message : String(error)
        );
        return 0;
    }
}

export async function createServiceUser(
    params: CreateServiceUserParams,
    sender: CommandSender
) {
    requireString('userName', params.userName);
    requireString('name', params.name);
    ensureZitadelManagement();

    const role = normalizeOptionalRole(params.role);
    const groupIds = normalizeOptionalStringArray('groupIds', params.groupIds);
    const assignments = normalizeAssignments(params.assignments);

    const ownerOrg = canCrossOrganizationBoundary(sender)
        ? undefined
        : requireOrganizationId(sender);

    // Validate the requested access BEFORE creating the identity — a rejected
    // grant (e.g. high-risk without a reason) must not leave an orphan user.
    const accessTenantId = resolveAccessTenantId({
        sender,
        ownerOrg,
        groupIds,
        assignments
    });
    if (accessTenantId) {
        await assertServiceUserAccessAllowed({
            tenantId: accessTenantId,
            groupIds,
            assignments,
            sender
        });
    }

    const result = await createServiceUserIdentity(params, ownerOrg);

    // Roll the identity back if provisioning throws, so a partial failure
    // leaves no orphan user. Audit is recorded after, outside the rollback.
    const finalizeInput = {
        result,
        role,
        ownerOrg,
        accessTenantId,
        groupIds,
        assignments,
        sender
    };
    const access = await withServiceUserRollback(result.userId, () =>
        finalizeServiceUser(finalizeInput)
    );
    await recordServiceUserCreateAudit(finalizeInput);

    return {
        userId: result.userId,
        userName: result.userName,
        role: role ?? null,
        principal: serviceUserPrincipal(result.userId),
        accessPreview: {
            ...access,
            patCreation: 'separate'
        }
    };
}

async function createServiceUserIdentity(
    params: CreateServiceUserParams,
    ownerOrg: string | undefined
): Promise<{userId: string; userName: string}> {
    try {
        return await zitadelService.createMachineUser({
            userName: params.userName,
            name: params.name,
            description:
                typeof params.description === 'string'
                    ? params.description
                    : undefined,
            organizationId: ownerOrg
        });
    } catch (err) {
        if (isAlreadyExistsError(err)) {
            throw RpcError.InvalidParams(
                `User "${params.userName}" already exists`
            );
        }
        throw RpcError.OperationFailed('create service user', err);
    }
}

// On failure, deletes the just-created identity (all-or-nothing) and rethrows
// the original error; a failed rollback is logged, not swallowed.
async function withServiceUserRollback<T>(
    userId: string,
    finalize: () => Promise<T>
): Promise<T> {
    try {
        return await finalize();
    } catch (err) {
        await rollbackServiceUserIdentity(userId, err);
        throw err;
    }
}

async function rollbackServiceUserIdentity(
    userId: string,
    cause: unknown
): Promise<void> {
    try {
        await zitadelService.deleteUser(userId);
    } catch (cleanupErr) {
        if (isResourceNotFound(cleanupErr as RpcCallError)) return;
        logger.error(
            'createServiceUser rollback failed for %s after %s; manual cleanup required: %s',
            userId,
            cause instanceof Error ? cause.message : String(cause),
            cleanupErr
        );
    }
}

interface FinalizeServiceUserInput {
    result: {userId: string; userName: string};
    role?: string;
    ownerOrg?: string;
    accessTenantId?: string;
    groupIds: string[];
    assignments: ServiceUserAssignmentInput[];
    sender: CommandSender;
}

// Identity-dependent provisioning (role + access); a failure here is rolled
// back. Audit is split out so a logging failure can't tear down a live user.
async function finalizeServiceUser(input: FinalizeServiceUserInput) {
    const {result, role, ownerOrg, accessTenantId, groupIds, assignments} =
        input;
    if (role) await grantInitialRole(result.userId, role, ownerOrg);
    const actorId = authzAuditActor(input.sender.getUser());
    return accessTenantId
        ? await configureServiceUserAccess({
              tenantId: accessTenantId,
              actorId,
              userId: result.userId,
              groupIds,
              assignments,
              sender: input.sender
          })
        : emptyServiceUserAccess();
}

// Audit is a side-record written after provisioning succeeds; its failure is
// logged loudly but never rolls back the user (which is already provisioned).
async function recordServiceUserCreateAudit(
    input: FinalizeServiceUserInput
): Promise<void> {
    try {
        await writeServiceUserAudit({
            tenantId: input.accessTenantId ?? null,
            actorId: authzAuditActor(input.sender.getUser()),
            operation: 'create',
            userId: input.result.userId,
            userName: input.result.userName,
            role: input.role ?? null,
            groupCount: input.groupIds.length,
            assignmentCount: input.assignments.length
        });
    } catch (err) {
        logger.error(
            'service-user create audit write failed for %s (user provisioned): %s',
            input.result.userId,
            err
        );
    }
}

// undefined = no org and no access requested; access without a tenant throws.
function resolveAccessTenantId(input: {
    sender: CommandSender;
    ownerOrg?: string;
    groupIds: string[];
    assignments: ServiceUserAssignmentInput[];
}): string | undefined {
    const hasAccessSetup =
        input.groupIds.length > 0 || input.assignments.length > 0;
    const tenantId = input.ownerOrg ?? input.sender.getOrganizationId();
    if (!tenantId && hasAccessSetup) {
        throw RpcError.InvalidParams(
            'groupIds or assignments require an organization context'
        );
    }
    return tenantId;
}

function normalizeOptionalRole(role: unknown): string | undefined {
    if (role === undefined || role === null) return undefined;
    if (typeof role !== 'string') {
        throw RpcError.InvalidParams('role must be a string');
    }
    const normalized = role.trim();
    if (normalized.length === 0) return undefined;
    if (!VALID_ROLES.has(normalized)) {
        throw RpcError.InvalidParams(
            `Invalid role "${normalized}". Valid: ${[...VALID_ROLES].join(', ')}`
        );
    }
    return normalized;
}

function normalizeOptionalStringArray(field: string, value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
        throw RpcError.InvalidParams(`${field} must be an array`);
    }
    const values = value.map((item) => {
        if (typeof item !== 'string' || item.trim().length === 0) {
            throw RpcError.InvalidParams(`${field} must contain strings`);
        }
        return item.trim();
    });
    return Array.from(new Set(values));
}

function normalizeAssignments(value: unknown): ServiceUserAssignmentInput[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
        throw RpcError.InvalidParams('assignments must be an array');
    }
    return value.map(normalizeAssignment);
}

function normalizeAssignment(item: unknown): ServiceUserAssignmentInput {
    if (!item || typeof item !== 'object') {
        throw RpcError.InvalidParams('assignments must contain objects');
    }
    const raw = item as {
        personaId?: unknown;
        scope?: unknown;
        reason?: unknown;
        comment?: unknown;
        expiresAt?: unknown;
    };
    if (typeof raw.personaId !== 'string' || !raw.personaId.trim()) {
        throw RpcError.InvalidParams('assignment personaId is required');
    }
    if (!raw.scope || typeof raw.scope !== 'object') {
        throw RpcError.InvalidParams('assignment scope is required');
    }
    return {
        personaId: raw.personaId.trim(),
        scope: raw.scope as AssignmentScope,
        metadata: {
            reason: normalizeOptionalTextField('reason', raw.reason),
            comment: normalizeOptionalTextField('comment', raw.comment),
            expiresAt: normalizeOptionalTextField('expiresAt', raw.expiresAt)
        }
    };
}

function normalizeOptionalTextField(
    field: string,
    value: unknown
): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') {
        throw RpcError.InvalidParams(`assignment ${field} must be a string`);
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}

async function grantInitialRole(
    userId: string,
    role: string,
    organizationId?: string
): Promise<void> {
    try {
        await identityRoleManager.grantSystemRoles({
            userId,
            roleKeys: [role],
            organizationId
        });
    } catch (err) {
        throw RpcError.OperationFailed(
            `grant role "${role}" to user ${userId}`,
            err
        );
    }
}

function isAlreadyExistsError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
        message.includes('already exists') || message.includes('ALREADY_EXISTS')
    );
}

// Hard-delete a tenant-owned service user.
export async function deleteServiceUser(
    params: {userId: string},
    sender: CommandSender
) {
    requireString('userId', params.userId);
    guardNotSelf(sender, params.userId, 'delete');
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    await assertTargetOwnedByTenant(sender, params.userId, orgId);
    ensureZitadelManagement();
    try {
        await zitadelService.deleteUser(params.userId);
    } catch (err) {
        if (!isResourceNotFound(err as RpcCallError)) throw err;
        logger.warn(
            'deleteServiceUser: zitadel returned 404 for %s; treating as already-deleted',
            params.userId
        );
    }
    const revokedTokenIds = await revokeAllScopedPatsForUser(
        orgId,
        params.userId
    );
    for (const tokenId of revokedTokenIds) {
        evictCachedUserByCredentialId(tokenId);
    }
    evictCachedUserByUserId(params.userId);
    ConnectionContext.forceSenderDisconnect(params.userId, 'user-deleted');
    publishUserSessionSignal('deleteServiceUser', {
        kind: 'force-disconnect',
        userId: params.userId,
        reason: 'user-deleted'
    });
    await writeServiceUserAudit({
        tenantId: orgId,
        actorId: authzAuditActor(sender.getUser()),
        operation: 'delete',
        userId: params.userId,
        revokedScopedPatCount: revokedTokenIds.length
    });
    return {success: true};
}

export async function setServiceUserOrg(
    params: {
        userId: string;
        organizationId: string;
    },
    sender?: CommandSender
) {
    requireString('userId', params.userId);
    requireString('organizationId', params.organizationId);
    ensureZitadelManagement();
    // Capture the prior tenant tag BEFORE the metadata flip so we can
    // revoke scoped PATs scoped to the old tenant — otherwise the user
    // keeps presenting credentials issued under their previous org.
    let priorOrgId: string | undefined;
    try {
        const md = await zitadelService.getUserMetadata(params.userId);
        priorOrgId = md.organizationId || undefined;
    } catch (err) {
        logger.warn(
            'setServiceUserOrg: getUserMetadata failed for %s; cannot revoke prior-tenant PATs: %s',
            params.userId,
            err
        );
    }
    await zitadelService.setUserMetadata(params.userId, {
        organizationId: params.organizationId
    });
    if (priorOrgId && priorOrgId !== params.organizationId) {
        const revoked = await revokeAllScopedPatsForUser(
            priorOrgId,
            params.userId
        );
        for (const tokenId of revoked) evictCachedUserByCredentialId(tokenId);
    }
    // Org change shifts tenant claim — evict + notify peers.
    evictCachedUserByUserId(params.userId);
    ConnectionContext.forceSenderRefresh(params.userId);
    publishUserSessionSignal('setServiceUserOrg', {
        kind: 'auth-changed',
        userId: params.userId
    });
    await writeServiceUserAudit({
        tenantId: params.organizationId,
        actorId: authzAuditActor(sender?.getUser()),
        operation: 'update',
        userId: params.userId,
        previousOrganizationId: priorOrgId,
        organizationId: params.organizationId
    });
    return {userId: params.userId, organizationId: params.organizationId};
}

async function writeServiceUserAudit(input: {
    tenantId: string | null;
    actorId: string;
    operation: 'create' | 'update' | 'delete';
    userId: string;
    userName?: string;
    role?: string | null;
    groupCount?: number;
    assignmentCount?: number;
    revokedScopedPatCount?: number;
    previousOrganizationId?: string;
    organizationId?: string;
}): Promise<void> {
    await authzAuditWriter.writeUserLifecycleEvent({
        tenantId: input.tenantId,
        actorId: input.actorId,
        operation: input.operation,
        userId: input.userId,
        principalKind: 'service_user',
        userName: input.userName,
        role: input.role,
        groupCount: input.groupCount,
        assignmentCount: input.assignmentCount,
        revokedScopedPatCount: input.revokedScopedPatCount,
        previousOrganizationId: input.previousOrganizationId,
        organizationId: input.organizationId
    });
}
