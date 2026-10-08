import log4js from 'log4js';
import {tuning} from '../../config';
import * as Observability from '../Observability';
import {isLeader, startLeaderGate} from '../redis/leaderGate';
import type {StreamEntry} from '../redis/RedisStream';
import type {EventRow, NumericRow} from '../sensorCapture';
import {bestEffort} from '../util/fireAndForget';
import {isPermanentDataError} from '../util/postgresErrorClass';
import {sleep} from '../util/sleep';
import {
    getSensorCaptureDrainerStream,
    SENSOR_CAPTURE_STREAM_SCHEMA,
    SENSOR_CAPTURE_STREAM_SCHEMA_V2,
    type SensorCaptureBatch
} from './SensorCaptureStream';

const logger = log4js.getLogger('sensor-capture-drainer');
const LEADER_NAME = 'sensor-capture-drainer';

export interface CoalescedSensorCaptureBatch extends SensorCaptureBatch {
    sourceIds: string[];
    batchIds: string[];
    numericBatchIds: string[];
    eventBatchIds: string[];
}

export interface SensorCaptureCommitBatch extends SensorCaptureBatch {
    batchIds: string[];
    numericBatchIds: string[];
    eventBatchIds: string[];
}

export type SensorCaptureBatchWriter = (
    batch: SensorCaptureCommitBatch
) => Promise<SensorCaptureWriteResult>;

export interface SensorCaptureWriteResult {
    committedBatches: number;
    committedRows: number;
}

export interface ProcessBatchStream {
    deleteEntries(ids: readonly string[]): Promise<number>;
}

interface DrainStream extends ProcessBatchStream {
    rangeFromStart(count: number): Promise<StreamEntry[]>;
    length(): Promise<number>;
}

function isNumericRow(value: unknown): value is NumericRow {
    if (!value || typeof value !== 'object') return false;
    const row = value as Partial<NumericRow>;
    return (
        Number.isInteger(row.device) &&
        typeof row.source === 'string' &&
        typeof row.kind === 'string' &&
        (row.channel === null || Number.isInteger(row.channel)) &&
        typeof row.ts === 'number' &&
        Number.isFinite(row.ts) &&
        typeof row.val === 'number' &&
        Number.isFinite(row.val)
    );
}

function isEventRow(value: unknown): value is EventRow {
    if (!value || typeof value !== 'object') return false;
    const row = value as Partial<EventRow>;
    return (
        Number.isInteger(row.device) &&
        typeof row.source === 'string' &&
        typeof row.kind === 'string' &&
        (row.channel === null || Number.isInteger(row.channel)) &&
        typeof row.ts === 'number' &&
        Number.isFinite(row.ts) &&
        Number.isInteger(row.state)
    );
}

function parseRows<T>(
    value: string | undefined,
    valid: (row: unknown) => row is T
): T[] | null {
    if (value === undefined) return null;
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every(valid)) return null;
    return parsed;
}

function parseEntry(
    entry: StreamEntry
): {batchId: string; numeric: NumericRow[]; events: EventRow[]} | null {
    const schema = entry.fields.schema;
    if (
        schema !== SENSOR_CAPTURE_STREAM_SCHEMA &&
        schema !== SENSOR_CAPTURE_STREAM_SCHEMA_V2
    ) {
        return null;
    }
    const batchId =
        schema === SENSOR_CAPTURE_STREAM_SCHEMA_V2
            ? entry.fields.batchId
            : `legacy:${entry.id}`;
    if (!batchId || batchId.length > 100) return null;
    const numeric = parseRows(entry.fields.numeric, isNumericRow);
    const events = parseRows(entry.fields.events, isEventRow);
    if (!numeric || !events || (numeric.length === 0 && events.length === 0)) {
        return null;
    }
    return {batchId, numeric, events};
}

interface ParsedSensorEntry {
    sourceId: string;
    batchId: string;
    numeric: NumericRow[];
    events: EventRow[];
}

function parseSensorCaptureEntries(entries: StreamEntry[]): {
    parsed: ParsedSensorEntry[];
    poisonIds: string[];
} {
    const parsed: ParsedSensorEntry[] = [];
    const poisonIds: string[] = [];
    for (const entry of entries) {
        let row: ReturnType<typeof parseEntry>;
        try {
            row = parseEntry(entry);
        } catch {
            row = null;
        }
        if (!row) {
            poisonIds.push(entry.id);
            continue;
        }
        parsed.push({sourceId: entry.id, ...row});
    }
    return {parsed, poisonIds};
}

function toCoalescedBatch(
    parsed: readonly ParsedSensorEntry[]
): CoalescedSensorCaptureBatch {
    const batch: CoalescedSensorCaptureBatch = {
        numeric: [],
        events: [],
        sourceIds: [],
        batchIds: [],
        numericBatchIds: [],
        eventBatchIds: []
    };
    for (const entry of parsed) {
        batch.numeric.push(...entry.numeric);
        batch.events.push(...entry.events);
        batch.sourceIds.push(entry.sourceId);
        batch.batchIds.push(entry.batchId);
        batch.numericBatchIds.push(...entry.numeric.map(() => entry.batchId));
        batch.eventBatchIds.push(...entry.events.map(() => entry.batchId));
    }
    return batch;
}

export function coalesceSensorCapture(entries: StreamEntry[]): {
    batches: CoalescedSensorCaptureBatch[];
    poisonIds: string[];
} {
    const {parsed, poisonIds} = parseSensorCaptureEntries(entries);
    const batch = toCoalescedBatch(parsed);
    return {
        batches: batch.sourceIds.length > 0 ? [batch] : [],
        poisonIds
    };
}

