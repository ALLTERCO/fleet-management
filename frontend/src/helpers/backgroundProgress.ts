export interface ProgressSample {
    remaining: number;
    sampledAtMs: number;
}

export interface ProgressEstimate {
    /** Smoothed completion rate, units per second. Carry into the next call. */
    ratePerSecond: number;
    remainingSeconds: number;
}

// Weight of the newest poll in the smoothed rate. Deliberately low: sync speed
// swings with what else the backend is doing, and an estimate that jumps every
// poll tells the reader less than one that drifts.
const RATE_SMOOTHING = 0.25;
// Below this the minute count is real information; above it, it is false
// precision, so the label rounds to a coarser step.
const EXACT_MINUTES_BELOW = 10;
const COARSE_MINUTE_STEP = 5;

/** Units completed per second between two polls; null when nothing moved. */
function sampleRate(
    previous: ProgressSample,
    current: ProgressSample
): number | null {
    const elapsedSeconds = (current.sampledAtMs - previous.sampledAtMs) / 1000;
    const completed = previous.remaining - current.remaining;
    if (elapsedSeconds <= 0 || completed <= 0) return null;
    return completed / elapsedSeconds;
}

/**
 * Remaining time from a rate smoothed across polls.
 *
 * Pass the previous call's `ratePerSecond` back in as `priorRate`. A poll that
 * shows no progress coasts on the known rate instead of blanking the estimate,
 * which is the other half of why the old readout flickered.
 */
export function estimateProgress(
    previous: ProgressSample | null,
    current: ProgressSample,
    priorRate: number | null
): ProgressEstimate | null {
    if (!previous || current.remaining <= 0) return null;
    const rate = sampleRate(previous, current);
    if (rate === null) {
        if (priorRate === null || priorRate <= 0) return null;
        return {
            ratePerSecond: priorRate,
            remainingSeconds: Math.ceil(current.remaining / priorRate)
        };
    }
    const smoothed =
        priorRate === null ? rate : priorRate + (rate - priorRate) * RATE_SMOOTHING;
    return {
        ratePerSecond: smoothed,
        remainingSeconds: Math.ceil(current.remaining / smoothed)
    };
}

// A reader takes 100.0% as "finished", so a bar with work outstanding stops
// here: the panel prints one decimal, and 99.97 rounds up to a finished bar.
const WORK_LEFT_MAX_PCT = 99.9;

/**
 * Percentage to print on a progress bar that is computed in the browser.
 * `workLeft` says whether anything is still running; while it is, the bar never
 * reads finished, however small the remainder is.
 *
 * A percentage the backend sends is already held back by the handler that owns
 * it and is printed as received; no runtime value crosses the tier boundary.
 */
export function progressPct(rawPct: number, workLeft: boolean): number {
    const clamped = Math.min(100, Math.max(0, rawPct));
    return workLeft ? Math.min(clamped, WORK_LEFT_MAX_PCT) : clamped;
}

export function formatRemaining(seconds: number | null): string {
    if (seconds === null) return 'Measuring sync speed…';
    if (seconds < 90) return 'Less than a minute remaining';
    const minutes = Math.round(seconds / 60);
    if (minutes < EXACT_MINUTES_BELOW) return `About ${minutes} minutes remaining`;
    if (minutes < 60) {
        const step =
            Math.round(minutes / COARSE_MINUTE_STEP) * COARSE_MINUTE_STEP;
        return `About ${step} minutes remaining`;
    }
    const hours = seconds / 3600;
    if (hours < 2) return 'About an hour remaining';
    return `About ${Math.round(hours)} hours remaining`;
}
