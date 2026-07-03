import {DAY_MS} from '../../modules/util/timeUnits';
/** Project an end-of-period total from a partial period. Pure helpers. */

export interface ProjectionInput {
    readonly kwhSoFar: number;
    readonly costSoFar: number;
    readonly from: Date;
    readonly to: Date;
    readonly now: Date;
}

export interface ProjectionResult {
    readonly projectedKWh: number;
    readonly projectedCost: number;
    /** Confidence band as a fraction (0.05 / 0.10 / 0.15) based on days
     *  elapsed — wider band early in the period when extrapolation is noisier. */
    readonly confidenceBand: number;
    /** True iff the request covers a partial period whose remainder we
     *  extrapolated. Closed periods (now >= to) return their actuals. */
    readonly extrapolated: boolean;
}

/** Wide band early, narrow band late — picked by days elapsed, not fraction,
 *  so a 90-day report is treated more confidently than a 3-day one at 50%. */
function pickConfidenceBand(daysElapsed: number): number {
    if (daysElapsed <= 3) return 0.15;
    if (daysElapsed <= 14) return 0.1;
    return 0.05;
}

/** Linear extrapolation by elapsed fraction. Returns actuals when the window
 *  has already closed (now >= to) or when it has not yet opened (now <= from). */
export function projectPeriodTotal({
    kwhSoFar,
    costSoFar,
    from,
    to,
    now
}: ProjectionInput): ProjectionResult {
    const totalMs = to.getTime() - from.getTime();
    const elapsedMs = now.getTime() - from.getTime();

    if (totalMs <= 0 || elapsedMs <= 0) {
        return {
            projectedKWh: 0,
            projectedCost: 0,
            confidenceBand: 0.15,
            extrapolated: false
        };
    }

    if (elapsedMs >= totalMs) {
        return {
            projectedKWh: +kwhSoFar.toFixed(3),
            projectedCost: +costSoFar.toFixed(2),
            confidenceBand: 0,
            extrapolated: false
        };
    }

    // Multiply by ratio instead of dividing by fraction — preserves precision
    // when elapsedMs is small. Half-up rounding (Math.round) matches the
    // value users compute by hand.
    const projectedKWhRaw = (kwhSoFar * totalMs) / elapsedMs;
    const projectedCostRaw = (costSoFar * totalMs) / elapsedMs;
    const projectedKWh = Math.round(projectedKWhRaw * 1000) / 1000;
    const projectedCost = Math.round(projectedCostRaw * 100) / 100;
    const daysElapsed = elapsedMs / DAY_MS;
    return {
        projectedKWh,
        projectedCost,
        confidenceBand: pickConfidenceBand(daysElapsed),
        extrapolated: true
    };
}
