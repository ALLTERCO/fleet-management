// Zitadel human-user CRUD: list / create / update / password reset /
// (de)activate / delete. All mutating ops gate on
// assertTargetOwnedByTenant — only the user's home-org admin can mutate
// them in Zitadel, so a persona granted cross-org doesn't expose the
// foreign user to the granting org's admin.

import {getLogger} from 'log4js';
import type CommandSender from '../../model/CommandSender';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {isResourceNotFound, type RpcCallError} from '../../types/api/errors';
import {
    authzAuditActor,
    authzAuditWriter,
    type UserLifecycleAuditInput
} from '../authz/audit';
import {canCrossOrganizationBoundary} from '../authz/evaluator';
import * as EventDistributor from '../EventDistributor';
import {ConnectionContext} from '../web/ws/ConnectionContext';
import {zitadelService} from '../zitadel';
import {evictCachedUserByCredentialId, evictCachedUserByUserId} from './cache';
import {publishUserSessionSignal} from './sessionNotifications';
import {assertTargetInTenant, assertTargetOwnedByTenant} from './tenantGate';
import {revokeAllScopedPatsForUser} from './tokenStore';
import {ensureZitadelManagement, requireString} from './validation';

const logger = getLogger('user-crud');

interface UserLifecycleDeps {
    deactivateUser(userId: string): Promise<void>;
    reactivateUser(userId: string): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    revokeAllScopedPatsForUser(
        tenantId: string,
        userId: string
    ): Promise<string[]>;
    evictCachedUserByCredentialId(credentialId: string): number;
    evictCachedUserByUserId(userId: string): number;
    writeUserLifecycleEvent(input: UserLifecycleAuditInput): Promise<void>;
}

const defaultUserLifecycleDeps: UserLifecycleDeps = {
    deactivateUser: (userId) => zitadelService.deactivateUser(userId),
    reactivateUser: (userId) => zitadelService.reactivateUser(userId),
    deleteUser: (userId) => zitadelService.deleteUser(userId),
    revokeAllScopedPatsForUser,
    evictCachedUserByCredentialId,
    evictCachedUserByUserId,
    writeUserLifecycleEvent: (input) =>
        authzAuditWriter.writeUserLifecycleEvent(input)
};

async function requireOwnedByTenant(
    sender: CommandSender,
    userId: string
): Promise<string> {
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    await assertTargetOwnedByTenant(sender, userId, orgId);
    return orgId;
}

// A user may only resolve a profile picture for themselves or a user in their
// own tenant — never one from another org.
export async function assertProfilePictureVisible(
    sender: CommandSender,
    username: string
): Promise<void> {
    if (sender.getUser()?.username === username) return;
    if (canCrossOrganizationBoundary(sender)) return;
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    const user = await zitadelService.findUserByUsername(username);
    if (!user) throw RpcError.InvalidParams('user not found');
    await assertTargetInTenant(sender, user.userId, orgId);
}

// Refuse self-destructive ops so an admin can't lock themselves out.
export function guardNotSelf(
    sender: CommandSender,
    targetUserId: string,
    action: string
): void {
    if (sender.getUser()?.userId === targetUserId) {
        throw RpcError.InvalidParams(`cannot ${action} your own account`);
    }
}

export function zitadelAvailable() {
    return {available: zitadelService.isManagementApiAvailable()};
}

export async function listZitadelUsers(sender: CommandSender) {
    // Read-only — no Zitadel gate. zitadelService.listUsers() returns
    // [DEV_ADMIN_USER] in DEV_MODE when Zitadel isn't running, so the share
    // modal and the seed's persona-assignment lookup keep working without
    // a Zitadel container.
    const isGlobalSuper = canCrossOrganizationBoundary(sender);
    const orgId = sender.getOrganizationId();
    if (!isGlobalSuper && !orgId) throw RpcError.Unauthorized();
    const users = await zitadelService.listUsers(
        isGlobalSuper ? undefined : orgId
    );
    return buildListResponse(users, users.length, 0, 0);
}

export async function createZitadelUser(
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
    ensureZitadelManagement();
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    // New users land in the sender's tenant org so resourceOwner matches
    // what the tenant gate expects — no cross-tenant bounce for the admin
    // granting roles after.
    const created = await zitadelService.createHumanUser({
        ...params,
        tenantId: orgId
    });
    EventDistributor.emitUserCreated(created.userId, orgId);
    return created;
}

export async function updateZitadelUser(
    params: {
        userId: string;
        firstName?: string;
        lastName?: string;
        displayName?: string;
        email?: string;
    },
    sender: CommandSender
) {
    requireString('userId', params.userId);
    const {userId, firstName, lastName, displayName, email} = params;
    if (email !== undefined) {
        // Self-email change must go through Zitadel's self-service flow,
        // not the admin RPC — otherwise an admin could pivot their own
        // recovery channel to an address they no longer control.
        guardNotSelf(sender, userId, 'change the email of');
    }
    const orgId = await requireOwnedByTenant(sender, userId);
    ensureZitadelManagement();
    if (firstName !== undefined && lastName !== undefined) {
        await zitadelService.updateHumanProfile(userId, {
            firstName,
            lastName,
            displayName
        });
    }
    if (email !== undefined) {
        // isVerified defaults to false — Zitadel sends a verification mail;
        // the change does not take effect until the new address is proven.
        await zitadelService.updateHumanEmail(userId, email);
    }
    EventDistributor.emitUserUpdated(userId, orgId);
    return {success: true};
}

