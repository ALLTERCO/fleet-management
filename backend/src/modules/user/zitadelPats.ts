// Zitadel-issued Personal Access Tokens for service users.
// Scoped PATs (FM-issued JWT) live in user/tokenStore + UserComponent.
//
// The rotate path goes through a single orchestrator (rotatePat) whose
// IO seams are exposed as RotatePatDeps. Production wires real
// implementations via defaultRotatePatDeps; tests substitute fakes.
// Every helper is a small building block with its own unit test.

import log4js from 'log4js';
import {envInt} from '../../config/envReader';
import {tuning} from '../../config/tuning';
import type CommandSender from '../../model/CommandSender';
import RpcError from '../../rpc/RpcError';
import {assertGrantorCanManageCredential} from '../authz/admin';
import type {CredentialAuditInput} from '../authz/audit';
import {authzAuditActor} from '../authz/audit';
import * as Observability from '../Observability';
import * as store from '../PostgresProvider';
import {runBoundedParallel} from '../util/runBoundedParallel';
import {ConnectionContext} from '../web/ws/ConnectionContext';
import {zitadelService} from '../zitadel';
import {evictCachedUserByUserId} from './cache';
import {writeCredentialAudit} from './credentialAudit';
import * as patRevokeWorker from './patRevokeWorker';
import {publishUserSessionSignal} from './sessionNotifications';
import {assertTargetOwnedByTenant} from './tenantGate';
import {ensureZitadelManagement, requireString} from './validation';

const logger = log4js.getLogger('zitadel-pats');

// Masked hint for the key list — first/last 4 chars only, never enough to
// reconstruct the secret. Zitadel doesn't re-expose the token after creation,
// so FM captures this once, at mint time.
export function patKeyHint(token: string): string {
    if (!token || token.length <= 10) return '••••';
    return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

interface PatMetaInput {
    tokenId: string;
    organizationId: string;
    userId: string;
    name: string;
    token: string;
}

// Validate the optional key name against the storage bound (column is 120).
export function validatePatName(name: string | undefined): string {
    if (name == null) return '';
    if (typeof name !== 'string') {
        throw RpcError.InvalidParams('name must be a string');
    }
    const trimmed = name.trim();
    if (trimmed.length > 120) {
        throw RpcError.InvalidParams('name must be 120 characters or fewer');
    }
    return trimmed;
}

// Persist name + masked hint for a freshly-minted token. The token is already
// issued and shown once, so a metadata failure must not sink the create —
// surface it loudly and still return the hint.
export async function recordPatMeta(input: PatMetaInput): Promise<string> {
    const keyHint = patKeyHint(input.token);
    try {
        await store.callMethod(
            'organization.fn_service_user_token_meta_record',
            {
                p_token_id: input.tokenId,
                p_organization_id: input.organizationId,
                p_user_id: input.userId,
                p_name: input.name,
                p_key_hint: keyHint
            }
        );
    } catch (error) {
        logger.error(
            'Failed to persist PAT metadata for token %s: %s',
            input.tokenId,
            error
        );
    }
    return keyHint;
}

// Name + masked hint per token id for one service user.
export async function loadTokenMeta(
    organizationId: string,
    userId: string
): Promise<Map<string, {name: string; keyHint: string}>> {
    const rows = (await store.callMethod(
        'organization.fn_service_user_token_meta_list',
        {p_organization_id: organizationId, p_user_id: userId}
    )) as Array<{token_id: string; name: string; key_hint: string}> | undefined;
    return new Map(
        (Array.isArray(rows) ? rows : []).map((r) => [
            r.token_id,
            {name: r.name, keyHint: r.key_hint}
        ])
    );
}

// ---------------------------------------------------------------------------
// Internal helpers shared by createPat / listPats / revokePat — these don't
// need DI since they're tested via the integration tests of their callers.
// ---------------------------------------------------------------------------

// Zitadel-issued PATs are real Zitadel credentials minted against the
// target user. Only the user's home-org admin may operate on them —
// FM-presence (cross-org grant) is not enough.
async function requireOwnedByTenant(
    sender: CommandSender,
    userId: string
): Promise<string> {
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    ensureZitadelManagement();
    await assertTargetOwnedByTenant(sender, userId, orgId);
    return orgId;
}

// ---------------------------------------------------------------------------
// Input validators — explicit, throw on bad input. Exported for unit test.
// ---------------------------------------------------------------------------

const MIN_EXPIRATION_DAYS = 1;
const MAX_EXPIRATION_DAYS = 365;

export function assertExpirationDaysValid(value: unknown): void {
    if (value === undefined) return;
    if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < MIN_EXPIRATION_DAYS ||
        value > MAX_EXPIRATION_DAYS
    ) {
        throw RpcError.InvalidParams(
            `expirationDays must be an integer between ${MIN_EXPIRATION_DAYS} and ${MAX_EXPIRATION_DAYS}`
        );
    }
}

