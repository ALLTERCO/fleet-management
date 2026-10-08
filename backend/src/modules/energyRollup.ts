// Durable EM ingest. SQL commits raw rows, bookmarks, and rollup work
// together. The rollup worker owns the derived 15-minute projection.

import {getLogger} from 'log4js';
import {envInt} from '../config/envReader';
import {tuning} from '../config/tuning';
import type {EmSyncCursor} from './device/emSyncCoalescer';
import type {EmStatsBatch} from './emStatsQueue';
import * as Observability from './Observability';

const logger = getLogger('energyRollup');
const WRITE_SLOW_MS = envInt('FM_EMDATA_WRITE_SLOW_MS', 2_000);

export type CallDb = (method: string, params: unknown) => Promise<unknown>;

/** When record writes make their 15-minute buckets due for the rollup. */
export interface EmRollupTiming {
    closeGraceMs: number;
    lateDebounceMs: number;
}

export interface EmStatsAppendDeps {
    callDb: CallDb;
    /** Defaults to the tuned FM_EM_ROLLUP_* values. */
    rollupTiming?: EmRollupTiming;
}

function rollupTiming(deps: EmStatsAppendDeps): EmRollupTiming {
    return (
        deps.rollupTiming ?? {
            closeGraceMs: tuning.energy.rollupCloseGraceMs,
            lateDebounceMs: tuning.energy.rollupLateDebounceMs
        }
    );
}

function recordWrite(source: string, rows: number, started: number): void {
    const elapsedMs = performance.now() - started;
    Observability.setGauge('em_stats_write_last_ms', elapsedMs);
    Observability.setGauge('em_raw_ingest_batch_size', rows);
    Observability.setGauge(
        'em_raw_ingest_rows_per_second',
        elapsedMs > 0 ? (rows * 1_000) / elapsedMs : rows
    );
    if (elapsedMs < WRITE_SLOW_MS) return;
    Observability.incrementCounter('em_stats_write_slow');
    logger.warn(
        'slow em raw write source=%s rows=%d ms=%d',
        source,
        rows,
        Math.round(elapsedMs)
    );
}

export async function appendEmStats(
    batch: EmStatsBatch,
    deps: EmStatsAppendDeps
): Promise<void> {
    const started = performance.now();
    await deps.callDb('device_em.fn_append_stats_dirty_count', batch);
    recordWrite('live', batch.p_device.length, started);
}

function pick<T>(column: readonly T[], rows: readonly number[]): T[] {
    return rows.map((row) => column[row]);
}

function partOf(batch: EmStatsBatch, rows: readonly number[]): EmStatsBatch {
    return {
        p_device: pick(batch.p_device, rows),
        p_tag: pick(batch.p_tag, rows),
        p_domain: pick(batch.p_domain, rows),
        p_phase: pick(batch.p_phase, rows),
        p_channel: pick(batch.p_channel, rows),
        p_ts: pick(batch.p_ts, rows),
        p_val: pick(batch.p_val, rows),
        ...(batch.p_period ? {p_period: pick(batch.p_period, rows)} : {}),
        ...(batch.p_source ? {p_source: batch.p_source} : {})
    };
}

// Whole devices per part, in ascending device order: a key never spans two
// writes, so in-batch dedup and dirty-key locking order stay as in one call.
// A device with more rows than the limit gets a part of its own.
export function splitEmStatsBatch(
    batch: EmStatsBatch,
    maxRows: number
): EmStatsBatch[] {
    if (batch.p_ts.length <= maxRows) return [batch];
    const rowsByDevice = new Map<number, number[]>();
    batch.p_device.forEach((device, row) => {
        const rows = rowsByDevice.get(device);
        if (rows) rows.push(row);
        else rowsByDevice.set(device, [row]);
    });
    const devices = [...rowsByDevice.keys()].sort((a, b) => a - b);
    const parts: EmStatsBatch[] = [];
    let current: number[] = [];
    for (const device of devices) {
        const rows = rowsByDevice.get(device) ?? [];
        if (current.length > 0 && current.length + rows.length > maxRows) {
            parts.push(partOf(batch, current));
            current = [];
        }
        current.push(...rows);
    }
    if (current.length > 0) parts.push(partOf(batch, current));
    return parts;
}

// Device gaps of every cursor; the bookmark moves only through stored records
// and these gaps, never to a cursor's own claim.
function deviceGapColumns(cursors: readonly EmSyncCursor[]) {
    const gaps = cursors.flatMap((cursor) =>
        (cursor.gaps ?? []).map((gap) => ({...gap, cursor}))
    );
    return {
        p_gap_device: gaps.map((gap) => gap.cursor.device),
        p_gap_channel: gaps.map((gap) => gap.cursor.channel),
        p_gap_from: gaps.map((gap) => gap.from),
        p_gap_to: gaps.map((gap) => gap.to)
    };
}

export async function appendEmStatsSyncedBatch(
    batch: EmStatsBatch,
    cursors: readonly EmSyncCursor[],
    deps: EmStatsAppendDeps
): Promise<void> {
    if (cursors.length === 0) return;
    const started = performance.now();
    const claims = cursors.filter((cursor) => cursor.origin !== 'push');
    const timing = rollupTiming(deps);
    await deps.callDb('device_em.fn_append_stats_synced_batch_v5', {
        ...batch,
        p_period: batch.p_period ?? null,
        p_sync_device: claims.map((cursor) => cursor.device),
        p_sync_created: claims.map((cursor) => cursor.created),
        p_sync_channel: claims.map((cursor) => cursor.channel),
        ...deviceGapColumns(cursors),
        p_close_grace_ms: timing.closeGraceMs,
        p_late_debounce_ms: timing.lateDebounceMs
    });
    recordWrite('em_sync', batch.p_device.length, started);
}

export function appendEmStatsSynced(
    batch: EmStatsBatch,
    cursor: EmSyncCursor,
    deps: EmStatsAppendDeps
): Promise<void> {
    return appendEmStatsSyncedBatch(batch, [cursor], deps);
}
