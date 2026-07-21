// Bounded in-memory buffer for device_em.lifetime_counters UPSERTs.
// Parallel to emStatsQueue: every delta-tagged stats row also enqueues
// the absolute cumulative reading here. Flush path runs in the same
// interval that flushes em-stats; the upstream UPSERT pre-aggregates
// by (device, channel, tag) so duplicate rows in a batch collapse.

export interface LifetimeRow {
    deviceId: number;
    channel: number;
    tag: string;
    // Absolute reading in the tag's native unit (Wh for AC energy, Ah for bm
    // charge/discharge) — NOT the delta.
    cumulativeWh: number;
    // Electrical domain — part of the counter identity so DC Ah and AC Wh
    // counters coexist on the same channel/tag.
    domain: string;
    ts: number;
}

export interface LifetimeBatch {
    p_device: number[];
    p_channel: number[];
    p_tag: string[];
    p_cumulative: number[];
    p_ts: number[];
    p_domain: string[];
}

export class LifetimeQueue {
    #batch: LifetimeBatch = emptyBatch();

    enqueue(row: LifetimeRow): void {
        this.#batch.p_device.push(row.deviceId);
        this.#batch.p_channel.push(row.channel);
        this.#batch.p_tag.push(row.tag);
        this.#batch.p_cumulative.push(row.cumulativeWh);
        this.#batch.p_ts.push(row.ts);
        this.#batch.p_domain.push(row.domain);
    }

    size(): number {
        return this.#batch.p_ts.length;
    }

    drain(): LifetimeBatch {
        const snapshot = this.#batch;
        this.#batch = emptyBatch();
        return snapshot;
    }

    prepend(batch: LifetimeBatch): void {
        const next = this.#batch;
        this.#batch = {
            p_device: batch.p_device.concat(next.p_device),
            p_channel: batch.p_channel.concat(next.p_channel),
            p_tag: batch.p_tag.concat(next.p_tag),
            p_cumulative: batch.p_cumulative.concat(next.p_cumulative),
            p_ts: batch.p_ts.concat(next.p_ts),
            p_domain: batch.p_domain.concat(next.p_domain)
        };
    }
}

function emptyBatch(): LifetimeBatch {
    return {
        p_device: [],
        p_channel: [],
        p_tag: [],
        p_cumulative: [],
        p_ts: [],
        p_domain: []
    };
}

export const lifetimeQueue = new LifetimeQueue();
