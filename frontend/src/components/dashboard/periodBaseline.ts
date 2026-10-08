// The baseline a period comparison needs: the mean of the PREVIOUS period.
// Averaging every bucket ever stored answers a different question than the
// "Previous" label promises, and answering with the current value when nothing
// was stored invents a baseline that does not exist.

export interface BucketPoint {
    /** Bucket timestamp; anything Date.parse understands. */
    bucket: string;
    value: number;
}

/**
 * Mean of the readings in the period that ended one period ago.
 * Null when that period holds no readings — there is no baseline to compare to.
 */
export function previousPeriodMean(
    points: readonly BucketPoint[],
    periodMs: number,
    nowMs: number
): number | null {
    if (!(periodMs > 0)) return null;
    const end = nowMs - periodMs;
    const start = end - periodMs;
    let sum = 0;
    let count = 0;
    for (const point of points) {
        const at = Date.parse(point.bucket);
        if (Number.isNaN(at) || at < start || at >= end) continue;
        sum += point.value;
        count += 1;
    }
    return count === 0 ? null : sum / count;
}
