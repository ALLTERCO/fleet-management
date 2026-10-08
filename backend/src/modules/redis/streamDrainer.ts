// Shared leader-gated Redis-stream drainer: read a consumer group, coalesce
// entries into write-batches, write, ack, drop poison, and recover a crashed
// consumer's in-flight entries via autoclaim. Each drainer supplies its stream,
// coalescer, writer, names, counters and tuning. Used by the status and em-sync
// drainers (single-stream coalesce-and-write); audit/ingest differ and keep
// their own loops.

import type log4js from 'log4js';
import * as Observability from '../Observability';
import type {CounterName} from '../observability/counters';
import {bestEffort} from '../util/fireAndForget';
import {
    isPermanentDataError,
    isTransientDatabaseError
} from '../util/postgresErrorClass';
import {sleep} from '../util/sleep';
import {ensureGroupReady} from './ensureGroupReady';
import {isLeader, startLeaderGate} from './leaderGate';
import {recoverMissingGroup, type StreamEntry} from './RedisStream';
import {runDrainCycle} from './runDrainCycle';

// Narrow surface processBatch needs — tests inject a fake.
export interface ProcessStream {
    ack(group: string, ids: string[]): Promise<void>;
    ackAndDelete?(group: string, ids: string[]): Promise<void>;
    pendingDeliveryCounts(
        group: string,
        ids: string[]
    ): Promise<Map<string, number>>;
}

export interface DrainStream extends ProcessStream {
    ensureGroup(group: string, startId?: string): Promise<void>;
    readGroup(opts: {
        group: string;
        consumer: string;
        count: number;
        blockMs: number;
    }): Promise<StreamEntry[]>;
    autoclaim(
        group: string,
        consumer: string,
        minIdleMs: number,
        count: number
    ): Promise<StreamEntry[]>;
}

export interface DrainCounters {
    poison: CounterName;
    poisonDropped: CounterName;
    drained: CounterName;
    drainErrors: CounterName;
    ackErrors: CounterName;
    reclaimed: CounterName;
    cycleErrors: CounterName;
}

export interface CoalesceOutput<B> {
    batches: B[];
    poisonIds: string[];
}

export interface StreamDrainerConfig<B> {
    name: string; // log + recoverMissingGroup source
    group: string;
    leaderName: string;
    consumer: string;
    getStream: () => DrainStream;
    /** May read what the entries refer to before it builds the batches. */
    coalesce: (
        entries: StreamEntry[]
    ) => CoalesceOutput<B> | Promise<CoalesceOutput<B>>;
    sourceIdsOf: (batch: B) => readonly string[];
    /** Preserve FIFO independently for each logical key. */
    orderingKeyOf?: (batch: B) => string;
    /** Preserve FIFO when one atomic write contains several logical keys. */
    orderingKeysOf?: (batch: B) => readonly string[];
    /** False for loss-intolerant streams: never ack a repeatedly failing row. */
    dropFailedBatches?: boolean;
    /**
     * Keeps a batch PostgreSQL will never accept somewhere durable before it
     * is acked away. When this throws, the batch stays pending.
     */
    quarantine?: (batch: B, error: unknown) => Promise<void>;
    /** Remove successful entries after ACK. Safe only for a one-group queue. */
    deleteAcked?: boolean;
    /** Optional exact count of entries removed after terminal acknowledgement. */
    deletedCounter?: CounterName;
    writeBatch: (batch: B) => Promise<void>;
    counters: DrainCounters;
    drainTuning: {
        batchSize: number;
        /** Bounded micro-batch delay after the first entry arrives. */
        batchWindowMs?: number;
        blockMs: number;
        retryMs: number;
        poisonDeliveries: number;
    };
    redisTuning: {leaderRenewMs: number; leaderLeaseMs: number};
    logger: log4js.Logger;
}

export interface StreamDrainer {
    processBatch(stream: ProcessStream, entries: StreamEntry[]): Promise<void>;
    start(): void;
    stop(): Promise<void>;
}

