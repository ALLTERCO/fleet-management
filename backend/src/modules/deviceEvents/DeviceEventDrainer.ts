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
    DEVICE_EVENT_STREAM_SCHEMA,
    getDeviceEventDrainerStream
} from './DeviceEventStream';
import {
    type DeviceEventBatchRow,
    type DeviceEventEntry,
    entryToBatchRow
} from './deviceEventRow';

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
) => Promise<void>;

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
        (row.kind === 'state_change' ||
            row.kind === 'event' ||
            row.kind === 'config') &&
        (row.source === 'device' ||
            row.source === 'command' ||
            row.source === 'unknown')
    );
}

export function coalesceDeviceEvents(entries: StreamEntry[]): {
    batches: CoalescedDeviceEventBatch[];
    poisonIds: string[];
} {
    const rows: DeviceEventBatchRow[] = [];
    const sourceIds: string[] = [];
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
        rows.push(...parsed);
        sourceIds.push(entry.id);
    }

    if (rows.length === 0) return {batches: [], poisonIds};
    return {batches: [{rows, sourceIds}], poisonIds};
}

function makeDrainer(writer: DeviceEventBatchWriter): StreamDrainer {
    return createStreamDrainer<CoalescedDeviceEventBatch>({
        name: 'device-event-stream',
        group: GROUP,
        leaderName: LEADER_NAME,
        consumer: CONSUMER,
        getStream: getDeviceEventDrainerStream,
        coalesce: coalesceDeviceEvents,
        sourceIdsOf: (batch) => batch.sourceIds,
        writeBatch: (batch) => writer(batch.rows),
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
