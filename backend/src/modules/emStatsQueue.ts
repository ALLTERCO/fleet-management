// Bounded in-memory buffer for device_em.stats rows. Flushed by the
// status-pipeline timer; drained explicitly by tests.

export interface EmStatsRow {
    deviceId: number;
    tag: string;
    domain: string;
    phase: string;
    channel: number;
    ts: number;
    value: number;
}

export interface EmStatsBatch {
    p_device: number[];
    p_tag: string[];
    p_domain: string[];
    p_phase: string[];
    p_channel: number[];
    p_ts: number[];
    p_val: number[];
    // Which writer produced this batch: 'live' (15s status) or 'em_sync' (the
    // 1-minute meter record). Defaults to 'live' in fn_append_stats when absent.
    p_source?: string;
}

export class EmStatsQueue {
    #batch: EmStatsBatch = emptyBatch();

    enqueue(row: EmStatsRow): void {
        this.#batch.p_device.push(row.deviceId);
        this.#batch.p_tag.push(row.tag);
        this.#batch.p_domain.push(row.domain);
        this.#batch.p_phase.push(row.phase);
        this.#batch.p_channel.push(row.channel);
        this.#batch.p_ts.push(row.ts);
        this.#batch.p_val.push(row.value);
    }

    size(): number {
        return this.#batch.p_ts.length;
    }

    drain(): EmStatsBatch {
        const snapshot = this.#batch;
        this.#batch = emptyBatch();
        return snapshot;
    }

    // Re-queues a failed batch ahead of currently-buffered rows. Used by
    // the flush retry path so the oldest data stays oldest in PG.
    prepend(batch: EmStatsBatch): void {
        const next = this.#batch;
        this.#batch = {
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
