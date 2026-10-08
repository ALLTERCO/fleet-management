// When a rule last notified about one particular alert, keyed by the alert's
// identity rather than by the row that happened to carry it.
//
// The row is not the identity. With dedupeWindowSec at 0 — the default — a
// resolve-then-refire inserts a fresh row every time, so an instance-keyed
// memory (and last_notified_at, which lives on the row) both reset on every
// flap. Cooldown then never applied and a flapping sensor paged on every
// flap. Keying on rule + fingerprint survives the new row, which is what
// "wait between notifications" has to mean.
//
// The DB stays authoritative for a row that lives on: last_notified_at commits
// with the alert and its delivery, and this memory takes the larger time.
import {BoundedMap} from '../boundedMap';

// Safety bound, not an operator tunable. TTL outlasts the longest cooldown.
const MAX_ENTRIES = 50_000;
const TTL_MS = 24 * 60 * 60 * 1000;

const fallback = new BoundedMap<string, number>({
    maxSize: MAX_ENTRIES,
    ttlMs: TTL_MS
});

export interface AlertIdentity {
    ruleId: number;
    fingerprint: string;
}

function keyOf(identity: AlertIdentity): string {
    return `${identity.ruleId}:${identity.fingerprint}`;
}

export function recordNotifiedFallback(identity: AlertIdentity): void {
    fallback.set(keyOf(identity), Date.now());
}

export function clearNotifiedFallback(identity: AlertIdentity): void {
    fallback.delete(keyOf(identity));
}

export function getNotifiedFallbackMs(
    identity: AlertIdentity
): number | undefined {
    return fallback.get(keyOf(identity));
}

/** Test seam — the map outlives a single test file otherwise. */
export function _resetNotifiedFallbackForTests(): void {
    fallback.clear();
}
