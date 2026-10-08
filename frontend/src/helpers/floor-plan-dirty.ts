// Has the floor's geometry changed since it was saved?
//
// Not a one-line JSON.stringify comparison, and the reason is load-bearing:
// kindFields is a Postgres JSONB column, and jsonb reorders object keys on
// the way in (shortest key first, then byte order). So a wall saved as
// {from, to} comes back as {to, from}. Comparing raw stringify output would
// report a floor as unsaved forever the moment it was saved — the Save
// button never settles and the "discard your changes?" prompt fires on
// every navigation away from a floor the user just saved.

/** True when `local` differs from `stored` in value, ignoring the key order
 *  the database chose. */
export function hasGeometryChanged(local: unknown, stored: unknown): boolean {
    return canonicalize(local) !== canonicalize(stored);
}

function canonicalize(value: unknown): string {
    return JSON.stringify(value, (_key, raw) =>
        isPlainObject(raw) ? withSortedKeys(raw) : raw
    );
}

// JSON.stringify serializes an object's own keys in insertion order, so
// rebuilding it sorted is enough to make the output order-independent.
function withSortedKeys(
    value: Record<string, unknown>
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = value[key];
    return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
