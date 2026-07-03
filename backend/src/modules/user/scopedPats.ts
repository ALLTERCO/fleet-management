// FM-issued scoped PATs: boundary persisted in fm_scoped_pats, JWT signed
// with JWT_SECRET, gate looks up boundary by tokenId on every request.

import {getLogger} from 'log4js';
import {envInt} from '../../config/envReader';
import type CommandSender from '../../model/CommandSender';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import type {AssignmentScope} from '../../types/api/assignment';
import {isKnownActionPattern} from '../authz/actionMap';
import {assertGrantorCanManageCredential} from '../authz/admin';
import {authzAuditActor} from '../authz/audit';
import {buildEffectiveShape} from '../authz/resolver';
import {tryGetAuthzRuntime} from '../authz/runtime';
import {isExplicitScope, SCOPE_NOT_EXPLICIT_MESSAGE} from '../authz/scopeGuard';
import {identityDirectory} from '../identity';
import * as Observability from '../Observability';
import {ConnectionContext} from '../web/ws/ConnectionContext';
import {evictCachedUserByCredentialId} from './cache';
import {writeCredentialAudit} from './credentialAudit';
import {previewScopedPatAccess} from './scopedPatPreview';
import {publishUserSessionSignal} from './sessionNotifications';
import {getCurrentKid, ScopedTokenSigner} from './signers';
import {assertTargetInTenant} from './tenantGate';
import {
    createScopedPat,
    getScopedPatByTenantAndId,
    listScopedPatsByTenant,
    listScopedPatsByUser,
    revokeAllScopedPatsForUser,
    revokeScopedPat,
    rotateScopedPatTx
} from './tokenStore';
import {ensureZitadelManagement, requireString} from './validation';

const logger = getLogger('scoped-pats');

function expirationFromDays(days?: number): Date {
    const span =
        typeof days === 'number' && days > 0
            ? days
            : envInt('ZITADEL_PAT_DEFAULT_EXPIRATION_DAYS', 365, 1);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + span);
    return expiresAt;
}

function requireSenderOrg(sender: CommandSender): string {
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    return orgId;
}

function validateBoundaryActions(scope: AssignmentScope): void {
    const actions = (scope as {actions?: string[]}).actions;
    if (actions === undefined) return;
    if (actions.length === 0) {
        throw RpcError.InvalidParams(
            'boundaryScope.actions: [] makes the PAT unusable'
        );
    }
    for (const pat of actions) {
        if (!isKnownActionPattern(pat)) {
            throw RpcError.InvalidParams(
                `boundaryScope.actions: unknown pattern "${pat}"`
            );
        }
    }
}

export async function createScopedPATImpl(
    params: {
        userId: string;
        boundaryScope: AssignmentScope;
        purpose: string;
        audience?: string[];
        expirationDays?: number;
    },
    sender: CommandSender
) {
    assertGrantorCanManageCredential({
        grantor: sender,
        credentialKind: 'fm_scoped_pat',
        operation: 'create'
    });
    const orgId = requireSenderOrg(sender);
    requireString('userId', params.userId);
    // ensureZitadelManagement closes the DEV-mode fail-open path where
    // userBelongsToTenant returns true unconditionally.
    ensureZitadelManagement();
    await assertTargetInTenant(sender, params.userId, orgId);
    if (!isExplicitScope(params.boundaryScope)) {
        throw RpcError.InvalidParams(SCOPE_NOT_EXPLICIT_MESSAGE);
    }
    validateBoundaryActions(params.boundaryScope);
    const expiresAt = expirationFromDays(params.expirationDays);

    const {tokenId} = await createScopedPat({
        tenantId: orgId,
        userId: params.userId,
        boundaryScope: params.boundaryScope,
        audience: params.audience,
        purpose: params.purpose,
        expiresAt,
        createdBy: sender.getUser()?.username ?? 'admin',
        kid: getCurrentKid()
    });
    const token = ScopedTokenSigner.sign(params.userId, tokenId, expiresAt);
    Observability.incrementCounter('fm_scoped_pat_created');

    await writeCredentialAudit({
        tenantId: orgId,
        actorId: authzAuditActor(sender.getUser()),
        operation: 'set',
        credentialKind: 'fm_scoped_pat',
        targetId: tokenId,
        userId: params.userId,
        purpose: params.purpose
    });

    return {tokenId, token, expirationDate: expiresAt.toISOString()};
}

