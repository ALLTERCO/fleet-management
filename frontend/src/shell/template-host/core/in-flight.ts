export function createInFlightCoalescer<TResult>(): (
    key: string,
    request: () => Promise<TResult>
) => Promise<TResult> {
    const inFlight = new Map<string, Promise<TResult>>();

    return (key, request) => {
        const pending = inFlight.get(key);
        if (pending) return pending;

        const started = request();
        inFlight.set(key, started);
        const clear = () => {
            if (inFlight.get(key) === started) inFlight.delete(key);
        };
        void started.then(clear, clear);
        return started;
    };
}

export interface TtlCoalescerOptions {
    /** Reuse a fulfilled result for this long. 0 disables reuse. */
    ttlMs: number;
    /** Cap on retained results; the oldest are dropped first. */
    maxEntries?: number;
    /** Clock seam for tests. */
    now?: () => number;
}

/** In-flight coalescing plus a short reuse window for the settled value. Only
 *  fulfilled requests are retained: a rejection is never cached. */
export function createTtlCoalescer<TResult>(
    options: TtlCoalescerOptions
): (key: string, request: () => Promise<TResult>) => Promise<TResult> {
    const {ttlMs, maxEntries = 64, now = Date.now} = options;
    const coalesce = createInFlightCoalescer<TResult>();
    const settled = new Map<string, {value: TResult; expiresAtMs: number}>();

    const prune = (nowMs: number) => {
        for (const [key, entry] of settled) {
            if (entry.expiresAtMs <= nowMs) settled.delete(key);
        }
        // Map iterates in insertion order, so the front is the oldest entry.
        while (settled.size > maxEntries) {
            const oldest = settled.keys().next();
            if (oldest.done) break;
            settled.delete(oldest.value);
        }
    };

    return (key, request) => {
        const nowMs = now();
        const hit = settled.get(key);
        if (hit && hit.expiresAtMs > nowMs) return Promise.resolve(hit.value);
        if (hit) settled.delete(key);

        // Concurrent callers must share one promise identity.
        const started = coalesce(key, request);
        const retain = (value: TResult) => {
            settled.set(key, {value, expiresAtMs: now() + ttlMs});
            prune(now());
        };
        const discard = () => {
            // A rejected or cancelled request has no result worth reusing.
        };
        void started.then(retain, discard);
        return started;
    };
}
