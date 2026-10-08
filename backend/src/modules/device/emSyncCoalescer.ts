// Coalesces buffered entries into drainer write-batches: merge only within the
// same (device, channel), advance to the latest cursor, split at maxRows. Each
// split keeps its own cursor so a failed later write can't skip the bookmark.
// Pushed records arrive one per entry in the device format and expand here;
// a block of rows is a requeued rejected block or an entry from before that.

import type {EmStatsBatch} from '../emStatsQueue';
import type {StreamEntry} from '../redis/RedisStream';
import {
    buildEmStatsBatch,
    EmSyncPeriodError,
    measurementFields,
    parseEmSyncPeriod
} from './emRecordRows';
import {
    decodeEmSyncRecordEntry,
    type EmSyncRecord,
    emSyncRecordKeyset,
    isEmSyncRecordEntry
} from './emSyncRecordEntry';

export type EmSyncKeysets = ReadonlyMap<string, readonly string[]>;

const NO_KEYSETS: EmSyncKeysets = new Map();

export interface EmSyncRows extends EmStatsBatch {
    p_source: string;
}

// A range inside a pull where the device answered with no usable record.
export interface EmSyncGap {
    from: number;
    to: number;
}

export interface EmSyncCursor {
    device: number;
    channel: number;
    created: number;
    // Pull only: ranges between the requested ts and `created` with no record.
    gaps?: EmSyncGap[];
    // A pushed record claims no range, so it never moves the bookmark itself.
    origin?: 'push';
}

export interface EmSyncBlock {
    rows: EmSyncRows;
    cursor: EmSyncCursor;
}

export interface EmSyncWriteBatch {
    rows: EmSyncRows;
    cursor: EmSyncCursor;
    sourceIds: string[];
}

export interface EmSyncAtomicWriteBatch {
    rows: EmSyncRows;
    cursors: EmSyncCursor[];
    orderingKeys: string[];
    sourceIds: string[];
}

export interface CoalesceResult {
    batches: EmSyncWriteBatch[];
    poisonIds: string[];
}

const ROW_KEYS: ReadonlyArray<keyof EmSyncRows> = [
    'p_device',
    'p_tag',
    'p_domain',
    'p_phase',
    'p_channel',
    'p_ts',
    'p_val'
];

export function coalesceEmSyncBatches(
    entries: ReadonlyArray<StreamEntry>,
    maxRows: number,
    keysets: EmSyncKeysets = NO_KEYSETS
): CoalesceResult {
    const poisonIds: string[] = [];
    // Preserve arrival order per (device, channel) so cursors stay monotonic.
    const groups = new Map<string, EmSyncWriteBatch[]>();
    const order: string[] = [];

    for (const entry of entries) {
        const block = parseEntry(entry, keysets);
        if (block === null) {
            poisonIds.push(entry.id);
            continue;
        }
        const key = `${block.cursor.device}:${block.cursor.channel}`;
        let chain = groups.get(key);
        if (!chain) {
            chain = [];
            groups.set(key, chain);
            order.push(key);
        }
        addBlock(chain, block, entry.id, maxRows);
    }

    return {
        batches: order.flatMap((key) => groups.get(key) ?? []),
        poisonIds
    };
}

export function coalesceEmSyncAtomicBatches(
    entries: ReadonlyArray<StreamEntry>,
    maxRows: number,
    keysets: EmSyncKeysets = NO_KEYSETS
): {batches: EmSyncAtomicWriteBatch[]; poisonIds: string[]} {
    const batches: EmSyncAtomicWriteBatch[] = [];
    const poisonIds: string[] = [];
    let current: EmSyncAtomicWriteBatch | undefined;

    for (const entry of entries) {
        const block = parseEntry(entry, keysets);
        if (!block) {
            poisonIds.push(entry.id);
            continue;
        }
        for (const piece of splitEmSyncBlock(block, maxRows)) {
            const rows = piece.rows.p_device.length;
            if (
                current &&
                maxRows > 0 &&
                current.rows.p_device.length > 0 &&
                current.rows.p_device.length + rows > maxRows
            ) {
                batches.push(current);
                current = undefined;
            }
            current ??= {
                rows: emptyRows(piece.rows.p_source),
                cursors: [],
                orderingKeys: [],
                sourceIds: []
            };
            appendRows(current.rows, piece.rows);
            current.cursors.push(piece.cursor);
            current.orderingKeys.push(
                `${piece.cursor.device}:${piece.cursor.channel}`
            );
            current.sourceIds.push(entry.id);
        }
    }
    if (current) batches.push(current);
    for (const batch of batches) {
        batch.orderingKeys = [...new Set(batch.orderingKeys)];
    }
    return {batches, poisonIds};
}

