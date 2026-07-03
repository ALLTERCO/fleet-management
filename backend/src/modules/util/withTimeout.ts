// Hard deadline around a promise factory. fn MUST observe the signal —
// otherwise its promise leaks until self-resolution. fetch/sendRPC/Node
// fs APIs honor it.

// setTimeout silently clamps above int32 max — reject early.
export const MAX_SAFE_TIMEOUT_MS = 2_147_483_647;

export class TimeoutError extends Error {
    constructor(
        readonly label: string,
        readonly ms: number
    ) {
        super(`${label} timed out after ${ms}ms`);
        this.name = 'TimeoutError';
    }
}

export async function withTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    ms: number,
    label: string
): Promise<T> {
    assertValidTimeoutMs(ms, label);
    const controller = new AbortController();
    const inner = fn(controller.signal);
    // Suppress unhandledRejection if fn rejects after the timeout wins.
    inner.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            inner,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => {
                    const err = new TimeoutError(label, ms);
                    controller.abort(err);
                    reject(err);
                }, ms);
                timer.unref?.();
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export function assertValidTimeoutMs(ms: number, label: string): void {
    if (!Number.isFinite(ms) || !Number.isInteger(ms)) {
        throw new RangeError(
            `${label}: timeout ms must be a finite integer (got ${ms})`
        );
    }
    if (ms <= 0) {
        throw new RangeError(`${label}: timeout ms must be > 0 (got ${ms})`);
    }
    if (ms > MAX_SAFE_TIMEOUT_MS) {
        throw new RangeError(
            `${label}: timeout ms must be ≤ ${MAX_SAFE_TIMEOUT_MS} to avoid setTimeout clamp (got ${ms})`
        );
    }
}
