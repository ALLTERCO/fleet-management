import {BoundedMap} from '../boundedMap';

export type ReconnectDecision =
    | {allowed: true}
    | {allowed: false; retryAfterMs: number};

interface ReconnectBucket {
    hits: number[];
    blockedUntil: number;
}

export interface ReconnectLimiterOptions {
    maxKeys: number;
    windowMs: number;
    maxPerWindow: number;
    blockMs: number;
    now?: () => number;
}

export class ReconnectLimiter {
    readonly #windowMs: number;
    readonly #maxPerWindow: number;
    readonly #blockMs: number;
    readonly #now: () => number;
    readonly #buckets: BoundedMap<string, ReconnectBucket>;

    constructor(opts: ReconnectLimiterOptions) {
        this.#windowMs = Math.max(1, opts.windowMs);
        this.#maxPerWindow = Math.max(1, opts.maxPerWindow);
        this.#blockMs = Math.max(1, opts.blockMs);
        this.#now = opts.now ?? Date.now;
        this.#buckets = new BoundedMap<string, ReconnectBucket>({
            maxSize: Math.max(1, opts.maxKeys),
            ttlMs: this.#windowMs + this.#blockMs
        });
    }

    check(shellyID: string): ReconnectDecision {
        const now = this.#now();
        const bucket = this.#buckets.get(shellyID) ?? {
            hits: [],
            blockedUntil: 0
        };

        if (bucket.blockedUntil > now) {
            this.#buckets.set(shellyID, bucket);
            return {
                allowed: false,
                retryAfterMs: bucket.blockedUntil - now
            };
        }

        const since = now - this.#windowMs;
        bucket.hits = bucket.hits.filter((ts) => ts > since);
        bucket.hits.push(now);

        if (bucket.hits.length > this.#maxPerWindow) {
            bucket.blockedUntil = now + this.#blockMs;
            this.#buckets.set(shellyID, bucket);
            return {allowed: false, retryAfterMs: this.#blockMs};
        }

        bucket.blockedUntil = 0;
        this.#buckets.set(shellyID, bucket);
        return {allowed: true};
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
}
