// Single write point for raw EM stats + the 15-minute rollup.
//
// Raw `device_em.stats` is the source of truth and is now idempotent:
// fn_append_stats skips a reading already stored (ON CONFLICT DO NOTHING) and
// RETURNS the rows it actually inserted. We feed ONLY those new rows to the
// rollup, so a re-delivered reading (at-least-once, or a live + emSync overlap)
// is counted neither in raw nor in the rollup.
//
// A rollup failure must never block or fail the raw write — it is isolated and
// surfaced as a metric + error log, not silently swallowed. This runs inside
// the existing async flush (live: 2-minute batch; emSync: per channel), so it
// is already off the per-message path.
//
// `callDb` is injected by the caller (which already holds PostgresProvider's
// callMethod) so this module does not import PostgresProvider — that would
// close the load-time cycle PostgresProvider → … → ShellyEmHandler.

import {getLogger} from 'log4js';
import {envInt} from '../config/envReader';
import type {EmStatsBatch} from './emStatsQueue';
import * as Observability from './Observability';
import {StageTimer} from './util/stageTimer';

const logger = getLogger('energyRollup');

// A write slower than this logs a one-line stage breakdown (raw vs rollup) so
// the slow part of the em-stats write is visible. Off the hot path already.
const WRITE_SLOW_MS = envInt('FM_EMDATA_WRITE_SLOW_MS', 2000);

// One slow-write log shared by both write paths: shows which stage cost the
// time (raw insert vs 15-min rollup) and how many rows the batch carried.
function logSlowWrite(
    source: string,
    rowCount: number,
    inserted: number,
    timer: StageTimer
): void {
    const total = timer.totalMs();
    Observability.setGauge('em_stats_write_last_ms', total);
    if (total < WRITE_SLOW_MS) return;
    logger.warn(
        'slow em-stats write source=%s rows=%d inserted=%d total=%dms %s',
        source,
        rowCount,
        inserted,
        total,
        timer.format()
    );
}

export type CallDb = (method: string, params: unknown) => Promise<unknown>;

/** callDb is required; the metric/log effects default to production sinks. */
export interface EmStatsAppendDeps {
    callDb: CallDb;
    incrementCounter?: (name: string) => void;
    logError?: (message: string) => void;
}

/** One raw row that fn_append_stats actually inserted (i.e. was not a dup). */
interface InsertedRow {
    device: number;
    tag: string;
    domain: string;
    phase: string;
    channel: number;
    ts: number;
    val: number;
}

function toRollupBatch(rows: readonly InsertedRow[]): EmStatsBatch {
    return {
        p_device: rows.map((r) => r.device),
        p_tag: rows.map((r) => r.tag),
        p_domain: rows.map((r) => r.domain),
        p_phase: rows.map((r) => r.phase),
        p_channel: rows.map((r) => r.channel),
        p_ts: rows.map((r) => r.ts),
        p_val: rows.map((r) => r.val)
    };
}

// Roll up only the newly-inserted rows. A rollup failure is isolated: counter +
// error log, the already-written raw stays.
async function rollUpInserted(
    inserted: readonly InsertedRow[],
    deps: EmStatsAppendDeps
): Promise<void> {
    if (inserted.length === 0) return; // nothing new to roll up
    try {
        await deps.callDb(
            'device_em.fn_append_energy_15min',
            toRollupBatch(inserted)
        );
    } catch (err) {
        const incrementCounter =
            deps.incrementCounter ??
            ((name) => Observability.incrementCounter(name));
        const logError = deps.logError ?? ((message) => logger.error(message));
        incrementCounter('energy_rollup_append_failed');
        logError(
            `energy_15min rollup append failed (raw written, rollup skipped): ${
                err instanceof Error ? err.message : String(err)
            }`
        );
    }
}

// Append a raw EM batch idempotently, then roll up the new rows. A raw failure
// propagates (the caller's flush retries it).
export async function appendEmStats(
    batch: EmStatsBatch,
    deps: EmStatsAppendDeps
): Promise<void> {
    const timer = new StageTimer();
    const result = (await deps.callDb('device_em.fn_append_stats', batch)) as
        | {rows?: InsertedRow[]}
        | null
        | undefined;
    timer.mark('raw');
    const inserted = result?.rows ?? [];
    await rollUpInserted(inserted, deps);
    timer.mark('rollup');
    logSlowWrite('live', batch.p_device.length, inserted.length, timer);
}

export interface EmSyncCursor {
    device: number;
    created: number;
    channel: number;
}

// em-sync variant: write the raw batch and advance the sync bookmark in one
// atomic statement (fn_append_stats_synced), so a crash can't leave the cursor
// out of step with the data. Then roll up the new rows.
export async function appendEmStatsSynced(
    batch: EmStatsBatch,
    cursor: EmSyncCursor,
    deps: EmStatsAppendDeps
): Promise<void> {
    const timer = new StageTimer();
    const result = (await deps.callDb('device_em.fn_append_stats_synced', {
        ...batch,
        p_sync_device: cursor.device,
        p_sync_created: cursor.created,
        p_sync_channel: cursor.channel
    })) as {rows?: InsertedRow[]} | null | undefined;
    timer.mark('raw');
    const inserted = result?.rows ?? [];
    await rollUpInserted(inserted, deps);
    timer.mark('rollup');
    logSlowWrite('em_sync', batch.p_device.length, inserted.length, timer);
}