export function assertGraceMsValid(value: unknown): void {
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw RpcError.InvalidParams(
            'graceMs must be a non-negative finite number'
        );
    }
}

// ---------------------------------------------------------------------------
// Pure derivations — exported for unit test.
// ---------------------------------------------------------------------------

export function expirationDateFromDays(
    days: number | undefined
): Date | undefined {
    if (days === undefined) return undefined;
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
}

export function computeGraceMs(supplied: number | undefined): number {
    if (supplied !== undefined && Number.isFinite(supplied) && supplied >= 0) {
        return supplied;
    }
    return envInt('FM_PAT_ROTATE_GRACE_MS', 0, 0);
}

// ---------------------------------------------------------------------------
// Rotate-path dependency contract. Production wires real implementations;
// tests inject fakes so each building block is exercised end-to-end without
// reaching live Zitadel / DB.
// ---------------------------------------------------------------------------

export interface CreatedPat {
    tokenId: string;
    token: string;
    expirationDate?: string;
}

export interface RotatePatDeps {
    createPat: (
        userId: string,
        expirationDate: Date | undefined
    ) => Promise<CreatedPat>;
    revokePat: (userId: string, tokenId: string) => Promise<void>;
    scheduleRevoke: (
        userId: string,
        tokenId: string,
        revokeAt: Date
    ) => Promise<number>;
    writeAudit: (entry: CredentialAuditInput) => Promise<void>;
    notifyImmediateRevoke: (userId: string) => void;
    assertGrantorCanRotate: (sender: CommandSender) => void;
    assertTenantAccess: (
        sender: CommandSender,
        userId: string
    ) => Promise<string>;
    syncRevokeTimeoutMs: () => number;
}

function notifyImmediateRevokeReal(userId: string): void {
    evictCachedUserByUserId(userId);
    ConnectionContext.forceSenderRefresh(userId);
    publishUserSessionSignal('revokeOldZitadelPatNow', {
        kind: 'auth-changed',
        userId
    });
}

export const defaultRotatePatDeps: RotatePatDeps = {
    createPat: (userId, expirationDate) =>
        zitadelService.createPersonalAccessToken(userId, expirationDate),
    revokePat: (userId, tokenId) =>
        zitadelService.revokePersonalAccessToken(userId, tokenId),
    scheduleRevoke: (userId, tokenId, revokeAt) =>
        patRevokeWorker.schedule(userId, tokenId, revokeAt),
    writeAudit: writeCredentialAudit,
    notifyImmediateRevoke: notifyImmediateRevokeReal,
    assertGrantorCanRotate: (sender) =>
        assertGrantorCanManageCredential({
            grantor: sender,
            credentialKind: 'zitadel_pat',
            operation: 'rotate'
        }),
    assertTenantAccess: requireOwnedByTenant,
    syncRevokeTimeoutMs: () =>
        envInt('FM_PAT_REVOKE_SYNC_TIMEOUT_MS', 5_000, 500)
};

// ---------------------------------------------------------------------------
// Rotate-path building blocks. Each does one thing and has its own test.
// ---------------------------------------------------------------------------

interface RevokeTarget {
    userId: string;
    tokenId: string;
}

// Bounded sync revoke + auth-flush. On timeout / error throws — the
// caller (revokeImmediatelyOrFallbackToSchedule) catches and writes
// the durable schedule fallback. No schedule row is written when this
// succeeds: the immediate revoke and the schedule row are mutually
// exclusive (scheduling alongside a successful immediate would have
// the worker retry an already-revoked token → 404 → bogus failure
// audits).
export async function attemptImmediateRevoke(
    deps: RotatePatDeps,
    target: RevokeTarget
): Promise<void> {
    const timeoutMs = deps.syncRevokeTimeoutMs();
    await Promise.race([
        deps.revokePat(target.userId, target.tokenId),
        new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error('sync revoke timeout')),
                timeoutMs
            )
        )
    ]);
    deps.notifyImmediateRevoke(target.userId);
}

