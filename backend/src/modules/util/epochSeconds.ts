/**
 * Normalize an untrusted device timestamp to whole epoch seconds.
 *
 * Devices may omit or malform the top-level `ts`; the caller supplies a
 * trusted fallback (e.g. the receive time) so a bad value never throws or
 * drops the surrounding payload.
 */
export function toEpochSeconds(
    value: unknown,
    fallbackSeconds: number
): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.round(value);
    }
    return fallbackSeconds;
}
