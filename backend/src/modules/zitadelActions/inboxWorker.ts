import log4js from 'log4js';
import {envInt} from '../../config/envReader';
import * as Observability from '../Observability';
import * as PostgresProvider from '../PostgresProvider';
import {formatError} from '../util/formatError';
import {createLeaderPollWorker} from '../worker/leaderPollWorker';
import {processGrantRemoved} from './grantRemoved';
import type {ZitadelActionName} from './inbox';
import {
    getZitadelActionInboxSnapshot,
    updateZitadelActionInboxSnapshot
} from './inboxMetrics';
import {processUserRemoved} from './userRemoved';

const logger = log4js.getLogger('zitadel-action-inbox');
const LEADER_NAME = 'zitadel-action-inbox';

interface InboxRow {
    event_key: string;
    action: ZitadelActionName;
    user_id: string;
    payload: unknown;
    source_ip: string | null;
    attempts: number;
}

function pollIntervalMs(): number {
    return envInt('FM_ZITADEL_ACTION_POLL_INTERVAL_MS', 250, 50);
}

function idlePollMaxMs(): number {
    return envInt('FM_ZITADEL_ACTION_IDLE_POLL_MAX_MS', 2_000, 50);
}

async function claimDue(): Promise<InboxRow[]> {
    const limit = envInt('FM_ZITADEL_ACTION_BATCH_SIZE', 16, 1);
    return PostgresProvider.queryRows<InboxRow>(
        `UPDATE organization.zitadel_action_inbox inbox
            SET status = 'in_progress', claimed_at = now()
           FROM (
               SELECT event_key
                 FROM organization.zitadel_action_inbox
                WHERE status = 'queued' AND available_at <= now()
                ORDER BY received_at, event_key
                LIMIT $1
                FOR UPDATE SKIP LOCKED
           ) due
          WHERE inbox.event_key = due.event_key
      RETURNING inbox.event_key, inbox.action, inbox.user_id, inbox.payload,
                inbox.source_ip, inbox.attempts`,
        [limit]
    );
}

async function markDone(row: InboxRow): Promise<void> {
    await PostgresProvider.queryRows(
        `UPDATE organization.zitadel_action_inbox
            SET status = 'done', processed_at = now(), claimed_at = NULL,
                last_error = NULL
          WHERE event_key = $1`,
        [row.event_key]
    );
    updateZitadelActionInboxSnapshot({
        lastSuccessTimestampSeconds: Date.now() / 1000
    });
    Observability.incrementLabeledCounter('zitadel_webhook_processed_total', {
        action: row.action
    });
}

function retryDelayMs(attempts: number): number {
    const base = envInt('FM_ZITADEL_ACTION_RETRY_BASE_MS', 1_000, 100);
    const cap = envInt('FM_ZITADEL_ACTION_RETRY_CAP_MS', 300_000, 1_000);
    return Math.min(cap, base * 2 ** Math.min(attempts, 16));
}

async function markRetry(row: InboxRow, err: unknown): Promise<void> {
    const message = formatError(err).slice(0, 2_000);
    await PostgresProvider.queryRows(
        `UPDATE organization.zitadel_action_inbox
            SET status = 'queued',
                attempts = attempts + 1,
                available_at = now() + ($1 || ' ms')::interval,
                claimed_at = NULL,
                last_error = $2
          WHERE event_key = $3`,
        [retryDelayMs(row.attempts + 1), message, row.event_key]
    );
    Observability.incrementLabeledCounter(
        'zitadel_webhook_processing_failures_total',
        {action: row.action}
    );
    logger.warn(
        'Zitadel callback failed action=%s user=%s attempt=%d: %s',
        row.action,
        row.user_id,
        row.attempts + 1,
        message
    );
}

type ActionProcessor = (row: InboxRow) => Promise<void>;

async function processAction(row: InboxRow): Promise<void> {
    if (row.action === 'user.removed') {
        await processUserRemoved(
            row.user_id,
            row.payload,
            row.source_ip ?? undefined
        );
    } else {
        await processGrantRemoved(
            row.user_id,
            row.source_ip ?? undefined,
            row.payload
        );
    }
}

async function processRowWith(
    row: InboxRow,
    processor: ActionProcessor
): Promise<void> {
    try {
        await processor(row);
        await markDone(row);
    } catch (err) {
        await markRetry(row, err);
    }
}

async function processBounded(
    rows: InboxRow[],
    processor: ActionProcessor = processAction
): Promise<void> {
    const concurrency = Math.min(
        envInt('FM_ZITADEL_ACTION_CONCURRENCY', 2, 1),
        rows.length
    );
    let next = 0;
    async function run(): Promise<void> {
        while (next < rows.length) {
            const row = rows[next++];
            if (!row) return;
            await processRowWith(row, processor);
        }
    }
    await Promise.all(Array.from({length: concurrency}, () => run()));
}

async function refreshSnapshot(): Promise<void> {
    const rows = await PostgresProvider.queryRows<{
        queued: number;
        in_progress: number;
        oldest_age_seconds: number;
    }>(
        `SELECT
             count(*) FILTER (WHERE status = 'queued')::INT AS queued,
             count(*) FILTER (WHERE status = 'in_progress')::INT AS in_progress,
             COALESCE(EXTRACT(EPOCH FROM
                 (now() - min(received_at) FILTER (WHERE status = 'queued'))
             ), 0)::DOUBLE PRECISION AS oldest_age_seconds
           FROM organization.zitadel_action_inbox`
    );
    const row = rows[0];
    updateZitadelActionInboxSnapshot({
        queued: Number(row?.queued ?? 0),
        inProgress: Number(row?.in_progress ?? 0),
        oldestQueuedAgeSeconds: Number(row?.oldest_age_seconds ?? 0)
    });
}

async function maintainInbox(): Promise<void> {
    const staleMs = envInt('FM_ZITADEL_ACTION_STALE_MS', 300_000, 30_000);
    const doneRetentionHours = envInt(
        'FM_ZITADEL_ACTION_DONE_RETENTION_HOURS',
        24,
        1
    );
    await PostgresProvider.queryRows(
        `UPDATE organization.zitadel_action_inbox
            SET status = 'queued', claimed_at = NULL, available_at = now()
          WHERE status = 'in_progress'
            AND claimed_at < now() - ($1 || ' ms')::interval`,
        [staleMs]
    );
    await PostgresProvider.queryRows(
        `DELETE FROM organization.zitadel_action_inbox
          WHERE status = 'done'
            AND processed_at < now() - ($1 || ' hours')::interval`,
        [doneRetentionHours]
    );
}

async function tick(): Promise<number> {
    const rows = await claimDue();
    await processBounded(rows);
    await refreshSnapshot();
    return rows.length;
}

const worker = createLeaderPollWorker({
    leaderName: LEADER_NAME,
    logger,
    pollIntervalMs,
    idlePollMaxMs,
    tick,
    reclaim: {run: maintainInbox, intervalMs: 60_000}
});

export const start = worker.start;
export const stop = worker.stop;

export async function __tickForTests(): Promise<void> {
    await worker.tickOnce();
}

export async function __runCycleForTests(
    processor: (event: {
        eventKey: string;
        action: ZitadelActionName;
        userId: string;
        payload: unknown;
    }) => Promise<void>
): Promise<void> {
    const rows = await claimDue();
    await processBounded(rows, (row) =>
        processor({
            eventKey: row.event_key,
            action: row.action,
            userId: row.user_id,
            payload: row.payload
        })
    );
    await refreshSnapshot();
}

export {getZitadelActionInboxSnapshot};
