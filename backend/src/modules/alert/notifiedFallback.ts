// Anchors the cooldown when the DB write of last_notified_at fails, so a
// flaky DB can't turn every re-fire into a fresh notification. The DB stays
// authoritative — a successful write clears the entry.
import {BoundedMap} from '../boundedMap';

// Safety bound, not an operator tunable. TTL outlasts the longest cooldown.
const MAX_ENTRIES = 50_000;
const TTL_MS = 24 * 60 * 60 * 1000;

const fallback = new BoundedMap<number, number>({
    maxSize: MAX_ENTRIES,
    ttlMs: TTL_MS
});

export function recordNotifiedFallback(instanceId: number): void {
    fallback.set(instanceId, Date.now());
}

export function clearNotifiedFallback(instanceId: number): void {
    fallback.delete(instanceId);
}

export function getNotifiedFallbackMs(instanceId: number): number | undefined {
    return fallback.get(instanceId);
}
