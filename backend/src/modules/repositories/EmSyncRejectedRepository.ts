// Dead letter store for meter blocks PostgreSQL will never accept. Each row
// is one (device, channel) gap with the reason and the raw block, so it can
// be queued again on purpose. Wraps device_em.fn_sync_rejected_*.

import type {EmSyncBlock, EmSyncRows} from '../device/emSyncCoalescer';
import {
    callMethod,
    type DbResult,
    extractScalarNumber
} from '../PostgresProvider';

export interface EmSyncRejectedRow {
    id: number;
    device: number;
    channel: number;
    cursorCreated: number;
    rowCount: number;
    firstTs: number | null;
    lastTs: number | null;
    sqlstate: string | null;
    message: string;
    rejectedAt: string;
    requeuedAt: string | null;
    requeuedBy: string | null;
}

export interface EmSyncRejectedTaken {
    id: number;
    block: EmSyncBlock;
}

function toNumber(value: unknown): number {
    return typeof value === 'number' ? value : Number(value);
}

function toNullableNumber(value: unknown): number | null {
    return value === null || value === undefined ? null : toNumber(value);
}

function toIso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value);
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
    return (result as DbResult)?.rows ?? [];
}

export async function addRejectedBlock(input: {
    block: EmSyncBlock;
    sqlstate: string | null;
    message: string;
}): Promise<number> {
    const ts = input.block.rows.p_ts;
    const result = await callMethod('device_em.fn_sync_rejected_add', {
        p_device: input.block.cursor.device,
        p_channel: input.block.cursor.channel,
        p_cursor_created: input.block.cursor.created,
        p_row_count: ts.length,
        p_first_ts: ts.length > 0 ? Math.min(...ts) : null,
        p_last_ts: ts.length > 0 ? Math.max(...ts) : null,
        p_sqlstate: input.sqlstate,
        p_message: input.message,
        p_block: JSON.stringify(input.block)
    });
    return extractScalarNumber(result);
}

export async function listRejectedBlocks(input: {
    devices: readonly number[];
    openOnly: boolean;
    limit: number;
}): Promise<EmSyncRejectedRow[]> {
    if (input.devices.length === 0) return [];
    const result = await callMethod('device_em.fn_sync_rejected_list', {
        p_devices: [...input.devices],
        p_open_only: input.openOnly,
        p_limit: input.limit
    });
    return rowsOf(result).map((row) => ({
        id: toNumber(row.id),
        device: toNumber(row.device),
        channel: toNumber(row.channel),
        cursorCreated: toNumber(row.cursor_created),
        rowCount: toNumber(row.row_count),
        firstTs: toNullableNumber(row.first_ts),
        lastTs: toNullableNumber(row.last_ts),
        sqlstate: row.sqlstate === null ? null : String(row.sqlstate),
        message: String(row.message),
        rejectedAt: toIso(row.rejected_at),
        requeuedAt: row.requeued_at === null ? null : toIso(row.requeued_at),
        requeuedBy: row.requeued_by === null ? null : String(row.requeued_by)
    }));
}

export async function countOpenRejectedBlocks(
    devices: readonly number[]
): Promise<number> {
    if (devices.length === 0) return 0;
    const result = await callMethod('device_em.fn_sync_rejected_open_count', {
        p_devices: [...devices]
    });
    return extractScalarNumber(result);
}

export async function countOpenRejectedBlocksAll(): Promise<number> {
    const result = await callMethod(
        'device_em.fn_sync_rejected_open_count_all',
        {}
    );
    return extractScalarNumber(result);
}

function parseBlock(raw: unknown): EmSyncBlock {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const block = value as {rows?: EmSyncRows; cursor?: EmSyncBlock['cursor']};
    if (!block?.rows || !block.cursor) {
        throw new Error('stored em-sync block is not a block');
    }
    return {rows: block.rows, cursor: block.cursor};
}

export async function getOpenRejectedBlock(input: {
    id: number;
    devices: readonly number[];
}): Promise<EmSyncRejectedTaken | null> {
    if (input.devices.length === 0) return null;
    const result = await callMethod('device_em.fn_sync_rejected_get', {
        p_id: input.id,
        p_devices: [...input.devices]
    });
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {id: toNumber(row.id), block: parseBlock(row.block)};
}

export async function takeRejectedBlock(input: {
    id: number;
    devices: readonly number[];
    by: string;
}): Promise<EmSyncRejectedTaken | null> {
    if (input.devices.length === 0) return null;
    const result = await callMethod('device_em.fn_sync_rejected_take', {
        p_id: input.id,
        p_devices: [...input.devices],
        p_by: input.by
    });
    const row = rowsOf(result)[0];
    if (!row) return null;
    return {id: toNumber(row.id), block: parseBlock(row.block)};
}
