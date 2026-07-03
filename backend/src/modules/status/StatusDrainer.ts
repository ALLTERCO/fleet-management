// Drains the status stream into Postgres via the shared stream-drainer
// harness. The writer is injected so this module stays free of schema details.

import log4js from 'log4js';
import {tuning} from '../../config';
import {getInstanceId} from '../redis/instanceId';
import type {StreamEntry} from '../redis/RedisStream';
import {
    createStreamDrainer,
    type ProcessStream,
    type StreamDrainer
} from '../redis/streamDrainer';
import {
    type CoalescedBatch,
    coalesceStatusBatches,
    type StatusBatch
} from './batchCoalescer';
import {getStatusDrainerStream} from './StatusStream';

const logger = log4js.getLogger('status-drainer');
const GROUP = 'status-drainer';
const LEADER_NAME = 'status-drainer';
const CONSUMER = `d-${getInstanceId()}`;

export type StatusBatchWriter = (batch: StatusBatch) => Promise<void>;

// Kept for the existing tests that drive processBatch with a fake stream.
export type ProcessBatchStream = ProcessStream;

function makeDrainer(writer: StatusBatchWriter): StreamDrainer {
    return createStreamDrainer<CoalescedBatch>({
        name: 'status-stream',
        group: GROUP,
        leaderName: LEADER_NAME,
        consumer: CONSUMER,
        getStream: getStatusDrainerStream,
        coalesce: (entries) =>
            coalesceStatusBatches(entries, tuning.status.drainerMaxRowsPerCall),
        sourceIdsOf: (b) => b.sourceIds,
        writeBatch: (b) => writer(b.batch),
        counters: {
            poison: 'status_overflow_poison',
            poisonDropped: 'status_overflow_poison_dropped',
            drained: 'status_overflow_drained',
            drainErrors: 'status_overflow_drain_errors',
            ackErrors: 'status_overflow_ack_errors',
            reclaimed: 'status_overflow_reclaimed',
            cycleErrors: 'status_overflow_cycle_errors'
        },
        drainTuning: {
            batchSize: tuning.status.drainerBatchSize,
            blockMs: tuning.status.drainerBlockMs,
            retryMs: tuning.status.drainerRetryMs,
            poisonDeliveries: tuning.status.drainerPoisonDeliveries
        },
        redisTuning: {
            leaderRenewMs: tuning.redis.leaderRenewMs,
            leaderLeaseMs: tuning.redis.leaderLeaseMs
        },
        logger
    });
}

let active: StreamDrainer | undefined;

export function startStatusDrainer(writer: StatusBatchWriter): void {
    if (active) return;
    active = makeDrainer(writer);
    active.start();
}

export async function stopStatusDrainer(): Promise<void> {
    await active?.stop();
    active = undefined;
}

// Test seam — drive processBatch directly with a writer.
export function processBatch(
    stream: ProcessBatchStream,
    entries: StreamEntry[],
    writer: StatusBatchWriter
): Promise<void> {
    return makeDrainer(writer).processBatch(stream, entries);
}