export async function listScopedPATsImpl(
    params: {userId?: string},
    sender: CommandSender
) {
    const orgId = requireSenderOrg(sender);
    const rows = params.userId
        ? await listScopedPatsByUser(orgId, params.userId)
        : await listScopedPatsByTenant(orgId);
    return buildListResponse(rows, rows.length, rows.length, 0);
}

export async function previewScopedPATImpl(
    params: {
        userId: string;
        boundaryScope: AssignmentScope;
    },
    sender: CommandSender
) {
    assertGrantorCanManageCredential({
        grantor: sender,
        credentialKind: 'fm_scoped_pat',
        operation: 'create'
    });
    const orgId = requireSenderOrg(sender);
    requireString('userId', params.userId);
    ensureZitadelManagement();
    await assertTargetInTenant(sender, params.userId, orgId);
    if (!isExplicitScope(params.boundaryScope)) {
        throw RpcError.InvalidParams(SCOPE_NOT_EXPLICIT_MESSAGE);
    }
    validateBoundaryActions(params.boundaryScope);
    const rt = tryGetAuthzRuntime();
    if (!rt) throw RpcError.InvalidParams('authz runtime not initialised');
    const roleInfo = await identityDirectory.getProjectRoles({
        userId: params.userId,
        organizationId: orgId
    });
    return previewScopedPatAccess(
        {
            userId: params.userId,
            tenantId: orgId,
            builtInRoles: roleInfo.roleKeys,
            boundaryScope: params.boundaryScope
        },
        {
            buildEffectiveShape: ({userId, tenantId, builtInRoles}) =>
                buildEffectiveShape(
                    {cache: rt.cache, db: rt.db, l1: rt.l1},
                    userId,
                    tenantId,
                    builtInRoles
                )
        }
    );
}

export async function revokeScopedPATImpl(
    params: {tokenId: string},
    sender: CommandSender
) {
    assertGrantorCanManageCredential({
        grantor: sender,
        credentialKind: 'fm_scoped_pat',
        operation: 'revoke'
    });
    const orgId = requireSenderOrg(sender);
    const revoked = await revokeScopedPat(orgId, params.tokenId);
    if (!revoked) throw RpcError.NotFound('scoped pat');
    Observability.incrementCounter('fm_scoped_pat_revoked');
    // Kick local sessions + broadcast to peers using the real userId so
    // peers can target the PAT-bound session — empty userId would leave
    // auth windowed until next refresh.
    evictCachedUserByCredentialId(params.tokenId);
    ConnectionContext.forceSenderRefresh(revoked.userId);
    publishUserSessionSignal('revokeScopedPatForUser', {
        kind: 'credential-revoked',
        userId: revoked.userId,
        credentialId: params.tokenId
    });

    await writeCredentialAudit({
        tenantId: orgId,
        actorId: authzAuditActor(sender.getUser()),
        operation: 'clear',
        credentialKind: 'fm_scoped_pat',
        targetId: params.tokenId,
        userId: revoked.userId
    });

    return {success: true};
}

