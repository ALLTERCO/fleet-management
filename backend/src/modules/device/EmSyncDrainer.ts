// Drains the em-sync push buffer into Postgres via the shared stream-drainer
// harness. Correctness rests on the idempotent sink (a minute is stored once).

import log4js from 'log4js';
import {tuning} from '../../config';
import {runAsDbWorkload} from '../dbWorkPriority';
import * as Observability from '../Observability';
import {getInstanceId} from '../redis/instanceId';
import type {StreamEntry} from '../redis/RedisStream';
import {
    createStreamDrainer,
    type ProcessStream,
    type StreamDrainer
} from '../redis/streamDrainer';
import {addRejectedBlock} from '../repositories/EmSyncRejectedRepository';
import {
    coalesceEmSyncAtomicBatches,
    type EmSyncAtomicWriteBatch,
    emSyncRecordKeysetIds,
    splitAtomicBatchByCursor
} from './emSyncCoalescer';
import {
    getEmSyncDrainerStream,
    observeEmSyncStreamHealth,
    readEmSyncKeysets
} from './emSyncStream';

const logger = log4js.getLogger('em-sync-drainer');
const GROUP = 'em-sync-drainer';
const LEADER_NAME = 'em-sync-drainer';
const CONSUMER = `d-${getInstanceId()}`;

const BATCH_SIZE = tuning.energy.emSyncDrainerBatchSize;
const BLOCK_MS = tuning.energy.emSyncDrainerBlockMs;
const RETRY_MS = tuning.energy.emSyncDrainerRetryMs;
const MAX_ROWS_PER_CALL = tuning.energy.emSyncDrainerMaxRows;
const POISON_DELIVERIES = tuning.energy.emSyncDrainerPoisonDeliveries;
const HEALTH_INTERVAL_MS = tuning.energy.emSyncHealthIntervalMs;

export type EmSyncBatchWriter = (
    batch: EmSyncAtomicWriteBatch
) => Promise<void>;

export type EmSyncKeysetReader = typeof readEmSyncKeysets;

function sqlstateOf(error: unknown): string | null {
    const code = (error as {code?: unknown} | null)?.code;
    return typeof code === 'string' ? code : null;
}

// Every channel gap in the batch becomes one visible row before the stream
// lets the batch go. Any failure here keeps the batch pending.
async function keepRejectedBatch(
    batch: EmSyncAtomicWriteBatch,
    error: unknown
): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    for (const block of splitAtomicBatchByCursor(batch)) {
        const id = await addRejectedBlock({
            block,
            sqlstate: sqlstateOf(error),
            message
        });
        Observability.incrementCounter('em_sync_blocks_rejected');
        logger.error(
            'em-sync block rejected id=%d device=%d channel=%d rows=%d: %s',
            id,
            block.cursor.device,
            block.cursor.channel,
            block.rows.p_ts.length,
            message
        );
    }
}

async function writeMeasured(
    writer: EmSyncBatchWriter,
    batch: EmSyncAtomicWriteBatch
): Promise<void> {
    const started = Date.now();
    await writer(batch);
    const elapsedMs = Date.now() - started;
    const rows = batch.rows.p_device.length;
    Observability.incrementCounter('em_sync_buffer_rows_written', rows);
    Observability.setGauge('em_sync_last_write_rows', rows);
    Observability.setGauge('em_sync_last_write_ms', elapsedMs);
    Observability.setGauge(
        'em_sync_last_write_rows_per_sec',
        elapsedMs > 0 ? (rows * 1000) / elapsedMs : rows
    );
    Observability.setGauge(
        'em_sync_last_success_timestamp_seconds',
        Math.floor(Date.now() / 1000)
    );
    logger.debug(
        'em-sync wrote rows=%d sourceEntries=%d cursors=%d keys=%d ms=%d',
        rows,
        batch.sourceIds.length,
        batch.cursors.length,
        batch.orderingKeys.length,
        elapsedMs
    );
}

function makeDrainer(
    writer: EmSyncBatchWriter,
    readKeysets: EmSyncKeysetReader = readEmSyncKeysets
): StreamDrainer {
    return createStreamDrainer<EmSyncAtomicWriteBatch>({
        name: 'em-sync-buffer',
        group: GROUP,
        leaderName: LEADER_NAME,
        consumer: CONSUMER,
        getStream: getEmSyncDrainerStream,
        coalesce: async (entries) =>
            coalesceEmSyncAtomicBatches(
                entries,
                MAX_ROWS_PER_CALL,
                await readKeysets(emSyncRecordKeysetIds(entries))
            ),
        sourceIdsOf: (b) => b.sourceIds,
        orderingKeysOf: (b) => b.orderingKeys,
        // Energy is loss-intolerant. A rejected row must remain pending until
        // repaired; acknowledging it would let a later cursor hide the gap.
        dropFailedBatches: false,
        // Meter history writes are capped on the shared pool (FM_DB_EMSYNC_MAX_CONNECTIONS).
        quarantine: (batch, error) =>
            runAsDbWorkload('em-sync', () => keepRejectedBatch(batch, error)),
        // This stream is a one-group work queue. Reclaim capacity only after
        // the DB write and cursor update have succeeded atomically.
        deleteAcked: true,
        deletedCounter: 'em_sync_buffer_entries_deleted_total',
        writeBatch: (batch) =>
            runAsDbWorkload('em-sync', () => writeMeasured(writer, batch)),
        counters: {
            poison: 'em_sync_buffer_poison',
            poisonDropped: 'em_sync_buffer_poison_dropped',
            drained: 'em_sync_buffer_drained',
            drainErrors: 'em_sync_buffer_drain_errors',
            ackErrors: 'em_sync_buffer_ack_errors',
            reclaimed: 'em_sync_buffer_reclaimed',
            cycleErrors: 'em_sync_buffer_cycle_errors'
        },
        drainTuning: {
            batchSize: BATCH_SIZE,
            blockMs: BLOCK_MS,
            retryMs: RETRY_MS,
            poisonDeliveries: POISON_DELIVERIES
        },
        redisTuning: {
            leaderRenewMs: tuning.redis.leaderRenewMs,
            leaderLeaseMs: tuning.redis.leaderLeaseMs
        },
        logger
    });
}

let active: StreamDrainer | undefined;
let healthTimer: NodeJS.Timeout | undefined;

export function startEmSyncDrainer(writer: EmSyncBatchWriter): void {
    if (active) return;
    active = makeDrainer(writer);
    active.start();
    if (!healthTimer && HEALTH_INTERVAL_MS > 0) {
        healthTimer = setInterval(() => {
            void observeEmSyncStreamHealth(GROUP, 0);
        }, HEALTH_INTERVAL_MS);
        healthTimer.unref?.();
    }
}

export async function stopEmSyncDrainer(): Promise<void> {
    await active?.stop();
    active = undefined;
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = undefined;
}

// Test seam — drive processBatch directly with a writer.
export function processBatch(
    stream: ProcessStream,
    entries: StreamEntry[],
    writer: EmSyncBatchWriter,
    readKeysets?: EmSyncKeysetReader
): Promise<void> {
    return makeDrainer(writer, readKeysets).processBatch(stream, entries);
}
