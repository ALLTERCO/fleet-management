/**
 * The shape every "recently used" list has: newest first, never the same entry
 * twice, and short enough to read at a glance. Adding an entry the list already
 * holds moves it to the front instead of repeating it.
 */
export function moveToFront<T>(options: {
    list: readonly T[];
    entry: T;
    /** What makes two entries the same row. */
    identify: (item: T) => string;
    limit: number;
}): readonly T[] {
    const {list, entry, identify, limit} = options;
    if (limit <= 0) return [];
    const head = identify(entry);
    const rest = list.filter((item) => identify(item) !== head);
    return [entry, ...rest].slice(0, limit);
}
