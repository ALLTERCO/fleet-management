// Shared query over a recent-events ring: keep entries inside the time window,
// heaviest first, capped at the limit. One home for every slow-* "top N in the
// last window" view.

export interface WindowQuery {
    windowSec: number;
    limit: number;
}

export function windowedTopN<T extends {ts: number}>(
    ring: readonly T[],
    query: WindowQuery,
    weight: (entry: T) => number
): T[] {
    const cutoff = Date.now() - query.windowSec * 1000;
    return ring
        .filter((entry) => entry.ts >= cutoff)
        .sort((a, b) => weight(b) - weight(a))
        .slice(0, query.limit);
}
