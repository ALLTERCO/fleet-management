// The framework-neutral state contract. React binds it with
// useSyncExternalStore; Vue projects it onto a ref.

export interface ExternalStore<T> {
    getSnapshot(): T;
    subscribe(listener: () => void): () => void;
}

export interface MutableExternalStore<T> extends ExternalStore<T> {
    setSnapshot(next: T): void;
}

/** A store whose value only ever changes through `setSnapshot`. */
export function createExternalStore<T>(initial: T): MutableExternalStore<T> {
    let snapshot = initial;
    const listeners = new Set<() => void>();

    return {
        getSnapshot: () => snapshot,
        setSnapshot(next: T) {
            if (Object.is(next, snapshot)) return;
            snapshot = next;
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }
    };
}

/**
 * Projects one store onto another. The memo is a correctness requirement:
 * useSyncExternalStore re-renders forever on a fresh object each call.
 */
export function mapExternalStore<TSource, TResult>(
    source: ExternalStore<TSource>,
    project: (value: TSource) => TResult
): ExternalStore<TResult> {
    let cachedSource: TSource | undefined;
    let cachedResult: TResult | undefined;
    let hasCache = false;

    return {
        getSnapshot() {
            const next = source.getSnapshot();
            if (hasCache && Object.is(next, cachedSource)) {
                return cachedResult as TResult;
            }
            cachedSource = next;
            cachedResult = project(next);
            hasCache = true;
            return cachedResult;
        },
        subscribe: (listener) => source.subscribe(listener)
    };
}

/** A store for a value that never changes, for tests and static contexts. */
export function createConstantStore<T>(value: T): ExternalStore<T> {
    return {
        getSnapshot: () => value,
        subscribe: () => () => {}
    };
}
