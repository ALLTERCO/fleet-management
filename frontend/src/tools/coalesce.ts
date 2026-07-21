// Trailing-edge burst collapsing — the single source of truth for
// "many events in a burst → one refetch after a quiet gap".

export interface TrailingCoalescer {
    schedule(): void;
    cancel(): void;
}

export interface BatchCoalescer<Key> {
    schedule(key: Key): void;
    cancel(): void;
}

// Each schedule() re-arms the quiet timer; fn runs after quietMs of quiet.
// With maxWaitMs set, a sustained burst (events < quietMs apart) still flushes
// at least every maxWaitMs instead of starving until the burst pauses.
export function createTrailingCoalescer(
    fn: () => void,
    quietMs: number,
    maxWaitMs?: number
): TrailingCoalescer {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;
    function fire() {
        if (timer) clearTimeout(timer);
        if (maxTimer) clearTimeout(maxTimer);
        timer = undefined;
        maxTimer = undefined;
        fn();
    }
    return {
        schedule() {
            if (timer) clearTimeout(timer);
            timer = setTimeout(fire, quietMs);
            if (maxWaitMs !== undefined && maxTimer === undefined) {
                maxTimer = setTimeout(fire, maxWaitMs);
            }
        },
        cancel() {
            if (timer) clearTimeout(timer);
            if (maxTimer) clearTimeout(maxTimer);
            timer = undefined;
            maxTimer = undefined;
        }
    };
}

// Collects distinct keys during the burst; fn receives them on fire.
export function createBatchCoalescer<Key>(
    fn: (keys: Key[]) => void,
    quietMs: number,
    maxWaitMs?: number
): BatchCoalescer<Key> {
    const pending = new Set<Key>();
    const trailing = createTrailingCoalescer(
        () => {
            const keys = [...pending];
            pending.clear();
            fn(keys);
        },
        quietMs,
        maxWaitMs
    );
    return {
        schedule(key: Key) {
            pending.add(key);
            trailing.schedule();
        },
        cancel() {
            pending.clear();
            trailing.cancel();
        }
    };
}
