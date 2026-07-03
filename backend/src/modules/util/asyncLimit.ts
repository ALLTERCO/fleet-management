// Bounded-concurrency runner. Returns a function that gates promise-returning work.

export function createAsyncLimit(
    max: number
): <T>(fn: () => Promise<T>) => Promise<T> {
    let active = 0;
    const queue: Array<() => void> = [];

    const next = () => {
        if (active >= max) return;
        const resume = queue.shift();
        if (resume) resume();
    };

    return async <T>(fn: () => Promise<T>): Promise<T> => {
        if (active >= max) {
            await new Promise<void>((r) => queue.push(r));
        }
        active++;
        try {
            return await fn();
        } finally {
            active--;
            next();
        }
    };
}
