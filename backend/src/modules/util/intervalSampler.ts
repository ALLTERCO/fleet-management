// Lets an event emit at most once per interval. `sample()` returns how many
// events have occurred since the last emit when it is time to emit, else null —
// so a storm logs one periodic line that carries the count it stands for.
// now() and the interval are injected so it is deterministic in tests.

export class IntervalSampler {
    readonly #now: () => number;
    readonly #intervalMs: () => number;
    #lastEmitMs = Number.NEGATIVE_INFINITY;
    #pending = 0;

    constructor(intervalMs: () => number, now: () => number = Date.now) {
        this.#intervalMs = intervalMs;
        this.#now = now;
    }

    sample(): number | null {
        this.#pending++;
        const now = this.#now();
        if (now - this.#lastEmitMs < this.#intervalMs()) return null;
        const count = this.#pending;
        this.#pending = 0;
        this.#lastEmitMs = now;
        return count;
    }
}