export async function revokeAllUserPATsImpl(
    params: {userId: string},
    sender: CommandSender
) {
    assertGrantorCanManageCredential({
        grantor: sender,
        credentialKind: 'fm_scoped_pat',
        operation: 'bulk_revoke'
    });
    const orgId = requireSenderOrg(sender);
    requireString('userId', params.userId);
    ensureZitadelManagement();
    await assertTargetInTenant(sender, params.userId, orgId);
    const tokenIds = await revokeAllScopedPatsForUser(orgId, params.userId);
    // Evict local entries before broadcasting so no request reads stale.
    for (const tokenId of tokenIds) {
        evictCachedUserByCredentialId(tokenId);
    }
    if (tokenIds.length > 0) {
        // One auth-changed → peers evict full user_t + force refresh.
        ConnectionContext.forceSenderRefresh(params.userId);
        publishUserSessionSignal('revokeAllScopedPatsForUser', {
            kind: 'auth-changed',
            userId: params.userId
        });
    }
    Observability.incrementCounter(
        'fm_scoped_pat_bulk_revoked',
        tokenIds.length
    );
    // Revoke is committed; audit must not abort the loop or throw. Count
    // and report every missing entry instead of losing them silently.
    const audits = await Promise.allSettled(
        tokenIds.map((tokenId) =>
            writeCredentialAudit({
                tenantId: orgId,
                actorId: authzAuditActor(sender.getUser()),
                operation: 'clear',
                credentialKind: 'fm_scoped_pat',
                targetId: tokenId,
                userId: params.userId,
                count: tokenIds.length
            })
        )
    );
    const missed = audits.filter((a) => a.status === 'rejected').length;
    if (missed > 0) {
        logger.error(
            'bulk PAT revoke for %s: %d of %d audit entries failed to write',
            params.userId,
            missed,
            tokenIds.length
        );
        Observability.incrementCounter('fm_scoped_pat_audit_failures', missed);
    }
    return {revokedCount: tokenIds.length};
}

// Atomic create-new + revoke-old in one tx. Old PAT is dead at commit, so
// any live WS session bound to it must be force-refreshed locally and on
// peers. Real userId in the signal so peers can target the bound session
// instead of just clearing user cache.
export async function rotateScopedPATImpl(
    params: {tokenId: string; expirationDays?: number},
    sender: CommandSender
) {
    assertGrantorCanManageCredential({
        grantor: sender,
        credentialKind: 'fm_scoped_pat',
        operation: 'rotate'
    });
    const orgId = requireSenderOrg(sender);
    requireString('tokenId', params.tokenId);
    const old = await getScopedPatByTenantAndId(orgId, params.tokenId);
    if (!old) throw RpcError.NotFound('scoped pat');
    if (old.revokedAt) throw RpcError.NotFound('scoped pat (revoked)');
    // Re-check tenant: user may have been removed between create and rotate.
    await assertTargetInTenant(sender, old.userId, orgId);
    const expiresAt = expirationFromDays(params.expirationDays);
    const {newTokenId} = await rotateScopedPatTx({
        tenantId: orgId,
        oldTokenId: params.tokenId,
        userId: old.userId,
        boundaryScope: old.boundaryScope,
        audience: old.audience,
        purpose: old.purpose,
        expiresAt,
        createdBy: sender.getUser()?.username ?? 'admin',
        kid: getCurrentKid()
    });
    const token = ScopedTokenSigner.sign(old.userId, newTokenId, expiresAt);
    evictCachedUserByCredentialId(params.tokenId);
    ConnectionContext.forceSenderRefresh(old.userId);
    publishUserSessionSignal('rotateScopedPatForUser', {
        kind: 'credential-revoked',
        userId: old.userId,
        credentialId: params.tokenId
    });
    Observability.incrementCounter('fm_scoped_pat_rotated');
    await writeCredentialAudit({
        tenantId: orgId,
        actorId: authzAuditActor(sender.getUser()),
        operation: 'rotate',
        credentialKind: 'fm_scoped_pat',
        targetId: params.tokenId,
        userId: old.userId,
        oldTokenId: params.tokenId,
        newTokenId
    });
    return {
        tokenId: newTokenId,
        token,
        expirationDate: expiresAt.toISOString()
    };
}
