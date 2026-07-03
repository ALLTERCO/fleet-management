// Flush wrapper for the lifetime UPSERT path. queueFlusher.flush is
// (batch) => Promise<void>; this wraps callMethod so the per-batch
// reset count surfaced by fn_upsert_lifetime gets folded into the
// lifetime_resets_total observability counter without changing the
// generic flusher contract. Pure side-effect; the count-extraction
// logic lives in extractResetCount (Answer) so tests can verify it
// in isolation.

import type {LifetimeBatch} from './lifetimeQueue';
import * as Observability from './Observability';
import {callMethod} from './PostgresProvider';

export async function flushLifetimeBatch(batch: LifetimeBatch): Promise<void> {
    const result = await callMethod('device_em.fn_upsert_lifetime', batch);
    const resets = extractResetCount(result);
    if (resets > 0) {
        Observability.incrementCounter('lifetime_resets_total', resets);
    }
}

export function extractResetCount(result: unknown): number {
    const rows = (result as {rows?: ReadonlyArray<unknown>})?.rows ?? [];
    if (rows.length === 0) return 0;
    const v = Object.values(rows[0] as Record<string, unknown>)[0];
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}
