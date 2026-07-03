// CRUD over organization.fm_scoped_pats. The auth gate looks up
// (tokenId) on every request; revoke/expiry filter applied in SQL so
// stale tokens never reach the resolver.

import {getLogger} from 'log4js';
import {envIntRequired} from '../../config/envReader';
import type {Scope} from '../authz/types';
import * as store from '../PostgresProvider';
import {isLeader, startLeaderGate} from '../redis/leaderGate';

const SWEEP_LEADER_NAME = 'scoped-pat-sweep';

const logger = getLogger('scoped-pat');

export interface ScopedPatRow {
    tokenId: string;
    tenantId: string;
    userId: string;
    boundaryScope: Scope;
    audience: string[];
    purpose: string;
    expiresAt: string;
    createdAt: string;
    createdBy: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    kid: string;
}

interface ScopedPatDbRow {
    token_id: string;
    tenant_id: string;
    user_id: string;
    boundary_scope: Scope;
    audience: string[];
    purpose: string;
    expires_at: string;
    created_at: string;
    created_by: string;
    last_used_at: string | null;
    revoked_at: string | null;
    kid: string;
}

function rowToScopedPat(r: ScopedPatDbRow): ScopedPatRow {
    return {
        tokenId: r.token_id,
        tenantId: r.tenant_id,
        userId: r.user_id,
        boundaryScope: r.boundary_scope,
        audience: r.audience,
        purpose: r.purpose,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        createdBy: r.created_by,
        lastUsedAt: r.last_used_at,
        revokedAt: r.revoked_at,
        kid: r.kid
    };
}

const COLUMNS = `
    token_id::text, tenant_id::text, user_id, boundary_scope,
    audience, purpose, expires_at, created_at, created_by,
    last_used_at, revoked_at, kid
`;

// Auth-gate lookup. Filters revoked + expired so stale rows never load.
export async function getActiveScopedPat(
    tokenId: string
): Promise<ScopedPatRow | undefined> {
    const rows = await store.queryRows<ScopedPatDbRow>(
        `SELECT ${COLUMNS}
           FROM organization.fm_scoped_pats
          WHERE token_id = $1
            AND revoked_at IS NULL
            AND expires_at > now()
          LIMIT 1`,
        [tokenId]
    );
    return rows[0] ? rowToScopedPat(rows[0]) : undefined;
}

export interface CreateScopedPatParams {
    tenantId: string;
    userId: string;
    boundaryScope: Scope;
    audience?: string[];
    purpose: string;
    expiresAt: Date;
    createdBy: string;
    kid: string;
}

export async function createScopedPat(
    p: CreateScopedPatParams
): Promise<{tokenId: string}> {
    const rows = await store.queryRows<{token_id: string}>(
        `INSERT INTO organization.fm_scoped_pats
             (tenant_id, user_id, boundary_scope, audience, purpose,
              expires_at, created_by, kid)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
         RETURNING token_id::text`,
        [
            p.tenantId,
            p.userId,
            JSON.stringify(p.boundaryScope),
            p.audience ?? [],
            p.purpose,
            p.expiresAt.toISOString(),
            p.createdBy,
            p.kid
        ]
    );
    return {tokenId: rows[0].token_id};
}

export async function listScopedPatsByUser(
    tenantId: string,
    userId: string
): Promise<ScopedPatRow[]> {
    const rows = await store.queryRows<ScopedPatDbRow>(
        `SELECT ${COLUMNS}
           FROM organization.fm_scoped_pats
          WHERE tenant_id = $1 AND user_id = $2
          ORDER BY revoked_at NULLS FIRST, created_at DESC`,
        [tenantId, userId]
    );
    return rows.map(rowToScopedPat);
}

export async function listScopedPatsByTenant(
    tenantId: string
): Promise<ScopedPatRow[]> {
    const rows = await store.queryRows<ScopedPatDbRow>(
        `SELECT ${COLUMNS}
           FROM organization.fm_scoped_pats
          WHERE tenant_id = $1
          ORDER BY revoked_at NULLS FIRST, created_at DESC`,
        [tenantId]
    );
    return rows.map(rowToScopedPat);
}

// True iff userId has ANY persona assignment or user_group membership
// inside tenantId. Gates cross-org PAT creation: admin in org A can't
// mint a PAT for a foreign userId that happens to be provider support in
// Zitadel — the resulting user_t would otherwise inherit global Zitadel
// roles while presenting as a member of org A.
export async function userHasPresenceInTenant(
    tenantId: string,
    userId: string
): Promise<boolean> {
    const rows = await store.queryRows<{found: boolean}>(
        `SELECT EXISTS (
             SELECT 1 FROM organization.assignments
              WHERE tenant_id = $1 AND subject_type = 'user' AND subject_id = $2
             UNION ALL
             SELECT 1 FROM organization.user_group_memberships m
                     JOIN organization.user_groups g ON m.group_id = g.id
              WHERE g.tenant_id = $1 AND m.user_id = $2
         ) AS found`,
        [tenantId, userId]
    );
    return rows[0]?.found === true;
}

// Single-row fetch by tenant + tokenId. Returns the row regardless of
// revoked_at / expires_at — caller decides what to do with stale rows.
export async function getScopedPatByTenantAndId(
    tenantId: string,
    tokenId: string
): Promise<ScopedPatRow | undefined> {
    const rows = await store.queryRows<ScopedPatDbRow>(
        `SELECT ${COLUMNS}
           FROM organization.fm_scoped_pats
          WHERE tenant_id = $1 AND token_id = $2
          LIMIT 1`,
        [tenantId, tokenId]
    );
    return rows[0] ? rowToScopedPat(rows[0]) : undefined;
}

