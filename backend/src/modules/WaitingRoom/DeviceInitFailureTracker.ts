// Adaptive cooldown for repeated device init failures. Cooldown grows
// per fail; sustained stability resets it.

import {BoundedMap} from '../boundedMap';

export type DeviceInitFailureDecision =
    | {allowed: true}
    | {allowed: false; retryAfterMs: number; failureCount: number};

interface FailureBucket {
    failureCount: number;
    cooldownUntilMs: number;
    lastSuccessAtMs: number;
}

export interface DeviceInitFailureTrackerOptions {
    maxKeys: number;
    cooldownLadderMs: readonly number[];
    /** Time outside cooldown a device must stay stable before the ladder resets. */
    stableConnectionMs: number;
    /** Injectable clock for tests. */
    now?: () => number;
}

export class DeviceInitFailureTracker {
    readonly #ladder: readonly number[];
    readonly #stableMs: number;
    readonly #now: () => number;
    readonly #buckets: BoundedMap<string, FailureBucket>;

    constructor(opts: DeviceInitFailureTrackerOptions) {
        if (opts.cooldownLadderMs.length === 0) {
            throw new Error('cooldownLadderMs must contain at least one step');
        }
        this.#ladder = opts.cooldownLadderMs;
        this.#stableMs = Math.max(1, opts.stableConnectionMs);
        this.#now = opts.now ?? Date.now;
        // Bucket must outlive the longest cooldown + stable window so the
        // ladder is not escaped by waiting out one step.
        const maxLadder = Math.max(...this.#ladder);
        this.#buckets = new BoundedMap<string, FailureBucket>({
            maxSize: Math.max(1, opts.maxKeys),
            ttlMs: maxLadder + this.#stableMs
        });
    }

    check(shellyID: string): DeviceInitFailureDecision {
        const now = this.#now();
        const bucket = this.#buckets.get(shellyID);
        if (!bucket || bucket.cooldownUntilMs <= now) return {allowed: true};
        return {
            allowed: false,
            retryAfterMs: bucket.cooldownUntilMs - now,
            failureCount: bucket.failureCount
        };
    }

    recordFailure(shellyID: string): void {
        const now = this.#now();
        const prev = this.#buckets.get(shellyID);
        const failureCount = (prev?.failureCount ?? 0) + 1;
        this.#buckets.set(shellyID, {
            failureCount,
            cooldownUntilMs: now + this.#cooldownForCount(failureCount),
            lastSuccessAtMs: prev?.lastSuccessAtMs ?? 0
        });
    }

    recordSuccess(shellyID: string): void {
        const prev = this.#buckets.get(shellyID);
        if (!prev || prev.failureCount === 0) return;
        const now = this.#now();
        // Reset only after the device has stayed outside its cooldown for the
        // full stable window. Flapping inits keep the ladder armed.
        if (now - prev.cooldownUntilMs >= this.#stableMs) {
            this.#buckets.delete(shellyID);
            return;
        }
        this.#buckets.set(shellyID, {
            failureCount: prev.failureCount,
            cooldownUntilMs: prev.cooldownUntilMs,
            lastSuccessAtMs: now
        });
    }

    clear(shellyID: string): void {
        this.#buckets.delete(shellyID);
    }

    clearAll(): void {
        this.#buckets.clear();
    }

    size(): number {
        return this.#buckets.size;
    }

    #cooldownForCount(failureCount: number): number {
        const idx = Math.min(failureCount - 1, this.#ladder.length - 1);
        return this.#ladder[Math.max(0, idx)];
    }
}
