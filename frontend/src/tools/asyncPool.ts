// Bounded-concurrency task runner: runs `task` over `items` with at most
// `limit` in flight, preserving input order in the returned array.
// Why: an unbounded Promise.all/allSettled over a device list fires one RPC
// per item in a single burst. A fixed in-flight ceiling throttles the burst
// without changing per-item outcomes.
// Contract: `task` must resolve for every item (catch its own errors) for
// allSettled-like semantics — a rejecting task aborts sibling workers.

export async function runPool<T, R>(
    items: readonly T[],
    limit: number,
    task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const size = items.length;
    const results = new Array<R>(size);
    if (size === 0) return results;
    const workers = Math.max(1, Math.min(limit, size));
    let next = 0;
    async function worker(): Promise<void> {
        while (next < size) {
            const index = next++;
            results[index] = await task(items[index], index);
        }
    }
    await Promise.all(Array.from({length: workers}, () => worker()));
    return results;
}
