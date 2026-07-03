// LRU dedupe for warn-once paths — caps memory under hostile firmware.

const DEFAULT_MAX_ENTRIES = 2048;

export interface BoundedLogDedupeSet {
    has(key: string): boolean;
    record(key: string): void;
    size(): number;
}

export interface BoundedLogDedupeSetOptions {
    maxEntries?: number;
}

export function boundedLogDedupeSet(
    options: BoundedLogDedupeSetOptions = {}
): BoundedLogDedupeSet {
    const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (max <= 0) {
        throw new Error('boundedLogDedupeSet maxEntries must be positive');
    }
    const seen = new Map<string, true>();
    return {
        has(key) {
            return seen.has(key);
        },
        record(key) {
            // Re-record refreshes LRU position so hot keys stay deduped.
            if (seen.has(key)) seen.delete(key);
            seen.set(key, true);
            if (seen.size > max) {
                const oldest = seen.keys().next().value;
                if (oldest !== undefined) seen.delete(oldest);
            }
        },
        size() {
            return seen.size;
        }
    };
}
