// Concatenates multiple status_push_queue payloads into a single PG batch.

import type {StreamEntry} from '../redis/RedisStream';
import {toEpochSeconds} from '../util/epochSeconds';

export interface StatusBatch {
    p_ts: number[];
    p_id: number[];
    p_field: string[];
    p_field_group: string[];
    p_value: number[];
    p_prev_value: number[];
}

export interface CoalescedBatch {
    batch: StatusBatch;
    sourceIds: string[];
}

export interface CoalesceResult {
    batches: CoalescedBatch[];
    poisonIds: string[];
}

export function statusBatchTimestampToIso(seconds: number): string | null {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

const COLUMN_KEYS: ReadonlyArray<keyof StatusBatch> = [
    'p_ts',
    'p_id',
    'p_field',
    'p_field_group',
    'p_value',
    'p_prev_value'
];

export function coalesceStatusBatches(
    entries: ReadonlyArray<StreamEntry>,
    maxRows: number
): CoalesceResult {
    if (entries.length === 0) return {batches: [], poisonIds: []};
    const batches: CoalescedBatch[] = [];
    const poisonIds: string[] = [];
    let current = emptyBatch();
    let currentIds: string[] = [];
    for (const entry of entries) {
        const parsed = parseEntryBatch(entry);
        if (parsed === null) {
            poisonIds.push(entry.id);
            continue;
        }
        if (current.p_ts.length + parsed.p_ts.length > maxRows) {
            if (current.p_ts.length > 0) {
                batches.push({batch: current, sourceIds: currentIds});
                current = emptyBatch();
                currentIds = [];
            }
        }
        appendBatch(current, parsed);
        currentIds.push(entry.id);
    }
    if (current.p_ts.length > 0) {
        batches.push({batch: current, sourceIds: currentIds});
    }
    return {batches, poisonIds};
}

function emptyBatch(): StatusBatch {
    return {
        p_ts: [],
        p_id: [],
        p_field: [],
        p_field_group: [],
        p_value: [],
        p_prev_value: []
    };
}

function parseEntryBatch(entry: StreamEntry): StatusBatch | null {
    const raw = entry.fields.batch;
    if (typeof raw !== 'string') return null;
    try {
        const obj = JSON.parse(raw);
        if (!isStatusBatch(obj)) return null;
        return {
            ...obj,
            p_ts: obj.p_ts.map((seconds) => toEpochSeconds(seconds, 0))
        };
    } catch {
        return null;
    }
}

function appendBatch(into: StatusBatch, from: StatusBatch): void {
    for (const key of COLUMN_KEYS) {
        const target = into[key] as unknown as unknown[];
        const source = from[key] as unknown as unknown[];
        for (const v of source) target.push(v);
    }
}

function isStatusBatch(value: unknown): value is StatusBatch {
    if (typeof value !== 'object' || value === null) return false;
    const b = value as Partial<StatusBatch>;
    const timestamps = b.p_ts;
    if (!Array.isArray(timestamps)) return false;
    const len = timestamps.length;
    for (const key of COLUMN_KEYS) {
        const arr = b[key];
        if (!Array.isArray(arr) || arr.length !== len) return false;
    }
    return timestamps.every(
        (seconds) => typeof seconds === 'number' && Number.isFinite(seconds)
    );
}
