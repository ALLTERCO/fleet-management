// Drains the em-sync buffer into Postgres via the shared stream-drainer harness.
// Correctness rests on the idempotent sink (append-only raw + recompute-dedup).

import log4js from 'log4js';
import {tuning} from '../../config';
import * as Observability from '../Observability';
import {getInstanceId} from '../redis/instanceId';
import type {StreamEntry} from '../redis/RedisStream';
import {
    createStreamDrainer,
    type ProcessStream,
    type StreamDrainer
} from '../redis/streamDrainer';
import {coalesceEmSyncBatches, type EmSyncWriteBatch} from './emSyncCoalescer';
import {
    getEmSyncDrainerStream,
    observeEmSyncStreamHealth
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

export type EmSyncBatchWriter = (batch: EmSyncWriteBatch) => Promise<void>;

async function writeMeasured(
    writer: EmSyncBatchWriter,
    batch: EmSyncWriteBatch
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
    logger.debug(
        'em-sync wrote rows=%d sourceEntries=%d device=%d channel=%d cursor=%d ms=%d',
        rows,
        batch.sourceIds.length,
        batch.cursor.device,
        batch.cursor.channel,
        batch.cursor.created,
        elapsedMs
    );
}

function makeDrainer(writer: EmSyncBatchWriter): StreamDrainer {
    return createStreamDrainer<EmSyncWriteBatch>({
        name: 'em-sync-buffer',
        group: GROUP,
        leaderName: LEADER_NAME,
        consumer: CONSUMER,
        getStream: getEmSyncDrainerStream,
        coalesce: (entries) =>
            coalesceEmSyncBatches(entries, MAX_ROWS_PER_CALL),
        sourceIdsOf: (b) => b.sourceIds,
        writeBatch: (batch) => writeMeasured(writer, batch),
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
    writer: EmSyncBatchWriter
): Promise<void> {
    return makeDrainer(writer).processBatch(stream, entries);
}
