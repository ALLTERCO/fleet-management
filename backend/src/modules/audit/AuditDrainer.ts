// Drains the audit overflow stream into Postgres. Leader-elected: only one
// FM instance writes to PG at a time, others stand by.
import log4js from 'log4js';
import {tuning} from '../../config';
import type {AuditLogEntry} from '../AuditLogger';
import {entryToBatchRow} from '../auditBatchRow';
import * as Observability from '../Observability';
import {getInstanceId} from '../redis/instanceId';
import {Leadership} from '../redis/Leadership';
import {
    type RedisStream,
    recoverMissingGroup,
    type StreamEntry
} from '../redis/RedisStream';
import {runDrainCycle} from '../redis/runDrainCycle';
import {bestEffort} from '../util/fireAndForget';
import {formatError} from '../util/formatError';
import {sleep} from '../util/sleep';
import {getOverflowDrainerStream} from './AuditOverflowStream';
import {writeAuditRow, writeAuditRowBatch} from './writeAuditRow';

const logger = log4js.getLogger('audit-drainer');
const GROUP = 'audit-drainer';
// Per-instance so autoclaim doesn't self-reassign if the leader pattern
// ever loosens to multi-consumer.
const CONSUMER = `d-${getInstanceId()}`;
const LEADER_NAME = 'audit-drainer';

let stopped = false;
let done: Promise<void> | undefined;
let leadership: Leadership | undefined;

interface ParsedEntry {
    id: string;
    entry: AuditLogEntry;
}

interface ParseResult {
    parsed: ParsedEntry[];
    poisonIds: string[];
}

function parseEntries(entries: StreamEntry[]): ParseResult {
    const parsed: ParsedEntry[] = [];
    const poisonIds: string[] = [];
    for (const entry of entries) {
        try {
            parsed.push({
                id: entry.id,
                entry: JSON.parse(entry.fields.entry) as AuditLogEntry
            });
        } catch (err) {
            Observability.incrementCounter('audit_overflow_poison');
            logger.error('audit overflow poison id=%s: %s', entry.id, err);
            poisonIds.push(entry.id);
        }
    }
    return {parsed, poisonIds};
}

async function writeBatch(parsed: ParsedEntry[]): Promise<void> {
    if (parsed.length === 0) return;
    await writeAuditRowBatch(
        parsed.map((p) =>
            entryToBatchRow(
                p.entry,
                tuning.audit.maxParamsChars,
                tuning.audit.persistedErrorMessageMaxChars
            )
        )
    );
}

interface PerRowResult {
    succeeded: string[];
    failedRows: string[];
}

async function writePerRow(parsed: ParsedEntry[]): Promise<PerRowResult> {
    const succeeded: string[] = [];
    const failedRows: string[] = [];
    for (const {id, entry} of parsed) {
        const row = entryToBatchRow(
            entry,
            tuning.audit.maxParamsChars,
            tuning.audit.persistedErrorMessageMaxChars
        );
        try {
            await writeAuditRow(row);
            succeeded.push(id);
            Observability.incrementCounter('audit_overflow_drained');
        } catch (err) {
            failedRows.push(id);
            Observability.incrementCounter('audit_overflow_drain_errors');
            logger.warn('audit drain row failed id=%s: %s', id, err);
        }
    }
    return {succeeded, failedRows};
}

// Ack errors are surfaced + counted; ack failure means autoclaim re-delivers
// the rows next cycle. Delivery is at-least-once: audit_log has no dedupe key,
// so a redelivered batch can write duplicate rows (forensic over-count, never
// loss) — acceptable for an append-only audit trail.
async function ackOrLog(stream: RedisStream, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
        await stream.ack(GROUP, ids);
    } catch (err) {
        Observability.incrementCounter('audit_overflow_ack_errors');
        logger.error(
            'audit_overflow ack failed count=%d: %s — entries will be redelivered via autoclaim',
            ids.length,
            formatError(err)
        );
    }
}

