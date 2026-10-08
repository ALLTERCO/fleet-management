// Durable overflow for live em_stats rows. When the in-memory flusher is
// over its budget while PostgreSQL fails, batches go to this Redis stream
// and a drainer writes them once PostgreSQL is back. Same shape as the
// audit overflow: spill, then drain through the shared stream drainer.

import log4js from 'log4js';
import {tuning} from '../config';
import {runAsDbWorkload} from './dbWorkPriority';
import type {EmStatsBatch} from './emStatsQueue';
import {appendEmStats} from './energyRollup';
import * as Observability from './Observability';
import {callMethod} from './PostgresProvider';
import {getInstanceId} from './redis/instanceId';
import type {RedisStream, StreamEntry} from './redis/RedisStream';
import {blockingStream, commandStream} from './redis/streamClients';
import {
    createStreamDrainer,
    type ProcessStream,
    type StreamDrainer
} from './redis/streamDrainer';

const logger = log4js.getLogger('em-stats-overflow');
const GROUP = 'em-stats-overflow-drainer';
const LEADER_NAME = 'em-stats-overflow-drainer';
const CONSUMER = `em-stats-overflow-${getInstanceId()}`;

let stream: RedisStream | undefined;
let drainerStream: RedisStream | undefined;
let active: StreamDrainer | undefined;

function getStream(): RedisStream {
    if (!stream) {
        stream = commandStream(
            'em-sync',
            tuning.energy.emStatsOverflowStreamKey
        );
    }
    return stream;
}

function getDrainerStream(): RedisStream {
    if (!drainerStream) {
        drainerStream = blockingStream(
            'em-sync',
            tuning.energy.emStatsOverflowStreamKey
        );
    }
    return drainerStream;
}

function sliceBatch(
    batch: EmStatsBatch,
    from: number,
    to: number
): EmStatsBatch {
    return {
        p_device: batch.p_device.slice(from, to),
        p_tag: batch.p_tag.slice(from, to),
        p_domain: batch.p_domain.slice(from, to),
        p_phase: batch.p_phase.slice(from, to),
        p_channel: batch.p_channel.slice(from, to),
        p_ts: batch.p_ts.slice(from, to),
        p_val: batch.p_val.slice(from, to),
        ...(batch.p_period ? {p_period: batch.p_period.slice(from, to)} : {}),
        ...(batch.p_source ? {p_source: batch.p_source} : {})
    };
}

// One stream entry per DB-sized chunk, so a drained entry is one write.
export function chunkEmStatsBatch(
    batch: EmStatsBatch,
    maxRows = tuning.energy.emSyncDrainerMaxRows
): EmStatsBatch[] {
    const chunks: EmStatsBatch[] = [];
    for (let start = 0; start < batch.p_ts.length; start += maxRows) {
        chunks.push(sliceBatch(batch, start, start + maxRows));
    }
    return chunks;
}

// Throws when any chunk is refused, so the flusher keeps the batch in memory.
export async function spillEmStatsBatch(batch: EmStatsBatch): Promise<void> {
    const cap = tuning.energy.emStatsOverflowMaxlen;
    for (const chunk of chunkEmStatsBatch(batch)) {
        const id = await getStream().appendIfBelowCap(
            {batch: JSON.stringify(chunk)},
            {cap, ttlMs: 0, rateLabel: 'em-stats-overflow'}
        );
        if (id === null) {
            Observability.incrementCounter('em_stats_overflow_spill_errors');
            throw new Error(`em_stats overflow stream at capacity (${cap})`);
        }
        Observability.incrementCounter('em_stats_overflow_spilled');
    }
    logger.warn(
        'moved %d live energy rows to the overflow stream',
        batch.p_ts.length
    );
}

function isEmStatsBatch(value: unknown): value is EmStatsBatch {
    const b = value as Partial<EmStatsBatch> | null;
    return (
        typeof b === 'object' &&
        b !== null &&
        Array.isArray(b.p_device) &&
        Array.isArray(b.p_ts) &&
        Array.isArray(b.p_val) &&
        b.p_device.length === b.p_ts.length
    );
}

function coalesce(entries: StreamEntry[]): {
    batches: Array<EmStatsBatch & {sourceId: string}>;
    poisonIds: string[];
} {
    const batches: Array<EmStatsBatch & {sourceId: string}> = [];
    const poisonIds: string[] = [];
    for (const entry of entries) {
        try {
            const parsed: unknown = JSON.parse(entry.fields.batch ?? '');
            if (!isEmStatsBatch(parsed)) throw new Error('not a batch');
            batches.push({...parsed, sourceId: entry.id});
        } catch {
            poisonIds.push(entry.id);
        }
    }
    return {batches, poisonIds};
}

export type EmStatsOverflowWriter = (batch: EmStatsBatch) => Promise<void>;

function defaultWriter(batch: EmStatsBatch): Promise<void> {
    return runAsDbWorkload('energy', () =>
        appendEmStats(batch, {callDb: callMethod})
    );
}

function makeDrainer(writer: EmStatsOverflowWriter): StreamDrainer {
    return createStreamDrainer<EmStatsBatch & {sourceId: string}>({
        name: 'em-stats-overflow',
        group: GROUP,
        leaderName: LEADER_NAME,
        consumer: CONSUMER,
        getStream: getDrainerStream,
        coalesce,
        sourceIdsOf: (b) => [b.sourceId],
        // Live rows are loss-intolerant while PostgreSQL is merely down.
        dropFailedBatches: false,
        deleteAcked: true,
        deletedCounter: 'em_stats_overflow_entries_deleted_total',
        writeBatch: ({sourceId: _sourceId, ...batch}) => writer(batch),
        counters: {
            poison: 'em_stats_overflow_poison',
            poisonDropped: 'em_stats_overflow_poison_dropped',
            drained: 'em_stats_overflow_drained',
            drainErrors: 'em_stats_overflow_drain_errors',
            ackErrors: 'em_stats_overflow_ack_errors',
            reclaimed: 'em_stats_overflow_reclaimed',
            cycleErrors: 'em_stats_overflow_cycle_errors'
        },
        drainTuning: {
            batchSize: tuning.energy.emSyncDrainerBatchSize,
            blockMs: tuning.energy.emSyncDrainerBlockMs,
            retryMs: tuning.energy.emSyncDrainerRetryMs,
            poisonDeliveries: tuning.energy.emSyncDrainerPoisonDeliveries
        },
        redisTuning: {
            leaderRenewMs: tuning.redis.leaderRenewMs,
            leaderLeaseMs: tuning.redis.leaderLeaseMs
        },
        logger
    });
}

export function processOverflowBatch(
    target: ProcessStream,
    entries: StreamEntry[],
    writer: EmStatsOverflowWriter = defaultWriter
): Promise<void> {
    return makeDrainer(writer).processBatch(target, entries);
}

export function startEmStatsOverflowDrainer(): void {
    if (active) return;
    active = makeDrainer(defaultWriter);
    active.start();
}

export async function stopEmStatsOverflowDrainer(): Promise<void> {
    await active?.stop();
    active = undefined;
}

export function resetEmStatsOverflowForTests(): void {
    stream = undefined;
    drainerStream = undefined;
}
