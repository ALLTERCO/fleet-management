// Measures how long each step of a sequential operation takes, so a slow
// operation can report which step cost the time instead of a single opaque
// total. now() is injected so the timer is deterministic in tests.

export interface StageTiming {
    name: string;
    ms: number;
}

// "probe=10 components=20 ..." — the one structured form, shared by the timer
// and the slow-build log so both read identically.
export function formatStageTimings(stages: readonly StageTiming[]): string {
    return stages.map((s) => `${s.name}=${s.ms}`).join(' ');
}

export class StageTimer {
    readonly #now: () => number;
    readonly #start: number;
    #last: number;
    readonly #stages: StageTiming[] = [];

    constructor(now: () => number = Date.now) {
        this.#now = now;
        this.#start = now();
        this.#last = this.#start;
    }

    // Close the current step, recording its elapsed time under `name`, and
    // return that elapsed in ms.
    mark(name: string): number {
        const at = this.#now();
        const ms = at - this.#last;
        this.#last = at;
        this.#stages.push({name, ms});
        return ms;
    }

    totalMs(): number {
        return this.#now() - this.#start;
    }

    stages(): readonly StageTiming[] {
        return this.#stages;
    }

    // "probe=10 components=20 ..." — one-line structured form for logs.
    format(): string {
        return formatStageTimings(this.#stages);
    }
}
