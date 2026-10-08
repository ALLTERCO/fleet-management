// A bounded-concurrency gate: at most `maxConcurrent` tasks run at once, up to
// `queueMax` wait, and anything beyond that is dropped (so a storm of arrivals
// can't fan out into unbounded parallel work). The slot is handed straight from
// a finishing task to the next waiter, so `active` can never exceed the cap.

export class BoundedConcurrency {
    #active = 0;
    #queue: Array<(() => void) | undefined> = [];
    #queueHead = 0;
    #queued = 0;

    constructor(
        private readonly maxConcurrent: number,
        private readonly queueMax: number,
        private readonly onDrop: () => void = () => {}
    ) {}

    // Runs fn under the limit. Returns true if it ran (or is running), false if
    // it was dropped because both the active set and the queue were full.
    async run(fn: () => Promise<void>): Promise<boolean> {
        if (this.#active >= this.maxConcurrent) {
            if (this.#queued >= this.queueMax) {
                this.onDrop();
                return false;
            }
            // Wait for a slot handed over by a finishing task (which does NOT
            // decrement `active` when it wakes us — the slot transfers directly).
            this.#queued++;
            await new Promise<void>((resolve) => this.#queue.push(resolve));
        } else {
            this.#active++;
        }
        try {
            await fn();
        } finally {
            const next = this.#takeNext();
            if (next) {
                next();
            } else {
                this.#active--;
            }
        }
        return true;
    }

    stats(): {active: number; queued: number} {
        return {active: this.#active, queued: this.#queued};
    }

    #takeNext(): (() => void) | undefined {
        if (this.#queued === 0) return undefined;
        const next = this.#queue[this.#queueHead];
        this.#queue[this.#queueHead] = undefined;
        this.#queueHead++;
        this.#queued--;

        // Array.shift() moves every queued item and becomes quadratic during a
        // large admission burst. Compact occasionally while preserving FIFO.
        if (
            this.#queueHead >= 1_024 &&
            this.#queueHead * 2 >= this.#queue.length
        ) {
            this.#queue = this.#queue.slice(this.#queueHead);
            this.#queueHead = 0;
        }
        return next;
    }
}