async function commitEntries(
    stream: ProcessBatchStream,
    parsed: readonly ParsedSensorEntry[],
    writer: SensorCaptureBatchWriter
): Promise<void> {
    const batch = toCoalescedBatch(parsed);
    const startedAt = Date.now();
    const committed = await writer({
        numeric: batch.numeric,
        events: batch.events,
        batchIds: batch.batchIds,
        numericBatchIds: batch.numericBatchIds,
        eventBatchIds: batch.eventBatchIds
    });
    Observability.incrementCounter(
        'sensor_capture_drain_duration_ms_total',
        Date.now() - startedAt
    );
    if (committed.committedBatches > 0) {
        Observability.incrementCounter(
            'sensor_capture_rows_committed_total',
            committed.committedRows
        );
        Observability.incrementCounter(
            'sensor_capture_batches_committed_total',
            committed.committedBatches
        );
    }
    const replayed = batch.batchIds.length - committed.committedBatches;
    if (replayed > 0) {
        Observability.incrementCounter(
            'sensor_capture_batches_replayed_total',
            replayed
        );
    }
    const deleted = await stream.deleteEntries(batch.sourceIds);
    Observability.incrementCounter(
        'sensor_capture_stream_entries_deleted_total',
        deleted
    );
    Observability.incrementCounter(
        'sensor_capture_stream_drained',
        batch.sourceIds.length
    );
}

// Returns the failure instead of throwing, so the caller can choose between
// retrying, splitting and quarantining without nesting error handling inside
// that decision.
async function attemptCommit(
    stream: ProcessBatchStream,
    parsed: readonly ParsedSensorEntry[],
    writer: SensorCaptureBatchWriter
): Promise<unknown> {
    try {
        await commitEntries(stream, parsed, writer);
        return null;
    } catch (error) {
        return error;
    }
}

async function quarantineEntry(
    stream: ProcessBatchStream,
    entry: ParsedSensorEntry,
    error: unknown
): Promise<void> {
    Observability.incrementCounter('sensor_capture_stream_quarantined');
    logger.error(
        'sensor-capture entry %s (batch %s) rejected by PostgreSQL and dropped; ' +
            '%d numeric and %d event rows lost: %s',
        entry.sourceId,
        entry.batchId,
        entry.numeric.length,
        entry.events.length,
        error
    );
    await stream.deleteEntries([entry.sourceId]);
}

// One PostgreSQL call carries every pending entry, so a single row the database
// refuses aborts all of them. Splitting the run isolates the offender; an entry
// that still fails alone can never be committed, and leaving it at the head of
// the stream stops sensor history for every device behind it.
async function commitOrQuarantine(
    stream: ProcessBatchStream,
    parsed: readonly ParsedSensorEntry[],
    writer: SensorCaptureBatchWriter
): Promise<void> {
    if (parsed.length === 0) return;
    const failure = await attemptCommit(stream, parsed, writer);
    if (!failure) return;
    if (!isPermanentDataError(failure)) throw failure;
    if (parsed.length === 1) {
        await quarantineEntry(stream, parsed[0], failure);
        return;
    }
    const mid = Math.floor(parsed.length / 2);
    await commitOrQuarantine(stream, parsed.slice(0, mid), writer);
    await commitOrQuarantine(stream, parsed.slice(mid), writer);
}

export async function processBatch(
    stream: ProcessBatchStream,
    entries: StreamEntry[],
    writer: SensorCaptureBatchWriter
): Promise<void> {
    const {parsed, poisonIds} = parseSensorCaptureEntries(entries);
    // Reads always start at the stream head, so a never-parseable entry would be
    // retried forever with every device's history stuck behind it.
    if (poisonIds.length > 0) {
        Observability.incrementCounter(
            'sensor_capture_stream_poison',
            poisonIds.length
        );
        logger.error(
            'sensor-capture dropping %d malformed entries; they cannot be parsed and would block every device behind them: %s',
            poisonIds.length,
            poisonIds.join(',')
        );
        await stream.deleteEntries(poisonIds);
    }
    await commitOrQuarantine(stream, parsed, writer);
}

let stopped = true;
let done: Promise<void> | undefined;

export function startSensorCaptureDrainer(
    writer: SensorCaptureBatchWriter
): void {
    if (done) return;
    stopped = false;
    void startLeaderGate(LEADER_NAME);
    const stream = getSensorCaptureDrainerStream() as DrainStream;
    done = (async () => {
        while (!stopped) {
            if (!isLeader(LEADER_NAME)) {
                await sleep(tuning.redis.leaderRenewMs);
                continue;
            }
            try {
                const entries = await stream.rangeFromStart(
                    tuning.sensorCapture.drainerBatchSize
                );
                if (entries.length === 0) {
                    await sleep(tuning.sensorCapture.drainerBlockMs);
                    continue;
                }
                await processBatch(stream, entries, writer);
                Observability.setLabeledGauge(
                    'stream_length',
                    {stream: 'sensor-capture'},
                    await stream.length()
                );
            } catch (error) {
                Observability.incrementCounter(
                    'sensor_capture_stream_drain_errors'
                );
                logger.warn(
                    'sensor-capture drain failed; oldest entries retained: %s',
                    error
                );
                await sleep(tuning.sensorCapture.drainerRetryMs);
            }
        }
    })();
}

export async function stopSensorCaptureDrainer(): Promise<void> {
    stopped = true;
    if (done) await bestEffort('sensor-capture-drainer.shutdown', done);
    done = undefined;
}