export async function sendPasswordReset(
    params: {userId: string},
    sender: CommandSender
) {
    requireString('userId', params.userId);
    await requireOwnedByTenant(sender, params.userId);
    ensureZitadelManagement();
    await zitadelService.sendPasswordResetEmail(params.userId);
    return {success: true};
}

export async function deactivateZitadelUser(
    params: {userId: string},
    sender: CommandSender,
    deps: UserLifecycleDeps = defaultUserLifecycleDeps
) {
    requireString('userId', params.userId);
    guardNotSelf(sender, params.userId, 'deactivate');
    const orgId = await requireOwnedByTenant(sender, params.userId);
    ensureZitadelManagement();
    await deps.deactivateUser(params.userId);
    const revokedTokenIds = await revokeScopedPatAccessForUser(
        {
            orgId,
            userId: params.userId
        },
        deps
    );
    // Deactivated = no access. Drop the cached user_t and hard-close any
    // open WebSocket so the disabled user can't keep operating on a stale
    // sender between Zitadel deactivate and the next token introspection.
    deps.evictCachedUserByUserId(params.userId);
    ConnectionContext.forceSenderDisconnect(params.userId, 'user-deactivated');
    publishUserSessionSignal('deactivateZitadelUser', {
        kind: 'force-disconnect',
        userId: params.userId,
        reason: 'user-deactivated'
    });
    await writeUserLifecycleAudit(
        {
            orgId,
            actorId: authzAuditActor(sender.getUser()),
            operation: 'update',
            userId: params.userId,
            lifecycleOperation: 'deactivate',
            revokedScopedPatCount: revokedTokenIds.length
        },
        deps
    );
    EventDistributor.emitUserUpdated(params.userId, orgId);
    return {success: true};
}

export async function reactivateZitadelUser(
    params: {userId: string},
    sender: CommandSender,
    deps: UserLifecycleDeps = defaultUserLifecycleDeps
) {
    requireString('userId', params.userId);
    const orgId = await requireOwnedByTenant(sender, params.userId);
    ensureZitadelManagement();
    await deps.reactivateUser(params.userId);
    // No live WS to refresh — deactivate hard-closed it. Clear the cached
    // "disabled" user_t and notify peers so a fresh login lands clean.
    deps.evictCachedUserByUserId(params.userId);
    publishUserSessionSignal('reactivateZitadelUser', {
        kind: 'auth-changed',
        userId: params.userId
    });
    await writeUserLifecycleAudit(
        {
            orgId,
            actorId: authzAuditActor(sender.getUser()),
            operation: 'update',
            userId: params.userId,
            lifecycleOperation: 'reactivate'
        },
        deps
    );
    EventDistributor.emitUserUpdated(params.userId, orgId);
    return {success: true};
}

// Hard-delete: irreversible. Caller must be admin (gated at RPC layer).
// Owned-by-tenant gate plus self-guard — a tenant admin can only delete
// users whose home org is their own, and never themselves.
export async function deleteZitadelUser(
    params: {userId: string},
    sender: CommandSender,
    deps: UserLifecycleDeps = defaultUserLifecycleDeps
) {
    requireString('userId', params.userId);
    guardNotSelf(sender, params.userId, 'delete');
    const orgId = await requireOwnedByTenant(sender, params.userId);
    ensureZitadelManagement();
    try {
        await deps.deleteUser(params.userId);
    } catch (err) {
        // 404 means the Zitadel record is already gone — still scrub FM
        // state so caller doesn't see a stuck-half-deleted user.
        if (!isResourceNotFound(err as RpcCallError)) throw err;
        logger.warn(
            'deleteZitadelUser: zitadel returned 404 for %s; treating as already-deleted',
            params.userId
        );
    }
    // Revoke FM-side state AFTER Zitadel confirms the user is gone; doing
    // it earlier would leave PATs permanently revoked if the Zitadel call
    // failed mid-flight.
    const revokedTokenIds = await revokeScopedPatAccessForUser(
        {
            orgId,
            userId: params.userId
        },
        deps
    );
    deps.evictCachedUserByUserId(params.userId);
    ConnectionContext.forceSenderDisconnect(params.userId, 'user-deleted');
    publishUserSessionSignal('deleteZitadelUser', {
        kind: 'force-disconnect',
        userId: params.userId,
        reason: 'user-deleted'
    });
    await writeUserLifecycleAudit(
        {
            orgId,
            actorId: authzAuditActor(sender.getUser()),
            operation: 'delete',
            userId: params.userId,
            revokedScopedPatCount: revokedTokenIds.length
        },
        deps
    );
    EventDistributor.emitUserDeleted(params.userId, orgId);
    return {success: true};
}

async function revokeScopedPatAccessForUser(
    input: {
        orgId: string;
        userId: string;
    },
    deps: UserLifecycleDeps
): Promise<string[]> {
    const tokenIds = await deps.revokeAllScopedPatsForUser(
        input.orgId,
        input.userId
    );
    for (const tokenId of tokenIds) {
        deps.evictCachedUserByCredentialId(tokenId);
    }
    return tokenIds;
}

async function writeUserLifecycleAudit(
    input: {
        orgId: string | null;
        actorId: string;
        operation: 'update' | 'delete';
        userId: string;
        lifecycleOperation?: string;
        revokedScopedPatCount?: number;
    },
    deps: UserLifecycleDeps
): Promise<void> {
    await deps.writeUserLifecycleEvent({
        tenantId: input.orgId,
        actorId: input.actorId,
        operation: input.operation,
        userId: input.userId,
        principalKind: 'human_user',
        lifecycleOperation: input.lifecycleOperation,
        revokedScopedPatCount: input.revokedScopedPatCount
    });
}
