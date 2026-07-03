// Leak/stall signal for any bounded in-flight pool: given the start time of
// each item, report the oldest age and any item held past a threshold. Pure —
// the caller owns the map and decides what to log/alert.

import {IntervalSampler} from './intervalSampler';

export interface InFlightStuckReport {
    oldestHeldMs: number;
    stuck: string[];
}

export function inFlightStuckReport(
    startedAtMs: ReadonlyMap<string, number>,
    nowMs: number,
    thresholdMs: number
): InFlightStuckReport {
    let oldestHeldMs = 0;
    const stuck: string[] = [];
    for (const [key, since] of startedAtMs) {
        const heldMs = nowMs - since;
        if (heldMs > oldestHeldMs) oldestHeldMs = heldMs;
        if (heldMs >= thresholdMs) stuck.push(key);
    }
    return {oldestHeldMs, stuck};
}

export interface StuckMonitorDeps {
    now: () => number;
    setGauge: (name: string, value: number) => void;
    warn: (message: string) => void;
    // Read lazily so tuning that isn't ready at construction is still honored.
    thresholdMs: () => number;
}

// Monitor-only leak signal for a bounded in-flight pool. `begin`/`end` track
// each item; `report` (call on a timer) publishes the gauges and emits a
// rate-limited warning naming whatever is stuck. No reclaim — it surfaces a
// stall so the real cause gets fixed.
export class StuckMonitor {
    readonly #startedAtMs = new Map<string, number>();
    readonly #name: string;
    readonly #deps: StuckMonitorDeps;
    readonly #warnSampler: IntervalSampler;

    constructor(name: string, warnIntervalMs: number, deps: StuckMonitorDeps) {
        this.#name = name;
        this.#deps = deps;
        this.#warnSampler = new IntervalSampler(() => warnIntervalMs, deps.now);
    }

    begin(key: string): void {
        this.#startedAtMs.set(key, this.#deps.now());
    }

    end(key: string): void {
        this.#startedAtMs.delete(key);
    }

    oldestHeldMs(): number {
        return this.#snapshot().oldestHeldMs;
    }

    // Count of items currently held past the threshold, for the in-app monitor.
    stuckCount(): number {
        return this.#snapshot().stuck.length;
    }

    report(): void {
        const {oldestHeldMs, stuck} = this.#snapshot();
        this.#deps.setGauge(`${this.#name}_oldest_held_ms`, oldestHeldMs);
        this.#deps.setGauge(`${this.#name}_stuck`, stuck.length);
        if (stuck.length === 0) return;
        if (this.#warnSampler.sample() === null) return;
        this.#deps.warn(
            `${this.#name} stuck: ${stuck.length} held >${this.#deps.thresholdMs()}ms — [${stuck.join(', ')}]`
        );
    }

    #snapshot(): InFlightStuckReport {
        return inFlightStuckReport(
            this.#startedAtMs,
            this.#deps.now(),
            this.#deps.thresholdMs()
        );
    }
}
