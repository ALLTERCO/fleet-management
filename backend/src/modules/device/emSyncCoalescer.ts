// Coalesces buffered blocks into drainer write-batches: merge only within the
// same (device, channel), advance to the latest cursor, split at maxRows. Each
// split keeps its own cursor so a failed later write can't skip the bookmark.

import type {StreamEntry} from '../redis/RedisStream';

export interface EmSyncRows {
    p_device: number[];
    p_tag: string[];
    p_domain: string[];
    p_phase: string[];
    p_channel: number[];
    p_ts: number[];
    p_val: number[];
    p_source: string;
}

export interface EmSyncCursor {
    device: number;
    channel: number;
    created: number;
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
    maxRows: number
): CoalesceResult {
    const poisonIds: string[] = [];
    // Preserve arrival order per (device, channel) so cursors stay monotonic.
    const groups = new Map<string, EmSyncWriteBatch[]>();
    const order: string[] = [];

    for (const entry of entries) {
        const block = parseBlock(entry);
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

function addBlock(
    chain: EmSyncWriteBatch[],
    block: EmSyncBlock,
    sourceId: string,
    maxRows: number
): void {
    const pieces = splitBlock(block, maxRows);
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

function splitBlock(block: EmSyncBlock, maxRows: number): EmSyncBlock[] {
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
        p_source: block.rows.p_source
    };
    const lastTs = rows.p_ts[rows.p_ts.length - 1] ?? block.cursor.created;
    return {
        rows,
        cursor: {
            ...block.cursor,
            created: isFinal ? block.cursor.created : lastTs
        }
    };
}

function parseBlock(entry: StreamEntry): EmSyncBlock | null {
    const raw = entry.fields.block;
    if (typeof raw !== 'string') return null;
    try {
        const obj = JSON.parse(raw);
        return isEmSyncBlock(obj) ? obj : null;
    } catch {
        return null;
    }
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
        p_source: rows.p_source
    };
}

function appendRows(into: EmSyncRows, from: EmSyncRows): void {
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
        typeof cursor.created === 'number'
    );
}
