// Shared leader-gated Redis-stream drainer: read a consumer group, coalesce
// entries into write-batches, drop poison, write, ack, and recover a crashed
// consumer's in-flight entries via autoclaim. Each drainer supplies its stream,
// coalescer, writer, names, counters and tuning. Used by the status and em-sync
// drainers (single-stream coalesce-and-write); audit/ingest differ and keep
// their own loops.

import type log4js from 'log4js';
import * as Observability from '../Observability';
import {bestEffort} from '../util/fireAndForget';
import {sleep} from '../util/sleep';
import {isLeader, startLeaderGate} from './leaderGate';
import {recoverMissingGroup, type StreamEntry} from './RedisStream';
import {runDrainCycle} from './runDrainCycle';

// Narrow surface processBatch needs — tests inject a fake.
export interface ProcessStream {
    ack(group: string, ids: string[]): Promise<void>;
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
    poison: string;
    poisonDropped: string;
    drained: string;
    drainErrors: string;
    ackErrors: string;
    reclaimed: string;
    cycleErrors: string;
}

export interface StreamDrainerConfig<B> {
    name: string; // log + recoverMissingGroup source
    group: string;
    leaderName: string;
    consumer: string;
    getStream: () => DrainStream;
    coalesce: (entries: StreamEntry[]) => {batches: B[]; poisonIds: string[]};
    sourceIdsOf: (batch: B) => readonly string[];
    writeBatch: (batch: B) => Promise<void>;
    counters: DrainCounters;
    drainTuning: {
        batchSize: number;
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
    const {batchSize, blockMs, retryMs, poisonDeliveries} = config.drainTuning;
    let stopped = false;
    let done: Promise<void> | undefined;

    async function ackOrLog(
        stream: ProcessStream,
        ids: string[]
    ): Promise<void> {
        if (ids.length === 0) return;
        try {
            await stream.ack(group, ids);
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

    // Batches whose entries have been delivered past the cap keep failing; drop
    // them so they don't loop forever via autoclaim.
    async function dropPoisonBatches(
        stream: ProcessStream,
        batches: B[]
    ): Promise<B[]> {
        const allIds = batches.flatMap((b) => [...config.sourceIdsOf(b)]);
        let counts: Map<string, number>;
        try {
            counts = await stream.pendingDeliveryCounts(group, allIds);
        } catch (err) {
            logger.warn('%s pendingDeliveryCounts failed: %s', name, err);
            counts = new Map();
        }
        const live: B[] = [];
        const dropped: string[] = [];
        for (const b of batches) {
            const ids = [...config.sourceIdsOf(b)];
            if (ids.some((id) => (counts.get(id) ?? 0) > poisonDeliveries)) {
                for (const id of ids) {
                    dropped.push(id);
                    logger.error(
                        '%s: dropping poison batch id=%s (delivered %d > %d)',
                        name,
                        id,
                        counts.get(id) ?? 0,
                        poisonDeliveries
                    );
                }
            } else {
                live.push(b);
            }
        }
        if (dropped.length > 0) {
            Observability.incrementCounter(
                counters.poisonDropped,
                dropped.length
            );
            await ackOrLog(stream, dropped);
        }
        return live;
    }

    async function processBatch(
        stream: ProcessStream,
        entries: StreamEntry[]
    ): Promise<void> {
        const {batches, poisonIds} = config.coalesce(entries);
        if (poisonIds.length > 0) {
            Observability.incrementCounter(counters.poison, poisonIds.length);
            for (const id of poisonIds) {
                logger.error('%s poison id=%s (unparseable entry)', name, id);
            }
            await ackOrLog(stream, poisonIds);
        }
        if (batches.length === 0) return;

        const live = await dropPoisonBatches(stream, batches);

        const succeeded = new Set<string>();
        const failed = new Set<string>();
        for (const b of live) {
            const ids = [...config.sourceIdsOf(b)];
            try {
                await config.writeBatch(b);
                for (const id of ids) succeeded.add(id);
            } catch (err) {
                for (const id of ids) failed.add(id);
                Observability.incrementCounter(
                    counters.drainErrors,
                    ids.length
                );
                logger.warn('%s drain batch failed: %s', name, err);
            }
        }
        for (const id of failed) succeeded.delete(id);
        if (succeeded.size > 0) {
            Observability.incrementCounter(counters.drained, succeeded.size);
            await ackOrLog(stream, [...succeeded]);
        }
        if (failed.size > 0) await sleep(retryMs);
    }

    function start(): void {
        if (done) return;
        stopped = false;
        void startLeaderGate(leaderName);
        const stream = config.getStream();
        let lastReclaimMs = 0;
        done = (async () => {
            await stream.ensureGroup(group, '0');
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
