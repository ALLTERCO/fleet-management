/**
 * BoundedMap — LRU Map with optional TTL. O(1) via native Map order.
 * Expired entries are purged lazily on read. For caches ≤100k entries.
 */
export interface BoundedMapOptions {
    /** Max entries. Oldest LRU evicted on overflow. ≥1. */
    maxSize: number;
    /** TTL ms. Omit for no expiry. */
    ttlMs?: number;
}

interface Entry<V> {
    value: V;
    expiresAt: number;
}

export class BoundedMap<K, V> {
    readonly #maxSize: number;
    readonly #ttlMs: number;
    readonly #map = new Map<K, Entry<V>>();

    constructor(options: BoundedMapOptions) {
        this.#maxSize = Math.max(1, options.maxSize);
        this.#ttlMs = options.ttlMs ?? Number.POSITIVE_INFINITY;
    }

    get(key: K): V | undefined {
        const entry = this.#map.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt < Date.now()) {
            this.#map.delete(key);
            return undefined;
        }
        // Touch — move to most-recent by re-inserting.
        this.#map.delete(key);
        this.#map.set(key, entry);
        return entry.value;
    }

    has(key: K): boolean {
        return this.get(key) !== undefined;
    }

    set(key: K, value: V): void {
        if (this.#map.has(key)) this.#map.delete(key);
        this.#map.set(key, {
            value,
            expiresAt:
                this.#ttlMs === Number.POSITIVE_INFINITY
                    ? Number.POSITIVE_INFINITY
                    : Date.now() + this.#ttlMs
        });
        if (this.#map.size > this.#maxSize) {
            const oldest = this.#map.keys().next().value as K | undefined;
            if (oldest !== undefined) this.#map.delete(oldest);
        }
    }

    delete(key: K): boolean {
        return this.#map.delete(key);
    }

    clear(): void {
        this.#map.clear();
    }

    get size(): number {
        return this.#map.size;
    }

    keys(): IterableIterator<K> {
        return this.#map.keys();
    }

    /** Yields [key, value] pairs in insertion order (same as Map). */
    *entries(): IterableIterator<[K, V]> {
        for (const [k, entry] of this.#map) {
            yield [k, entry.value];
        }
    }

    *values(): IterableIterator<V> {
        for (const entry of this.#map.values()) {
            yield entry.value;
        }
    }

    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.entries();
    }
}
