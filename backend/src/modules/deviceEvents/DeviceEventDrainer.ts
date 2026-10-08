import log4js from 'log4js';
import {tuning} from '../../config';
import {
    DEVICE_EVENT_KINDS,
    DEVICE_EVENT_SOURCES
} from '../../types/api/deviceevents';
import * as Observability from '../Observability';
import {getInstanceId} from '../redis/instanceId';
import type {StreamEntry} from '../redis/RedisStream';
import {
    createStreamDrainer,
    type ProcessStream,
    type StreamDrainer
} from '../redis/streamDrainer';
import {
    DEVICE_EVENT_STREAM_SCHEMA,
    getDeviceEventDrainerStream
} from './DeviceEventStream';
import {
    type DeviceEventBatchRow,
    type DeviceEventEntry,
    entryToBatchRow
} from './deviceEventRow';
import type {DeviceEventWriteResult} from './writeDeviceEventRow';

const logger = log4js.getLogger('device-event-drainer');
const GROUP = 'device-event-drainer';
const LEADER_NAME = 'device-event-drainer';
const CONSUMER = `d-${getInstanceId()}`;

export interface CoalescedDeviceEventBatch {
    rows: DeviceEventBatchRow[];
    sourceIds: string[];
}

export type DeviceEventBatchWriter = (
    rows: DeviceEventBatchRow[]
) => Promise<DeviceEventWriteResult>;

export type ProcessBatchStream = ProcessStream;

function parseEntry(entry: StreamEntry): DeviceEventBatchRow[] | null {
    if (entry.fields.schema !== DEVICE_EVENT_STREAM_SCHEMA) return null;
    if (!entry.fields.entries) return null;
    const parsed = JSON.parse(entry.fields.entries);
    if (!Array.isArray(parsed)) return null;
    if (parsed.length === 0) return null;
    const rows: DeviceEventBatchRow[] = [];
    for (const item of parsed) {
        if (!isDeviceEventEntry(item)) return null;
        rows.push(entryToBatchRow(item));
    }
    return rows;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(DEVICE_EVENT_KINDS);
const KNOWN_SOURCES: ReadonlySet<string> = new Set(DEVICE_EVENT_SOURCES);

function isDeviceEventEntry(value: unknown): value is DeviceEventEntry {
    if (typeof value !== 'object' || value === null) return false;
    const row = value as Partial<DeviceEventEntry>;
    return (
        typeof row.deviceId === 'number' &&
        Number.isInteger(row.deviceId) &&
        typeof row.shellyId === 'string' &&
        typeof row.component === 'string' &&
        typeof row.field === 'string' &&
        (row.ts === undefined || typeof row.ts === 'string') &&
        (row.organizationId === undefined ||
            typeof row.organizationId === 'string') &&
        typeof row.kind === 'string' &&
        KNOWN_KINDS.has(row.kind) &&
        typeof row.source === 'string' &&
        KNOWN_SOURCES.has(row.source)
    );
}

export function coalesceDeviceEvents(
    entries: StreamEntry[],
    maxRows = Number.POSITIVE_INFINITY
): {
    batches: CoalescedDeviceEventBatch[];
    poisonIds: string[];
} {
    const batches: CoalescedDeviceEventBatch[] = [];
    let rows: DeviceEventBatchRow[] = [];
    let sourceIds: string[] = [];
    const poisonIds: string[] = [];

    for (const entry of entries) {
        let parsed: DeviceEventBatchRow[] | null;
        try {
            parsed = parseEntry(entry);
        } catch {
            parsed = null;
        }
        if (!parsed) {
            poisonIds.push(entry.id);
            continue;
        }
        if (rows.length > 0 && rows.length + parsed.length > maxRows) {
            batches.push({rows, sourceIds});
            rows = [];
            sourceIds = [];
        }
        rows.push(...parsed);
        sourceIds.push(entry.id);
    }

    if (rows.length > 0) batches.push({rows, sourceIds});
    return {batches, poisonIds};
}

function makeDrainer(writer: DeviceEventBatchWriter): StreamDrainer {
    return createStreamDrainer<CoalescedDeviceEventBatch>({
        name: 'device-event-stream',
        group: GROUP,
        leaderName: LEADER_NAME,
        consumer: CONSUMER,
        getStream: getDeviceEventDrainerStream,
        coalesce: (entries) =>
            coalesceDeviceEvents(
                entries,
                tuning.deviceEvents.drainerMaxRowsPerCall
            ),
        sourceIdsOf: (batch) => batch.sourceIds,
        deleteAcked: true,
        deletedCounter: 'device_event_stream_entries_deleted_total',
        writeBatch: async (batch) => {
            const {skipped} = await writer(batch.rows);
            if (skipped === 0) return;
            // The device was deleted after these events were queued.
            Observability.incrementCounter(
                'device_event_rows_skipped_deleted_device_total',
                skipped
            );
            logger.warn(
                'device-event-stream skipped %d rows of deleted devices',
                skipped
            );
        },
        counters: {
            poison: 'device_event_stream_poison',
            poisonDropped: 'device_event_stream_poison_dropped',
            drained: 'device_event_stream_drained',
            drainErrors: 'device_event_stream_drain_errors',
            ackErrors: 'device_event_stream_ack_errors',
            reclaimed: 'device_event_stream_reclaimed',
            cycleErrors: 'device_event_stream_cycle_errors'
        },
        drainTuning: {
            batchSize: tuning.deviceEvents.drainerBatchSize,
            batchWindowMs: tuning.deviceEvents.drainerBatchWindowMs,
            blockMs: tuning.deviceEvents.drainerBlockMs,
            retryMs: tuning.deviceEvents.drainerRetryMs,
            poisonDeliveries: tuning.deviceEvents.drainerPoisonDeliveries
        },
        redisTuning: {
            leaderRenewMs: tuning.redis.leaderRenewMs,
            leaderLeaseMs: tuning.redis.leaderLeaseMs
        },
        logger
    });
}

let active: StreamDrainer | undefined;

export function startDeviceEventDrainer(writer: DeviceEventBatchWriter): void {
    if (active) return;
    active = makeDrainer(writer);
    active.start();
}

export async function stopDeviceEventDrainer(): Promise<void> {
    await active?.stop();
    active = undefined;
}

export function processBatch(
    stream: ProcessBatchStream,
    entries: StreamEntry[],
    writer: DeviceEventBatchWriter
): Promise<void> {
    return makeDrainer(writer).processBatch(stream, entries);
}