// Audit failures are observability, not state. An audit-write throw after
// a load-bearing write (schedule row, immediate revoke) succeeded must
// NOT propagate, or rotatePat's catch would compensate by revoking the
// new PAT — leaving both tokens revoked. Use this wrapper anywhere a
// load-bearing write has already succeeded.
export async function writeAuditBestEffort(
    deps: RotatePatDeps,
    entry: CredentialAuditInput
): Promise<void> {
    try {
        await deps.writeAudit(entry);
    } catch (err) {
        logger.error(
            'audit write failed (non-fatal): %s',
            err instanceof Error ? err.message : String(err)
        );
        Observability.incrementCounter('pat_rotate_audit_failures');
    }
}

interface ArrangeRevokeInput {
    userId: string;
    tokenId: string;
    graceMs: number;
    sender: CommandSender;
    orgId: string;
}

// Arrange the revoke of the old PAT so the orphan invariant always
// holds: when this function returns successfully, the old PAT is
// either already revoked OR a durable schedule row exists. The
// schedule row and the immediate revoke are mutually exclusive —
// scheduling alongside a successful immediate would have the worker
// retry an already-revoked token (404 from Zitadel → bogus failure
// audits). If both immediate AND schedule-fallback fail, the throw
// propagates so the caller's compensating revoke fires.
export async function arrangeOldPatRevoke(
    deps: RotatePatDeps,
    input: ArrangeRevokeInput
): Promise<void> {
    if (input.graceMs === 0) {
        await revokeImmediatelyOrFallbackToSchedule(deps, input);
        return;
    }
    const revokeAt = new Date(Date.now() + input.graceMs);
    await deps.scheduleRevoke(input.userId, input.tokenId, revokeAt);
}

async function revokeImmediatelyOrFallbackToSchedule(
    deps: RotatePatDeps,
    input: ArrangeRevokeInput
): Promise<void> {
    try {
        await attemptImmediateRevoke(deps, {
            userId: input.userId,
            tokenId: input.tokenId
        });
        return;
    } catch (immediateErr) {
        await scheduleFallbackAfterImmediateFailure(deps, {
            ...input,
            immediateErr
        });
    }
}

async function scheduleFallbackAfterImmediateFailure(
    deps: RotatePatDeps,
    input: ArrangeRevokeInput & {immediateErr: unknown}
): Promise<void> {
    // Load-bearing: if this throws, rotatePat compensates by revoking
    // the new PAT (correct — no orphan).
    await deps.scheduleRevoke(input.userId, input.tokenId, new Date());
    // Observability: the schedule succeeded; audit failure must not
    // undo the rotation. See writeAuditBestEffort comment.
    await writeAuditBestEffort(
        deps,
        immediateRevokeFailureAuditEntry(input, input.immediateErr)
    );
}

// Pure audit-entry builder for the immediate-revoke retry case. Exported
// for unit test so the entry shape stays pinned.
export function immediateRevokeFailureAuditEntry(
    input: ArrangeRevokeInput,
    immediateErr: unknown
): CredentialAuditInput {
    return {
        tenantId: input.orgId,
        actorId: authzAuditActor(input.sender.getUser()),
        operation: 'retry',
        credentialKind: 'zitadel_pat',
        targetId: input.tokenId,
        userId: input.userId,
        error:
            immediateErr instanceof Error
                ? immediateErr.message
                : String(immediateErr),
        fallbackScheduled: true
    };
}

// Pure audit-entry builder for the successful rotation. Exported for
// unit test so the entry shape stays pinned.
export function rotateSuccessAuditEntry(input: {
    userId: string;
    oldTokenId: string;
    newTokenId: string;
    sender: CommandSender;
    orgId: string;
}): CredentialAuditInput {
    return {
        tenantId: input.orgId,
        actorId: authzAuditActor(input.sender.getUser()),
        operation: 'rotate',
        credentialKind: 'zitadel_pat',
        targetId: input.oldTokenId,
        userId: input.userId,
        oldTokenId: input.oldTokenId,
        newTokenId: input.newTokenId
    };
}

interface CompensateInput {
    userId: string;
    newTokenId: string;
    cause: unknown;
}