async function processBatch(
    stream: RedisStream,
    entries: StreamEntry[]
): Promise<void> {
    const {parsed, poisonIds} = parseEntries(entries);
    // Poison rows ack'd separately from PG successes.
    await ackOrLog(stream, poisonIds);

    if (parsed.length === 0) return;

    // Drop entries PG keeps rejecting so they don't loop via autoclaim.
    const ids = parsed.map((p) => p.id);
    let deliveryCounts: Map<string, number>;
    try {
        deliveryCounts = await stream.pendingDeliveryCounts(GROUP, ids);
    } catch (err) {
        // Fail open on XPENDING glitch — PG attempt still proceeds.
        logger.warn('audit drain pendingDeliveryCounts failed: %s', err);
        deliveryCounts = new Map();
    }
    const cap = tuning.audit.drainerPoisonDeliveries;
    const live: ParsedEntry[] = [];
    const drop: string[] = [];
    for (const entry of parsed) {
        // Redis increments delivery-count on the FIRST delivery, so cap=N
        // means "allow N deliveries total" (drop on the N+1-th).
        const deliveries = deliveryCounts.get(entry.id) ?? 0;
        if (deliveries > cap) {
            drop.push(entry.id);
            logger.error(
                'audit drain: dropping poison entry id=%s (delivered %d times > %d cap): %s',
                entry.id,
                deliveries,
                cap,
                JSON.stringify(entry.entry).slice(0, 500)
            );
        } else {
            live.push(entry);
        }
    }
    if (drop.length > 0) {
        Observability.incrementCounter(
            'audit_overflow_poison_dropped',
            drop.length
        );
        await ackOrLog(stream, drop);
    }

    if (live.length === 0) return;

    let writtenIds: string[];
    let failedIds: string[];
    try {
        await writeBatch(live);
        writtenIds = live.map((p) => p.id);
        failedIds = [];
        Observability.incrementCounter('audit_overflow_drained', live.length);
    } catch (batchErr) {
        Observability.incrementCounter('audit_overflow_per_row_fallbacks');
        logger.warn(
            'audit batch insert failed (%d rows); falling back to per-row: %s',
            live.length,
            formatError(batchErr)
        );
        const result = await writePerRow(live);
        writtenIds = result.succeeded;
        failedIds = result.failedRows;
    }

    await ackOrLog(stream, writtenIds);
    if (failedIds.length > 0) await sleep(tuning.audit.drainerRetryMs);
}

export function startAuditDrainer(): void {
    if (done) return;
    stopped = false;
    const stream = getOverflowDrainerStream();
    leadership = new Leadership({name: LEADER_NAME});
    let lastReclaimMs = 0;
    done = (async () => {
        // Await initial acquire so the first read iteration sees the lease state.
        await leadership?.start();
        await stream.ensureGroup(GROUP, '0');
        while (!stopped) {
            // Only the leader drains — other instances stand by.
            if (!leadership?.isLeader()) {
                await sleep(tuning.redis.leaderRenewMs);
                continue;
            }
            // Periodic PEL reclaim: rows whose previous owner crashed mid-ack
            // are reassigned and re-processed. Idle threshold = 2 × lease so
            // we never compete with a still-live owner.
            const nowMs = Date.now();
            if (nowMs - lastReclaimMs > tuning.redis.leaderLeaseMs) {
                lastReclaimMs = nowMs;
                try {
                    const reclaimed = await stream.autoclaim(
                        GROUP,
                        CONSUMER,
                        tuning.redis.leaderLeaseMs * 2,
                        tuning.audit.drainerBatchSize
                    );
                    if (reclaimed.length > 0) {
                        Observability.incrementCounter(
                            'audit_overflow_reclaimed'
                        );
                        await processBatch(stream, reclaimed);
                    }
                } catch (err) {
                    logger.warn('autoclaim cycle failed: %s', err);
                }
            }
            let entries: StreamEntry[];
            try {
                entries = await stream.readGroup({
                    group: GROUP,
                    consumer: CONSUMER,
                    count: tuning.audit.drainerBatchSize,
                    blockMs: tuning.audit.drainerBlockMs
                });
            } catch (err) {
                // Overflow stream expired while idle — recreate the group.
                const healed = await recoverMissingGroup(err, {
                    source: 'audit-overflow',
                    recreate: () => stream.ensureGroup(GROUP, '0')
                });
                if (healed) continue;
                logger.warn('readGroup failed: %s', err);
                await sleep(tuning.audit.drainerRetryMs);
                continue;
            }
            if (entries.length === 0) continue;
            await runDrainCycle(() => processBatch(stream, entries), {
                name: 'audit',
                logger,
                retryMs: tuning.audit.drainerRetryMs,
                cycleErrorsCounter: 'audit_overflow_cycle_errors'
            });
        }
    })();
}

export async function stopAuditDrainer(): Promise<void> {
    stopped = true;
    if (done) await bestEffort('audit-drainer.shutdown', done);
    await leadership?.stop();
    leadership = undefined;
    done = undefined;
}
