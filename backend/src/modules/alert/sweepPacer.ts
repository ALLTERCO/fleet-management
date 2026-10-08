// Spreads a sweep tick over a window, so its DB writes and CPU do not burst.

export interface SweepPaceOptions {
    /** Real time the tick started. */
    startedAtMs: number;
    /** Pacing never waits past this moment. */
    deadlineMs: number;
    /** Length of the spread; 0 runs at full speed. */
    windowMs: number;
    /** Work units the previous tick admitted; 0 runs at full speed. */
    expectedUnits: number;
    clock: () => number;
    signal: AbortSignal;
}

// A timer the tick's stop can cut short.
function pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        timer.unref?.();
        signal.addEventListener('abort', done, {once: true});
    });
}

// A batch starts once its share of the window has passed; extra work runs after it.
export class SweepPacer {
    readonly #options: SweepPaceOptions;
    #admitted = 0;
    #waitedMs = 0;

    constructor(options: SweepPaceOptions) {
        this.#options = options;
    }

    get admittedUnits(): number {
        return this.#admitted;
    }

    get waitedMs(): number {
        return this.#waitedMs;
    }

    get stopped(): boolean {
        return this.#options.signal.aborted;
    }

    async admit(units: number): Promise<void> {
        const dueAt = this.#dueAt();
        this.#admitted += units;
        const waitMs = dueAt - this.#options.clock();
        if (waitMs <= 0 || this.#options.signal.aborted) return;
        this.#waitedMs += waitMs;
        await pause(waitMs, this.#options.signal);
    }

    #dueAt(): number {
        const {expectedUnits, windowMs, startedAtMs, deadlineMs} =
            this.#options;
        if (expectedUnits <= 0 || windowMs <= 0)
            return Number.NEGATIVE_INFINITY;
        const share = Math.min(1, this.#admitted / expectedUnits);
        return Math.min(startedAtMs + windowMs * share, deadlineMs);
    }
}

export interface SweepTickOptions {
    /** Evaluation time at the start of the tick. */
    now: number;
    deadlineMs: number;
    /** Omitted: a fixed evaluation time and no pacing. */
    pace?: {windowMs: number; expectedUnits: number};
    clock?: () => number;
}

export class SweepTick {
    readonly deadlineMs: number;
    readonly pacer: SweepPacer;
    readonly #now: number;
    readonly #startedAtMs: number;
    readonly #paced: boolean;
    readonly #clock: () => number;
    readonly #stop = new AbortController();
    #rowsRead = 0;

    constructor(options: SweepTickOptions) {
        this.#clock = options.clock ?? Date.now;
        this.#now = options.now;
        this.#startedAtMs = this.#clock();
        this.#paced = options.pace !== undefined;
        this.deadlineMs = options.deadlineMs;
        this.pacer = new SweepPacer({
            startedAtMs: this.#startedAtMs,
            deadlineMs: options.deadlineMs,
            windowMs: options.pace?.windowMs ?? 0,
            expectedUnits: options.pace?.expectedUnits ?? 0,
            clock: this.#clock,
            signal: this.#stop.signal
        });
    }

    /** Evaluation time; it follows real time while a paced tick runs. */
    now(): number {
        if (!this.#paced) return this.#now;
        return this.#now + (this.#clock() - this.#startedAtMs);
    }

    /** No new work may start: the budget is spent or the tick was stopped. */
    expired(): boolean {
        return this.#stop.signal.aborted || this.#clock() >= this.deadlineMs;
    }

    stop(): void {
        this.#stop.abort();
    }

    noteRowsRead(rows: number): void {
        this.#rowsRead += rows;
    }

    get rowsRead(): number {
        return this.#rowsRead;
    }
}
