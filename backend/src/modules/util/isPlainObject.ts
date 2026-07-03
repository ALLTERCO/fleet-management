/**
 * True when the value is a plain `{}` record — not null, not an array, not a
 * class instance. The single source of truth for "is this a JSON object?"
 * guards across the backend (device status, RPC params, integration config).
 */
export function isPlainObject(
    value: unknown
): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}
