// Bounded in-memory buffer for device_em.stats rows. Flushed by the
// status-pipeline timer; drained explicitly by tests and at shutdown.
//
// Raw rows are stored per whole second, so two frames in one second must
// become one row: a delta tag adds, an instantaneous tag keeps the last value.

export interface EmStatsRow {
    deviceId: number;
    tag: string;
    domain: string;
    phase: string;
    channel: number;
    ts: number;
    value: number;
    // True when value is an increase since the previous reading.
    isDelta: boolean;
}

export interface EmStatsBatch {
    p_device: number[];
    p_tag: string[];
    p_domain: string[];
    p_phase: string[];
    p_channel: number[];
    p_ts: number[];
    p_val: number[];
    p_period?: Array<number | null>;
    // Which writer produced this batch: 'live' (15s status) or 'em_sync' (the
    // 1-minute meter record). Defaults to 'live' in fn_append_stats when absent.
    p_source?: string;
}

interface QueuedRow {
    row: EmStatsRow;
    // Already held back by one timed drain; the next one writes it.
    carried: boolean;
}

function keyOf(row: EmStatsRow): string {
    return `${row.deviceId}|${row.tag}|${row.domain}|${row.phase}|${row.channel}`;
}

function secondOf(row: EmStatsRow): string {
    return `${keyOf(row)}|${row.ts}`;
}

export class EmStatsQueue {
    // Rows that may still take a same-second frame, by key and second.
    #open = new Map<string, QueuedRow>();
    // Retried rows; their combine rule is unknown, so they never merge.
    #sealed: EmStatsBatch = emptyBatch();

    enqueue(row: EmStatsRow): void {
        const second = secondOf(row);
        const queued = this.#open.get(second);
        if (!queued) {
            this.#open.set(second, {row: {...row}, carried: false});
            return;
        }
        queued.row.value = row.isDelta
            ? queued.row.value + row.value
            : row.value;
    }

    size(): number {
        return this.#sealed.p_ts.length + this.#open.size;
    }

    // Everything buffered (shutdown, identity change, tests).
    drain(): EmStatsBatch {
        const batch = this.#sealed;
        for (const queued of this.#open.values()) appendRow(batch, queued.row);
        this.#sealed = emptyBatch();
        this.#open = new Map();
        return batch;
    }

    // Holds each key's newest second back once, so a second frame stamped
    // with that second still joins it instead of becoming a second row.
    drainSettled(): EmStatsBatch {
        const newest = newestSecondByKey(this.#open.values());
        const batch = this.#sealed;
        const kept = new Map<string, QueuedRow>();
        for (const [second, queued] of this.#open) {
            if (
                !queued.carried &&
                newest.get(keyOf(queued.row)) === queued.row.ts
            ) {
                kept.set(second, {row: queued.row, carried: true});
            } else {
                appendRow(batch, queued.row);
            }
        }
        this.#sealed = emptyBatch();
        this.#open = kept;
        return batch;
    }

    // Re-queues a failed batch ahead of currently-buffered rows. Used by
    // the flush retry path so the oldest data stays oldest in PG.
    prepend(batch: EmStatsBatch): void {
        const next = this.#sealed;
        this.#sealed = {
            p_device: batch.p_device.concat(next.p_device),
            p_tag: batch.p_tag.concat(next.p_tag),
            p_domain: batch.p_domain.concat(next.p_domain),
            p_phase: batch.p_phase.concat(next.p_phase),
            p_channel: batch.p_channel.concat(next.p_channel),
            p_ts: batch.p_ts.concat(next.p_ts),
            p_val: batch.p_val.concat(next.p_val)
        };
    }
}

function newestSecondByKey(rows: Iterable<QueuedRow>): Map<string, number> {
    const newest = new Map<string, number>();
    for (const {row} of rows) {
        const key = keyOf(row);
        const seen = newest.get(key);
        if (seen === undefined || row.ts > seen) newest.set(key, row.ts);
    }
    return newest;
}

function appendRow(batch: EmStatsBatch, row: EmStatsRow): void {
    batch.p_device.push(row.deviceId);
    batch.p_tag.push(row.tag);
    batch.p_domain.push(row.domain);
    batch.p_phase.push(row.phase);
    batch.p_channel.push(row.channel);
    batch.p_ts.push(row.ts);
    batch.p_val.push(row.value);
}

function emptyBatch(): EmStatsBatch {
    return {
        p_device: [],
        p_tag: [],
        p_domain: [],
        p_phase: [],
        p_channel: [],
        p_ts: [],
        p_val: []
    };
}

// Process-wide singleton — production wiring point.
export const emStatsQueue = new EmStatsQueue();