export function createStreamDrainer<B>(
    config: StreamDrainerConfig<B>
): StreamDrainer {
    const {name, group, leaderName, consumer, counters, logger} = config;
    const {
        batchSize,
        batchWindowMs = 0,
        blockMs,
        retryMs,
        poisonDeliveries
    } = config.drainTuning;
    let stopped = false;
    let done: Promise<void> | undefined;
    // key -> source ids of the earliest failed batch. Newer work for that key
    // stays pending until autoclaim redelivers and clears this exact prefix.
    const blockedKeys = new Map<string, Set<string>>();

    async function ackOrLog(
        stream: ProcessStream,
        ids: string[]
    ): Promise<void> {
        if (ids.length === 0) return;
        try {
            if (config.deleteAcked && stream.ackAndDelete) {
                await stream.ackAndDelete(group, ids);
                if (config.deletedCounter) {
                    Observability.incrementCounter(
                        config.deletedCounter,
                        ids.length
                    );
                }
            } else {
                await stream.ack(group, ids);
            }
        } catch (err) {
            Observability.incrementCounter(counters.ackErrors);
            logger.error(
                '%s ack failed count=%d: %s — entries redeliver via autoclaim',
                name,
                ids.length,
                err
            );
        }
    }

    // An outage fails every delivery, so only other failures count to the cap.
    async function deliveredPastCap(
        stream: ProcessStream,
        ids: string[],
        err: unknown
    ): Promise<boolean> {
        if (config.dropFailedBatches === false) return false;
        if (isTransientDatabaseError(err)) return false;
        let counts: Map<string, number>;
        try {
            counts = await stream.pendingDeliveryCounts(group, ids);
        } catch (countErr) {
            logger.warn(
                '%s pendingDeliveryCounts failed, keeping batch pending: %s',
                name,
                countErr
            );
            return false;
        }
        return ids.some((id) => (counts.get(id) ?? 0) > poisonDeliveries);
    }

    // The dead letter store must hold the batch before the stream lets go
    // of it. A failed save keeps the batch pending, as a transient error does.
    async function keepQuarantined(batch: B, err: unknown): Promise<boolean> {
        if (!config.quarantine) return true;
        try {
            await config.quarantine(batch, err);
            return true;
        } catch (saveErr) {
            logger.error(
                '%s could not save rejected batch, keeping it pending: %s',
                name,
                saveErr
            );
            return false;
        }
    }

    // A batch that left the stream no longer holds back newer entries.
    function releaseBlockers(
        blockers: ReadonlyArray<readonly [string, Set<string>]>,
        ids: readonly string[]
    ): void {
        for (const [key, blocker] of blockers) {
            for (const id of ids) blocker.delete(id);
            if (blocker.size === 0) blockedKeys.delete(key);
        }
    }

    async function processBatch(
        stream: ProcessStream,
        entries: StreamEntry[]
    ): Promise<void> {
        const {batches, poisonIds} = await config.coalesce(entries);
        if (poisonIds.length > 0) {
            Observability.incrementCounter(counters.poison, poisonIds.length);
            for (const id of poisonIds) {
                logger.error('%s poison id=%s (unparseable entry)', name, id);
            }
            await ackOrLog(stream, poisonIds);
        }
        if (batches.length === 0) return;

        const succeeded = new Set<string>();
        const dropped = new Set<string>();
        const failed = new Set<string>();
        const failedOrderingKeys = new Set<string>();
        for (const b of batches) {
            const ids = [...config.sourceIdsOf(b)];
            const orderingKeys = config.orderingKeysOf
                ? [...new Set(config.orderingKeysOf(b))]
                : config.orderingKeyOf
                  ? [config.orderingKeyOf(b)]
                  : [];
            // A failure earlier in this same delivery cycle is an immediate
            // barrier, including when one source entry was split into several
            // DB batches that all share the same Redis source id.
            if (orderingKeys.some((key) => failedOrderingKeys.has(key))) {
                for (const id of ids) failed.add(id);
                continue;
            }
            const blockers = orderingKeys
                .map((key) => [key, blockedKeys.get(key)] as const)
                .filter((item): item is readonly [string, Set<string>] =>
                    Boolean(item[1])
                );
            // Only the batch containing the failed prefix may retry this key.
            // Newer delivered entries remain unacked and are reclaimed later.
            if (
                blockers.some(([, blocker]) =>
                    ids.every((id) => !blocker.has(id))
                )
            ) {
                for (const id of ids) failed.add(id);
                continue;
            }
            try {
                await config.writeBatch(b);
                for (const id of ids) succeeded.add(id);
                releaseBlockers(blockers, ids);
            } catch (err) {
                Observability.incrementCounter(
                    counters.drainErrors,
                    ids.length
                );
                // A value PostgreSQL rejects outright never becomes acceptable,
                // so retaining it is not caution: it blocks its ordering key and
                // every later entry for that key, permanently. Quarantine it and
                // let the rest of the key drain. Retryable failures still hold.
                if (
                    isPermanentDataError(err) &&
                    (await keepQuarantined(b, err))
                ) {
                    logger.error(
                        '%s quarantining batch PostgreSQL will never accept ids=%s: %s',
                        name,
                        ids.join(','),
                        err
                    );
                    Observability.incrementCounter(
                        counters.poisonDropped,
                        ids.length
                    );
                    for (const id of ids) succeeded.add(id);
                    releaseBlockers(blockers, ids);
                    continue;
                }
                if (
                    (await deliveredPastCap(stream, ids, err)) &&
                    (await keepQuarantined(b, err))
                ) {
                    logger.error(
                        '%s dropping batch that failed past %d deliveries ids=%s: %s',
                        name,
                        poisonDeliveries,
                        ids.join(','),
                        err
                    );
                    Observability.incrementCounter(
                        counters.poisonDropped,
                        ids.length
                    );
                    for (const id of ids) dropped.add(id);
                    releaseBlockers(blockers, ids);
                    continue;
                }
                for (const id of ids) failed.add(id);
                for (const key of orderingKeys) {
                    failedOrderingKeys.add(key);
                    const existing = blockedKeys.get(key);
                    if (existing) {
                        for (const id of ids) existing.add(id);
                    } else {
                        blockedKeys.set(key, new Set(ids));
                    }
                }
                logger.warn('%s drain batch failed: %s', name, err);
            }
        }
        for (const id of failed) {
            succeeded.delete(id);
            dropped.delete(id);
        }
        for (const id of dropped) succeeded.delete(id);
        if (succeeded.size > 0) {
            Observability.incrementCounter(counters.drained, succeeded.size);
        }
        await ackOrLog(stream, [...succeeded, ...dropped]);
        if (failed.size > 0) await sleep(retryMs);
    }

    function start(): void {
        if (done) return;
        stopped = false;
        void startLeaderGate(leaderName);
        const stream = config.getStream();
        let lastReclaimMs = 0;
        done = (async () => {
            await ensureGroupReady({
                source: name,
                retryMs,
                isStopped: () => stopped,
                ensure: () => stream.ensureGroup(group, '0')
            });
            while (!stopped) {
                if (!isLeader(leaderName)) {
                    await sleep(config.redisTuning.leaderRenewMs);
                    continue;
                }
                const nowMs = Date.now();
                if (nowMs - lastReclaimMs > config.redisTuning.leaderLeaseMs) {
                    lastReclaimMs = nowMs;
                    try {
                        const reclaimed = await stream.autoclaim(
                            group,
                            consumer,
                            config.redisTuning.leaderLeaseMs * 2,
                            batchSize
                        );
                        if (reclaimed.length > 0) {
                            Observability.incrementCounter(counters.reclaimed);
                            await processBatch(stream, reclaimed);
                        }
                    } catch (err) {
                        const healed = await recoverMissingGroup(err, {
                            source: name,
                            recreate: () => stream.ensureGroup(group, '0')
                        });
                        if (healed) continue;
                        logger.warn('%s autoclaim cycle failed: %s', name, err);
                    }
                }
                let entries: StreamEntry[];
                try {
                    entries = await stream.readGroup({
                        group,
                        consumer,
                        count: batchSize,
                        blockMs
                    });
                } catch (err) {
                    const healed = await recoverMissingGroup(err, {
                        source: name,
                        recreate: () => stream.ensureGroup(group, '0')
                    });
                    if (healed) continue;
                    logger.warn('%s readGroup failed: %s', name, err);
                    await sleep(retryMs);
                    continue;
                }
                if (entries.length === 0) continue;
                if (batchWindowMs > 0 && entries.length < batchSize) {
                    await sleep(batchWindowMs);
                    const remaining = batchSize - entries.length;
                    if (remaining > 0) {
                        const more = await stream.readGroup({
                            group,
                            consumer,
                            count: remaining,
                            // Entries already had a bounded wait above. This
                            // read only drains what accumulated in that window.
                            blockMs: 1
                        });
                        entries.push(...more);
                    }
                }
                await runDrainCycle(() => processBatch(stream, entries), {
                    name,
                    logger,
                    retryMs,
                    cycleErrorsCounter: counters.cycleErrors
                });
            }
        })();
    }

    async function stop(): Promise<void> {
        stopped = true;
        if (done) await bestEffort(`${name}-drainer.shutdown`, done);
        done = undefined;
    }

    return {processBatch, start, stop};
}
