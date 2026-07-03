// Durable PAT revoke worker. Drains pat_revoke_schedule rows past revoke_at.

import log4js from 'log4js';
import {envInt} from '../../config/envReader';
import * as store from '../PostgresProvider';
import {runBoundedParallel} from '../util/runBoundedParallel';
import {ConnectionContext} from '../web/ws/ConnectionContext';
import {createLeaderPollWorker} from '../worker/leaderPollWorker';
import {zitadelService} from '../zitadel';
import {evictCachedUserByUserId} from './cache';
import {publishUserSessionSignal} from './sessionNotifications';

const logger = log4js.getLogger('pat-revoke');
const LEADER_NAME = 'pat-revoke-worker';

function intervalMs(): number {
    return envInt('FM_PAT_REVOKE_POLL_INTERVAL_MS', 30_000, 1_000);
}
function maxAttempts(): number {
    return envInt('FM_PAT_REVOKE_MAX_ATTEMPTS', 5, 1);
}

interface DueRow {
    id: number;
    user_id: string;
    token_id: string;
    attempts: number;
}

async function selectDue(limit = 16): Promise<DueRow[]> {
    return (await store.queryRows(
        `UPDATE organization.pat_revoke_schedule p
            SET status='in_progress', claimed_at=now()
           FROM (
               SELECT id FROM organization.pat_revoke_schedule
                WHERE status='queued' AND revoke_at <= now()
                ORDER BY id ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
           ) sub
          WHERE p.id = sub.id
      RETURNING p.id, p.user_id, p.token_id, p.attempts`,
        [limit]
    )) as unknown as DueRow[];
}

async function markDone(id: number): Promise<void> {
    await store.queryRows(
        `UPDATE organization.pat_revoke_schedule
            SET status='done', finished_at=now(), last_error=NULL
          WHERE id=$1`,
        [id]
    );
}

function backoffMs(attempts: number): number {
    const base = envInt('FM_PAT_REVOKE_BACKOFF_BASE_MS', 30_000, 1_000);
    const cap = envInt('FM_PAT_REVOKE_BACKOFF_CAP_MS', 3_600_000, 60_000);
    const exp = Math.min(cap, base * 2 ** attempts);
    // ±20% jitter to avoid thundering herd on a flaky upstream.
    return Math.floor(exp * (0.8 + Math.random() * 0.4));
}

async function markFailed(
    id: number,
    err: string,
    attempts: number
): Promise<void> {
    const exhausted = attempts + 1 >= maxAttempts();
    if (exhausted) {
        await store.queryRows(
            `UPDATE organization.pat_revoke_schedule
                SET status='failed',
                    last_error=$1,
                    attempts = attempts + 1,
                    finished_at = now()
              WHERE id=$2`,
            [err, id]
        );
        return;
    }
    const delay = backoffMs(attempts + 1);
    await store.queryRows(
        `UPDATE organization.pat_revoke_schedule
            SET status='queued',
                last_error=$1,
                attempts = attempts + 1,
                revoke_at = now() + ($2 || ' ms')::interval
          WHERE id=$3`,
        [err, delay, id]
    );
}

async function processRow(row: DueRow): Promise<void> {
    try {
        await zitadelService.revokePersonalAccessToken(
            row.user_id,
            row.token_id
        );
        // Same auth-flush as User.RevokePAT — the delayed worker runs
        // independently of the HTTP path that scheduled it.
        evictCachedUserByUserId(row.user_id);
        ConnectionContext.forceSenderRefresh(row.user_id);
        publishUserSessionSignal('patRevokeWorker', {
            kind: 'auth-changed',
            userId: row.user_id
        });
        await markDone(row.id);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
            'PAT revoke failed user=%s token=%s attempt=%d: %s',
            row.user_id,
            row.token_id,
            row.attempts + 1,
            msg
        );
        await markFailed(row.id, msg, row.attempts);
    }
}

// Reclaim rows stuck in_progress past the stale window (crash recovery).
async function reclaimStranded(): Promise<void> {
    const staleMs = envInt('FM_PAT_REVOKE_STALE_MS', 5 * 60_000, 30_000);
    await store.queryRows(
        `UPDATE organization.pat_revoke_schedule
            SET status='queued'
          WHERE status='in_progress'
            AND claimed_at IS NOT NULL
            AND claimed_at < now() - ($1 || ' ms')::interval`,
        [staleMs]
    );
}

// One hung Zitadel revoke must not pin the tick.
const ROW_TIMEOUT_MS = envInt('FM_PAT_REVOKE_ROW_TIMEOUT_MS', 30_000, 1_000);

async function runTick(): Promise<void> {
    await reclaimStranded();
    const rows = await selectDue();
    if (rows.length === 0) return;
    await runBoundedParallel({
        tasks: rows,
        run: (r) => processRow(r),
        concurrency: envInt('FM_PAT_REVOKE_CONCURRENCY', 4, 1),
        perTaskTimeoutMs: ROW_TIMEOUT_MS,
        label: 'pat-revoke'
    });
}

export async function schedule(
    userId: string,
    tokenId: string,
    revokeAt: Date
): Promise<number> {
    const rows = (await store.queryRows(
        `INSERT INTO organization.pat_revoke_schedule
             (user_id, token_id, revoke_at)
         VALUES ($1, $2, $3)
      RETURNING id`,
        [userId, tokenId, revokeAt.toISOString()]
    )) as unknown as Array<{id: number}>;
    return rows[0].id;
}

const worker = createLeaderPollWorker({
    leaderName: LEADER_NAME,
    logger,
    pollIntervalMs: intervalMs,
    tick: runTick
});

export const start = worker.start;
export const stop = worker.stop;

export async function __tickForTests(): Promise<void> {
    await worker.tickOnce();
}
