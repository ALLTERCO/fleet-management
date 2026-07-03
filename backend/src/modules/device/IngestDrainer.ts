// Drains every ingestion lane through a pluggable writer (Agent 1 supplies it).
import log4js from 'log4js';
import {tuning} from '../../config';
import * as Observability from '../Observability';
import {getInstanceId} from '../redis/instanceId';
import {recoverMissingGroup, type StreamEntry} from '../redis/RedisStream';
import {bestEffort} from '../util/fireAndForget';
import {sleep} from '../util/sleep';
import {getLane, laneCount} from './IngestStream';

const logger = log4js.getLogger('device-ingest-drainer');
const GROUP = 'device-ingest-drainer';
// Unique per process. Two FM instances sharing a Redis stream must have
// different consumer names — see Redis XREADGROUP docs.
const CONSUMER = `${getInstanceId()}-${process.pid}`;

export type IngestWriter = (
    lane: number,
    fields: Record<string, string>
) => Promise<void>;

const stopFlags = new Map<number, boolean>();
const handles = new Map<number, Promise<void>>();

// Narrow stream surface used by processBatch — lets tests inject a fake
// without constructing a full RedisStream (which needs Redis + ioredis).
export interface IngestProcessBatchStream {
    pendingDeliveryCounts(
        group: string,
        ids: string[]
    ): Promise<Map<string, number>>;
    ack(group: string, ids: string[]): Promise<void>;
}

// Pure: split entries into ones we'll feed the writer and ones whose
// pending delivery-count is over the cap (poison). Caller acks the poison
// set separately so the loop classifier stays free of side effects.
export function partitionPoisonEntries(
    entries: readonly StreamEntry[],
    deliveryCounts: ReadonlyMap<string, number>,
    cap: number
): {live: StreamEntry[]; poison: StreamEntry[]} {
    const live: StreamEntry[] = [];
    const poison: StreamEntry[] = [];
    for (const entry of entries) {
        if ((deliveryCounts.get(entry.id) ?? 0) > cap) poison.push(entry);
        else live.push(entry);
    }
    return {live, poison};
}

// Fetch the XPENDING delivery counts for the supplied ids. Fails open with
// an empty map so a Redis hiccup never blocks the normal drain.
async function fetchDeliveryCountsSafe(
    stream: IngestProcessBatchStream,
    lane: number,
    ids: string[]
): Promise<Map<string, number>> {
    try {
        return await stream.pendingDeliveryCounts(GROUP, ids);
    } catch (err) {
        Observability.incrementCounter('ingest_pending_counts_failed');
        logger.warn('lane=%d pendingDeliveryCounts failed: %s', lane, err);
        return new Map();
    }
}

// Ack the poison ids and emit the metric. Returns silently when there are
// none so the caller doesn't have to branch.
async function ackPoisonEntries(
    stream: IngestProcessBatchStream,
    lane: number,
    poison: readonly StreamEntry[],
    deliveryCounts: ReadonlyMap<string, number>,
    cap: number
): Promise<void> {
    if (poison.length === 0) return;
    for (const entry of poison) {
        logger.error(
            'device ingest lane=%d: dropping poison id=%s (delivered %d times > %d cap)',
            lane,
            entry.id,
            deliveryCounts.get(entry.id) ?? 0,
            cap
        );
    }
    Observability.incrementLabeledCounter(
        'device_ingest_poison_dropped_total',
        {lane: String(lane)},
        poison.length
    );
    await stream.ack(
        GROUP,
        poison.map((p) => p.id)
    );
}

export async function processBatch(
    stream: IngestProcessBatchStream,
    entries: StreamEntry[],
    lane: number,
    writer: IngestWriter
): Promise<void> {
    const cap = tuning.ingest.drainerPoisonDeliveries;
    const deliveryCounts = await fetchDeliveryCountsSafe(
        stream,
        lane,
        entries.map((e) => e.id)
    );
    const {live, poison} = partitionPoisonEntries(entries, deliveryCounts, cap);
    await ackPoisonEntries(stream, lane, poison, deliveryCounts, cap);

    const succeeded: string[] = [];
    let failed = 0;
    for (const entry of live) {
        try {
            await writer(lane, entry.fields);
            succeeded.push(entry.id);
            Observability.incrementLabeledCounter(
                'device_ingest_drained_total',
                {lane: String(lane)}
            );
        } catch (err) {
            failed++;
            Observability.incrementCounter('device_ingest_drain_errors');
            logger.warn('lane=%d row failed id=%s: %s', lane, entry.id, err);
        }
    }
    if (succeeded.length > 0) await stream.ack(GROUP, succeeded);
    if (failed > 0) await sleep(tuning.ingest.drainerRetryMs);
}

async function drainLane(lane: number, writer: IngestWriter): Promise<void> {
    const stream = getLane(lane);
    await stream.ensureGroup(GROUP, '0');
    let lastReclaimMs = 0;
    while (!stopFlags.get(lane)) {
        // PEL reclaim per lane.
        const nowMs = Date.now();
        if (nowMs - lastReclaimMs > tuning.redis.leaderLeaseMs) {
            lastReclaimMs = nowMs;
            try {
                const reclaimed = await stream.autoclaim(
                    GROUP,
                    CONSUMER,
                    tuning.redis.leaderLeaseMs * 2,
                    tuning.ingest.drainerBatchSize
                );
                if (reclaimed.length > 0) {
                    Observability.incrementLabeledCounter(
                        'device_ingest_reclaimed_total',
                        {lane: String(lane)}
                    );
                    await processBatch(stream, reclaimed, lane, writer);
                }
            } catch (err) {
                logger.warn('lane=%d autoclaim cycle failed: %s', lane, err);
            }
        }
        let entries: StreamEntry[];
        try {
            entries = await stream.readGroup({
                group: GROUP,
                consumer: CONSUMER,
                count: tuning.ingest.drainerBatchSize,
                blockMs: tuning.ingest.drainerBlockMs
            });
        } catch (err) {
            // Lane stream expired while idle — recreate the group.
            const healed = await recoverMissingGroup(err, {
                source: 'ingest-lane',
                recreate: () => stream.ensureGroup(GROUP, '0')
            });
            if (healed) continue;
            logger.warn('lane=%d readGroup failed: %s', lane, err);
            await sleep(tuning.ingest.drainerRetryMs);
            continue;
        }
        if (entries.length === 0) continue;
        await processBatch(stream, entries, lane, writer);
    }
}

export function startIngestDrainer(writer: IngestWriter): void {
    const total = laneCount();
    for (let lane = 0; lane < total; lane++) {
        if (handles.has(lane)) continue;
        stopFlags.set(lane, false);
        handles.set(lane, drainLane(lane, writer));
    }
}

export async function stopIngestDrainer(): Promise<void> {
    for (const lane of handles.keys()) stopFlags.set(lane, true);
    await Promise.all(
        Array.from(handles.values()).map((p) =>
            bestEffort('ingest-drainer.lane-shutdown', p)
        )
    );
    handles.clear();
    stopFlags.clear();
}
