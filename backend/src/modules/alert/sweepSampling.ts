// Pure sampling math for the RuleSweep. For a sleeping device the caller
// passes its wakeup_period as expectedIntervalSec, so sleep is not read as
// offline; graceSec is the eval-delay margin against batching lag.

export interface Sample {
    value: number;
    ts: number;
}

/** True when telemetry has been silent longer than the device's own cadence. */
export function heartbeatMissed(
    lastReportTsMs: number | undefined,
    now: number,
    expectedIntervalSec: number,
    graceSec: number
): boolean {
    if (lastReportTsMs === undefined) return false;
    return now - lastReportTsMs > (expectedIntervalSec + graceSec) * 1000;
}

/** Per-second change between two samples; null without a usable prior sample. */
export function computeRate(
    prev: Sample | undefined,
    cur: Sample
): number | null {
    if (!prev) return null;
    const dtSec = (cur.ts - prev.ts) / 1000;
    if (dtSec <= 0) return null;
    return (cur.value - prev.value) / dtSec;
}

/** True when a reading has not changed for longer than the configured window. */
export function stuckFor(
    lastChangedAtMs: number,
    now: number,
    notChangedForSec: number
): boolean {
    return now - lastChangedAtMs > notChangedForSec * 1000;
}

/** Newest sample at or before cutoffMs, or null. History ascending by ts. */
export function sampleAtOrBefore(
    history: readonly Sample[],
    cutoffMs: number
): Sample | null {
    let found: Sample | null = null;
    for (const s of history) {
        if (s.ts <= cutoffMs) found = s;
        else break;
    }
    return found;
}
