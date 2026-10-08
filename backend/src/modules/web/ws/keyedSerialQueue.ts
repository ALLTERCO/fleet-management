// Runs async work one at a time per key; different keys run in parallel.

const tails = new Map<string, Promise<unknown>>();

export function runExclusive<T>(
    key: string,
    work: () => Promise<T>
): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.then(noop, noop);
    tails.set(key, tail);
    void tail.then(() => forgetIdleKey(key, tail));
    return run;
}

function forgetIdleKey(key: string, tail: Promise<unknown>): void {
    if (tails.get(key) === tail) tails.delete(key);
}

function noop(): void {}
