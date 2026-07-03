import log4js from 'log4js';
import {tuning} from '../../config';
import type {ShellyDeviceExternal} from '../../types';
import {getInstanceId} from '../redis/instanceId';
import type {StreamEntry} from '../redis/RedisStream';
import {
    createStreamDrainer,
    type ProcessStream,
    type StreamDrainer
} from '../redis/streamDrainer';
import {
    DEVICE_SNAPSHOT_SCHEMA,
    getDeviceSnapshotDrainerStream
} from './SnapshotStream';

const logger = log4js.getLogger('device-snapshot-drainer');
const GROUP = 'device-snapshot-drainer';
const LEADER_NAME = 'device-snapshot-drainer';
const CONSUMER = `d-${getInstanceId()}`;

export interface DeviceSnapshotWriteRow {
    externalId: string;
    jdoc: ShellyDeviceExternal;
}

export interface CoalescedDeviceSnapshotBatch {
    rows: DeviceSnapshotWriteRow[];
    sourceIds: string[];
}

export type DeviceSnapshotBatchWriter = (
    rows: DeviceSnapshotWriteRow[]
) => Promise<void>;

export type ProcessBatchStream = ProcessStream;

function parseEntry(entry: StreamEntry): DeviceSnapshotWriteRow | null {
    if (entry.fields.schema !== DEVICE_SNAPSHOT_SCHEMA) return null;
    if (!entry.fields.externalId || !entry.fields.jdoc) return null;
    const parsed = JSON.parse(entry.fields.jdoc);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
        externalId: entry.fields.externalId,
        jdoc: parsed as ShellyDeviceExternal
    };
}

export function coalesceDeviceSnapshots(entries: StreamEntry[]): {
    batches: CoalescedDeviceSnapshotBatch[];
    poisonIds: string[];
} {
    const byExternalId = new Map<string, DeviceSnapshotWriteRow>();
    const sourceIds: string[] = [];
    const poisonIds: string[] = [];

    for (const entry of entries) {
        let row: DeviceSnapshotWriteRow | null;
        try {
            row = parseEntry(entry);
        } catch {
            row = null;
        }
        if (!row) {
            poisonIds.push(entry.id);
            continue;
        }
        byExternalId.set(row.externalId, row);
        sourceIds.push(entry.id);
    }

    if (byExternalId.size === 0) return {batches: [], poisonIds};
    const rows = [...byExternalId.values()];
    return {batches: [{rows, sourceIds}], poisonIds};
}

function makeDrainer(writer: DeviceSnapshotBatchWriter): StreamDrainer {
    return createStreamDrainer<CoalescedDeviceSnapshotBatch>({
        name: 'device-snapshot-stream',
        group: GROUP,
        leaderName: LEADER_NAME,
        consumer: CONSUMER,
        getStream: getDeviceSnapshotDrainerStream,
        coalesce: coalesceDeviceSnapshots,
        sourceIdsOf: (batch) => batch.sourceIds,
        writeBatch: (batch) => writer(batch.rows),
        counters: {
            poison: 'device_snapshot_stream_poison',
            poisonDropped: 'device_snapshot_stream_poison_dropped',
            drained: 'device_snapshot_stream_drained',
            drainErrors: 'device_snapshot_stream_drain_errors',
            ackErrors: 'device_snapshot_stream_ack_errors',
            reclaimed: 'device_snapshot_stream_reclaimed',
            cycleErrors: 'device_snapshot_stream_cycle_errors'
        },
        drainTuning: {
            batchSize: tuning.deviceSnapshot.drainerBatchSize,
            blockMs: tuning.deviceSnapshot.drainerBlockMs,
            retryMs: tuning.deviceSnapshot.drainerRetryMs,
            poisonDeliveries: tuning.deviceSnapshot.drainerPoisonDeliveries
        },
        redisTuning: {
            leaderRenewMs: tuning.redis.leaderRenewMs,
            leaderLeaseMs: tuning.redis.leaderLeaseMs
        },
        logger
    });
}

let active: StreamDrainer | undefined;

export function startDeviceSnapshotDrainer(
    writer: DeviceSnapshotBatchWriter
): void {
    if (active) return;
    active = makeDrainer(writer);
    active.start();
}

export async function stopDeviceSnapshotDrainer(): Promise<void> {
    await active?.stop();
    active = undefined;
}

export function processBatch(
    stream: ProcessBatchStream,
    entries: StreamEntry[],
    writer: DeviceSnapshotBatchWriter
): Promise<void> {
    return makeDrainer(writer).processBatch(stream, entries);
}