function emptyRows(source: string): EmSyncRows {
    return {
        p_device: [],
        p_tag: [],
        p_domain: [],
        p_phase: [],
        p_channel: [],
        p_ts: [],
        p_val: [],
        p_source: source
    };
}

function addBlock(
    chain: EmSyncWriteBatch[],
    block: EmSyncBlock,
    sourceId: string,
    maxRows: number
): void {
    const pieces = splitEmSyncBlock(block, maxRows);
    for (const piece of pieces) addBlockPiece(chain, piece, sourceId, maxRows);
}

function addBlockPiece(
    chain: EmSyncWriteBatch[],
    block: EmSyncBlock,
    sourceId: string,
    maxRows: number
): void {
    const rowCount = block.rows.p_device.length;
    const tail = chain[chain.length - 1];
    if (tail && tail.rows.p_device.length + rowCount <= maxRows) {
        appendRows(tail.rows, block.rows);
        tail.cursor = block.cursor; // arrival order is monotonic
        tail.sourceIds.push(sourceId);
        return;
    }
    chain.push({
        rows: cloneRows(block.rows),
        cursor: block.cursor,
        sourceIds: [sourceId]
    });
}

// Pieces of at most maxRows rows, cut only between records: a record's rows
// share one ts, so one record is never split across two writes.
export function splitEmSyncBlock(
    block: EmSyncBlock,
    maxRows: number
): EmSyncBlock[] {
    const rowCount = block.rows.p_device.length;
    if (maxRows <= 0 || rowCount <= maxRows) return [block];

    const out: EmSyncBlock[] = [];
    let start = 0;
    while (start < rowCount) {
        let end = Math.min(start + maxRows, rowCount);
        const boundaryTs = block.rows.p_ts[end - 1];
        while (end < rowCount && block.rows.p_ts[end] === boundaryTs) end++;
        out.push(sliceBlock(block, start, end, end >= rowCount));
        start = end;
    }
    return out;
}

function sliceBlock(
    block: EmSyncBlock,
    start: number,
    end: number,
    isFinal: boolean
): EmSyncBlock {
    const rows = {
        p_device: block.rows.p_device.slice(start, end),
        p_tag: block.rows.p_tag.slice(start, end),
        p_domain: block.rows.p_domain.slice(start, end),
        p_phase: block.rows.p_phase.slice(start, end),
        p_channel: block.rows.p_channel.slice(start, end),
        p_ts: block.rows.p_ts.slice(start, end),
        p_val: block.rows.p_val.slice(start, end),
        ...(block.rows.p_period
            ? {p_period: block.rows.p_period.slice(start, end)}
            : {}),
        p_source: block.rows.p_source
    };
    const lastTs = rows.p_ts[rows.p_ts.length - 1] ?? block.cursor.created;
    if (isFinal) return {rows, cursor: block.cursor};
    return {rows, cursor: pieceCursor(block.cursor, lastTs)};
}

// An earlier piece claims up to its last record, so it carries only the gaps
// inside that claim; the final piece carries all of them.
function pieceCursor(cursor: EmSyncCursor, created: number): EmSyncCursor {
    const piece: EmSyncCursor = {...cursor, created};
    if (cursor.gaps) {
        piece.gaps = cursor.gaps.filter((gap) => gap.to <= created);
    }
    return piece;
}

// Key lists the record entries refer to, each once.
export function emSyncRecordKeysetIds(
    entries: ReadonlyArray<StreamEntry>
): string[] {
    const ids = new Set<string>();
    for (const entry of entries) {
        const id = emSyncRecordKeyset(entry.fields);
        if (id && isEmSyncRecordEntry(entry.fields)) ids.add(id);
    }
    return [...ids];
}

function parseEntry(
    entry: StreamEntry,
    keysets: EmSyncKeysets
): EmSyncBlock | null {
    if (!isEmSyncRecordEntry(entry.fields)) return parseBlock(entry);
    const record = decodeEmSyncRecordEntry(entry.fields);
    const keys = record ? keysets.get(record.keyset) : undefined;
    return record && keys ? expandRecord(record, keys) : null;
}

