/**
 * Shared JSON field readers for the notification cluster.
 *
 * These used to be copy-pasted (with subtly diverging behavior) across the
 * channel, routing, suppression, on-call and preference modules. This is the
 * single home. Callers that need extra normalization (e.g. lowercasing
 * weekdays) compose on top of these rather than forking a new copy.
 */

/** A plain object, or {} for arrays, null and primitives. */
export function readObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/** A trimmed non-empty string, or null. */
export function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The value when it is an array, else []. */
export function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

/** Trimmed non-empty strings from an array; non-strings and blanks dropped. */
export function readStringArray(value: unknown): string[] {
    return readArray(value)
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/** Plain objects from an array; arrays, null and primitives dropped. */
export function readObjects(value: unknown): Array<Record<string, unknown>> {
    return readArray(value).filter(
        (entry): entry is Record<string, unknown> =>
            !!entry && typeof entry === 'object' && !Array.isArray(entry)
    );
}