// Bulk soft-delete. Returns the tokenIds that flipped from active → revoked.
// Audit trail: the outer RPC is audited by Commander, but the specific
// tokenIds that flipped aren't in the RPC params — log them explicitly so
// post-incident analysis can reconstruct which credentials were live.
export async function revokeAllScopedPatsForUser(
    tenantId: string,
    userId: string
): Promise<string[]> {
    const rows = await store.queryRows<{token_id: string}>(
        `UPDATE organization.fm_scoped_pats
            SET revoked_at = now()
          WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL
          RETURNING token_id::text`,
        [tenantId, userId]
    );
    const tokenIds = rows.map((r) => r.token_id);
    if (tokenIds.length > 0) {
        logger.info(
            'bulk-revoke scoped PATs: tenant=%s user=%s count=%d ids=%s',
            tenantId,
            userId,
            tokenIds.length,
            tokenIds.join(',')
        );
    }
    return tokenIds;
}

// Atomic: revoke old, insert new with same boundary/audience/purpose.
// Throws if old is missing or already revoked; new is inserted in the
// same TX so a failure mid-way leaves the old row untouched.
export interface RotateScopedPatParams {
    tenantId: string;
    oldTokenId: string;
    userId: string;
    boundaryScope: Scope;
    audience: string[];
    purpose: string;
    expiresAt: Date;
    createdBy: string;
    kid: string;
}

export async function rotateScopedPatTx(
    p: RotateScopedPatParams
): Promise<{newTokenId: string}> {
    return store.withQueryTransaction(async (tx) => {
        const revoked = await tx.query<{token_id: string}>(
            `UPDATE organization.fm_scoped_pats
                SET revoked_at = now()
              WHERE tenant_id = $1 AND token_id = $2 AND revoked_at IS NULL
              RETURNING token_id::text`,
            [p.tenantId, p.oldTokenId]
        );
        if (revoked.length === 0) {
            throw new Error('scoped pat not found or already revoked');
        }
        const inserted = await tx.query<{token_id: string}>(
            `INSERT INTO organization.fm_scoped_pats
                 (tenant_id, user_id, boundary_scope, audience, purpose,
                  expires_at, created_by, kid)
             VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
             RETURNING token_id::text`,
            [
                p.tenantId,
                p.userId,
                JSON.stringify(p.boundaryScope),
                p.audience,
                p.purpose,
                p.expiresAt.toISOString(),
                p.createdBy,
                p.kid
            ]
        );
        return {newTokenId: inserted[0].token_id};
    });
}

// Soft-delete. Returns the row's user_id when it transitioned, undefined
// otherwise. Caller uses user_id to publish a session-kick signal.
export async function revokeScopedPat(
    tenantId: string,
    tokenId: string
): Promise<{userId: string} | undefined> {
    const rows = await store.queryRows<{user_id: string}>(
        `UPDATE organization.fm_scoped_pats
            SET revoked_at = now()
          WHERE token_id = $1 AND tenant_id = $2 AND revoked_at IS NULL
          RETURNING user_id`,
        [tokenId, tenantId]
    );
    return rows[0] ? {userId: rows[0].user_id} : undefined;
}

// Best-effort last-used bump. Fire-and-forget from the auth gate; failures
// log-and-continue at the caller (don't block the request on a write).
export async function touchScopedPatLastUsed(tokenId: string): Promise<void> {
    await store.queryRows(
        `UPDATE organization.fm_scoped_pats
            SET last_used_at = now()
          WHERE token_id = $1 AND revoked_at IS NULL`,
        [tokenId]
    );
}

// Hard-delete rows whose revoked_at OR expires_at is older than the cutoff.
export async function sweepStaleScopedPats(
    retentionDays: number
): Promise<number> {
    const rows = await store.queryRows<{token_id: string}>(
        `DELETE FROM organization.fm_scoped_pats
          WHERE (revoked_at IS NOT NULL
                 AND revoked_at < now() - ($1 || ' days')::interval)
             OR (expires_at  < now() - ($1 || ' days')::interval)
         RETURNING token_id::text`,
        [retentionDays]
    );
    return rows.length;
}

// Env-driven periodic sweep. Started from app boot.
let sweepTimer: NodeJS.Timeout | null = null;
export function startScopedPatRetentionSweep(): void {
    if (sweepTimer) return;
    const intervalMs = envIntRequired('FM_SCOPED_PAT_SWEEP_INTERVAL_MS');
    const retentionDays = envIntRequired('FM_SCOPED_PAT_RETENTION_DAYS');
    void startLeaderGate(SWEEP_LEADER_NAME);
    sweepTimer = setInterval(() => {
        if (!isLeader(SWEEP_LEADER_NAME)) return;
        sweepStaleScopedPats(retentionDays)
            .then((n) => {
                if (n > 0) logger.info('swept %d stale scoped PAT row(s)', n);
            })
            .catch((err) =>
                logger.warn('scoped PAT retention sweep failed: %s', err)
            );
    }, intervalMs);
    sweepTimer.unref?.();
}

export function stopScopedPatRetentionSweep(): void {
    if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
    }
}