// A pushed record claims no range: its cursor never moves the bookmark itself.
function expandRecord(
    record: EmSyncRecord,
    keys: readonly string[]
): EmSyncBlock {
    const rows = buildEmStatsBatch({
        fields: measurementFields(record.phases),
        payload: {
            keys: [...keys],
            data: [
                {
                    ts: record.ts,
                    period: record.period,
                    values: [record.values as number[]]
                }
            ]
        },
        device: record.device,
        channel: record.channel
    });
    return {
        rows,
        cursor: {
            device: record.device,
            channel: record.channel,
            created: record.ts + record.period,
            origin: 'push'
        }
    };
}

function parseBlock(entry: StreamEntry): EmSyncBlock | null {
    const raw = entry.fields.block;
    if (typeof raw !== 'string') return null;
    let obj: unknown;
    try {
        obj = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isEmSyncBlock(obj)) return null;
    if (obj.rows.p_period !== undefined) {
        if (
            !Array.isArray(obj.rows.p_period) ||
            obj.rows.p_period.length !== obj.rows.p_ts.length
        ) {
            throw new EmSyncPeriodError();
        }
        obj.rows.p_period = obj.rows.p_period.map((period) =>
            period === null ? null : parseEmSyncPeriod(period)
        );
    }
    return obj;
}

// One block per cursor, so a rejected batch is stored as per-channel gaps.
export function splitAtomicBatchByCursor(
    batch: EmSyncAtomicWriteBatch
): EmSyncBlock[] {
    return batch.cursors.map((cursor) => {
        const rows = emptyRows(batch.rows.p_source);
        for (let i = 0; i < batch.rows.p_ts.length; i++) {
            if (
                batch.rows.p_device[i] !== cursor.device ||
                batch.rows.p_channel[i] !== cursor.channel
            ) {
                continue;
            }
            for (const key of ROW_KEYS) {
                (rows[key] as unknown[]).push(
                    (batch.rows[key] as unknown[])[i]
                );
            }
            if (batch.rows.p_period) {
                rows.p_period ??= [];
                rows.p_period.push(batch.rows.p_period[i] ?? null);
            }
        }
        return {rows, cursor};
    });
}

function cloneRows(rows: EmSyncRows): EmSyncRows {
    return {
        p_device: [...rows.p_device],
        p_tag: [...rows.p_tag],
        p_domain: [...rows.p_domain],
        p_phase: [...rows.p_phase],
        p_channel: [...rows.p_channel],
        p_ts: [...rows.p_ts],
        p_val: [...rows.p_val],
        ...(rows.p_period ? {p_period: [...rows.p_period]} : {}),
        p_source: rows.p_source
    };
}

function appendRows(into: EmSyncRows, from: EmSyncRows): void {
    if (into.p_period || from.p_period) {
        into.p_period ??= Array<number | null>(into.p_ts.length).fill(null);
        for (let i = 0; i < from.p_ts.length; i++) {
            into.p_period.push(from.p_period?.[i] ?? null);
        }
    }
    for (const key of ROW_KEYS) {
        const target = into[key] as unknown[];
        for (const v of from[key] as unknown[]) target.push(v);
    }
}

function isEmSyncBlock(value: unknown): value is EmSyncBlock {
    if (typeof value !== 'object' || value === null) return false;
    const b = value as Partial<EmSyncBlock>;
    const rows = b.rows;
    const cursor = b.cursor;
    if (!rows || !cursor) return false;
    const len = rows.p_device?.length;
    if (typeof len !== 'number') return false;
    for (const key of ROW_KEYS) {
        const arr = rows[key];
        if (!Array.isArray(arr) || arr.length !== len) return false;
    }
    return (
        typeof cursor.device === 'number' &&
        typeof cursor.channel === 'number' &&
        typeof cursor.created === 'number' &&
        (cursor.gaps === undefined || areValidGaps(cursor.gaps)) &&
        (cursor.origin === undefined || cursor.origin === 'push')
    );
}

function areValidGaps(gaps: unknown): boolean {
    return (
        Array.isArray(gaps) &&
        gaps.every(
            (gap: Partial<EmSyncGap> | null) =>
                Number.isSafeInteger(gap?.from) &&
                Number.isSafeInteger(gap?.to) &&
                (gap?.to as number) > (gap?.from as number)
        )
    );
}