// Best-effort revoke of a just-issued PAT after rotate's durable schedule
// step failed. Keeps the system from holding two live tokens when the
// caller is about to receive an error. Failure to compensate is logged +
// counted for operator follow-up; both tokens stay live in the rare
// double-failure case.
export async function compensateNewPatAfterScheduleFailure(
    deps: RotatePatDeps,
    input: CompensateInput
): Promise<void> {
    logger.error(
        'PAT rotation could not durably schedule revoke for user=%s; compensating by revoking new token=%s: %s',
        input.userId,
        input.newTokenId,
        input.cause instanceof Error ? input.cause.message : String(input.cause)
    );
    Observability.incrementCounter('pat_rotate_compensate_attempts');
    try {
        await deps.revokePat(input.userId, input.newTokenId);
    } catch (revokeErr) {
        // Schedule failed AND compensating revoke failed. Both tokens
        // live; operator must clean up via User.RevokePAT. Caller still
        // gets the original schedule error.
        logger.error(
            'compensating revoke failed user=%s token=%s — manual cleanup required: %s',
            input.userId,
            input.newTokenId,
            revokeErr instanceof Error ? revokeErr.message : String(revokeErr)
        );
        Observability.incrementCounter('pat_rotate_compensate_failures');
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createPat(
    params: {userId: string; expirationDays?: number; name?: string},
    sender: CommandSender
) {
    assertGrantorCanManageCredential({
        grantor: sender,
        credentialKind: 'zitadel_pat',
        operation: 'create'
    });
    requireString('userId', params.userId);
    assertExpirationDaysValid(params.expirationDays);
    const name = validatePatName(params.name);
    const orgId = await requireOwnedByTenant(sender, params.userId);

    const expirationDate = expirationDateFromDays(params.expirationDays);
    const pat = await zitadelService.createPersonalAccessToken(
        params.userId,
        expirationDate
    );

    await writeCredentialAudit({
        tenantId: orgId,
        actorId: authzAuditActor(sender.getUser()),
        operation: 'set',
        credentialKind: 'zitadel_pat',
        targetId: pat.tokenId,
        userId: params.userId
    });

    // Zitadel stores neither a name nor a way to re-read the token, so mint
    // time is the only chance to capture both for the key list.
    const keyHint = await recordPatMeta({
        tokenId: pat.tokenId,
        organizationId: orgId,
        userId: params.userId,
        name,
        token: pat.token
    });

    // Token is returned ONCE — frontend must show it for copy.
    return {
        tokenId: pat.tokenId,
        token: pat.token,
        expirationDate: pat.expirationDate,
        name,
        keyHint
    };
}

export async function listPats(
    params: {userId: string},
    sender: CommandSender
) {
    requireString('userId', params.userId);
    const orgId = await requireOwnedByTenant(sender, params.userId);
    const tokens = await zitadelService.listPersonalAccessTokens(params.userId);

    const meta = await loadTokenMeta(orgId, params.userId);
    const items = tokens.map((t) => ({
        ...t,
        ...(meta.get(t.tokenId) ?? {name: '', keyHint: ''})
    }));
    return {items, total: items.length};
}

export async function revokePat(
    params: {userId: string; tokenId: string},
    sender: CommandSender
) {
    assertGrantorCanManageCredential({
        grantor: sender,
        credentialKind: 'zitadel_pat',
        operation: 'revoke'
    });
    requireString('userId', params.userId);
    requireString('tokenId', params.tokenId);
    const orgId = await requireOwnedByTenant(sender, params.userId);

    await zitadelService.revokePersonalAccessToken(
        params.userId,
        params.tokenId
    );

    // Zitadel hard-deletes PATs on revoke, so drop our orphaned metadata too.
    await store.callMethod('organization.fn_service_user_token_meta_delete', {
        p_token_id: params.tokenId
    });

    // Evict auth cache, refresh WS senders, broadcast to peers.
    evictCachedUserByUserId(params.userId);
    ConnectionContext.forceSenderRefresh(params.userId);
    publishUserSessionSignal('revokeZitadelPat', {
        kind: 'auth-changed',
        userId: params.userId
    });

    await writeCredentialAudit({
        tenantId: orgId,
        actorId: authzAuditActor(sender.getUser()),
        operation: 'clear',
        credentialKind: 'zitadel_pat',
        targetId: params.tokenId,
        userId: params.userId
    });

    return {success: true};
}

export interface RotatePatParams {
    userId: string;
    tokenId: string;
    expirationDays?: number;
    graceMs?: number;
}

export interface RotatePatResult {
    tokenId: string;
    token: string;
    expirationDate?: string;
    replacedTokenId: string;
    graceMs: number;
}

export async function rotatePat(
    params: RotatePatParams,
    sender: CommandSender,
    deps: RotatePatDeps = defaultRotatePatDeps
): Promise<RotatePatResult> {
    deps.assertGrantorCanRotate(sender);
    requireString('userId', params.userId);
    requireString('tokenId', params.tokenId);
    assertExpirationDaysValid(params.expirationDays);
    assertGraceMsValid(params.graceMs);

    const orgId = await deps.assertTenantAccess(sender, params.userId);
    const expirationDate = expirationDateFromDays(params.expirationDays);
    const graceMs = computeGraceMs(params.graceMs);

    const fresh = await deps.createPat(params.userId, expirationDate);

    try {
        await arrangeOldPatRevoke(deps, {
            userId: params.userId,
            tokenId: params.tokenId,
            graceMs,
            sender,
            orgId
        });
    } catch (err) {
        // CR-44: durable schedule write failed. Without it the old PAT
        // would live with no revoke ever queued. Compensate by revoking
        // the new PAT, then surface the failure.
        await compensateNewPatAfterScheduleFailure(deps, {
            userId: params.userId,
            newTokenId: fresh.tokenId,
            cause: err
        });
        throw RpcError.OperationFailed('schedule PAT revoke', err);
    }

    // Best-effort: the rotation is committed once arrangeOldPatRevoke
    // returns. An audit failure here must not be re-interpreted as a
    // rotation failure (the caller already has the new token).
    await writeAuditBestEffort(
        deps,
        rotateSuccessAuditEntry({
            userId: params.userId,
            oldTokenId: params.tokenId,
            newTokenId: fresh.tokenId,
            sender,
            orgId
        })
    );

    return {
        tokenId: fresh.tokenId,
        token: fresh.token,
        expirationDate: fresh.expirationDate,
        replacedTokenId: params.tokenId,
        graceMs
    };
}

interface BulkRotationResult {
    replacedTokenId: string;
    tokenId?: string;
    token?: string;
    expirationDate?: string;
    ok: boolean;
    error?: string;
}

export async function bulkRotatePats(
    params: {userId: string; expirationDays?: number; graceMs?: number},
    sender: CommandSender
) {
    assertGrantorCanManageCredential({
        grantor: sender,
        credentialKind: 'zitadel_pat',
        operation: 'rotate'
    });
    requireString('userId', params.userId);
    assertExpirationDaysValid(params.expirationDays);
    assertGraceMsValid(params.graceMs);
    await requireOwnedByTenant(sender, params.userId);

    const tokens = await zitadelService.listPersonalAccessTokens(params.userId);

    // Slow Zitadel call must not pin the whole rotation batch.
    const ROTATE_PER_TASK_TIMEOUT_MS = 30_000;
    const rotateOne = async (
        t: (typeof tokens)[number]
    ): Promise<BulkRotationResult> => {
        try {
            const r = await rotatePat(
                {
                    userId: params.userId,
                    tokenId: t.tokenId,
                    expirationDays: params.expirationDays,
                    graceMs: params.graceMs
                },
                sender
            );
            return {
                replacedTokenId: t.tokenId,
                tokenId: r.tokenId,
                token: r.token,
                expirationDate: r.expirationDate,
                ok: true
            };
        } catch (err) {
            return {
                replacedTokenId: t.tokenId,
                ok: false,
                error: err instanceof Error ? err.message : String(err)
            };
        }
    };

    const settled = await runBoundedParallel({
        tasks: tokens,
        run: rotateOne,
        concurrency: Math.max(1, tuning.zitadel.patBulkRotateConcurrency),
        perTaskTimeoutMs: ROTATE_PER_TASK_TIMEOUT_MS,
        label: 'zitadel-pat-rotate'
    });
    const results: BulkRotationResult[] = settled.map((r, i) =>
        r.status === 'fulfilled'
            ? r.value
            : {
                  replacedTokenId: tokens[i].tokenId,
                  ok: false,
                  error:
                      r.reason instanceof Error
                          ? r.reason.message
                          : String(r.reason)
              }
    );

    return {results};
}
