// A bounded-concurrency gate: at most `maxConcurrent` tasks run at once, up to
// `queueMax` wait, and anything beyond that is dropped (so a storm of arrivals
// can't fan out into unbounded parallel work). The slot is handed straight from
// a finishing task to the next waiter, so `active` can never exceed the cap.

export class BoundedConcurrency {
    #active = 0;
    #queue: Array<() => void> = [];

    constructor(
        private readonly maxConcurrent: number,
        private readonly queueMax: number,
        private readonly onDrop: () => void = () => {}
    ) {}

    // Runs fn under the limit. Returns true if it ran (or is running), false if
    // it was dropped because both the active set and the queue were full.
    async run(fn: () => Promise<void>): Promise<boolean> {
        if (this.#active >= this.maxConcurrent) {
            if (this.#queue.length >= this.queueMax) {
                this.onDrop();
                return false;
            }
            // Wait for a slot handed over by a finishing task (which does NOT
            // decrement `active` when it wakes us — the slot transfers directly).
            await new Promise<void>((resolve) => this.#queue.push(resolve));
        } else {
            this.#active++;
        }
        try {
            await fn();
        } finally {
            const next = this.#queue.shift();
            if (next) next();
            else this.#active--;
        }
        return true;
    }

    stats(): {active: number; queued: number} {
        return {active: this.#active, queued: this.#queue.length};
    }
}
