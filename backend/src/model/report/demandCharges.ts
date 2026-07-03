// 15-minute rolling-peak demand in kW × demand rate. The line on commercial
// utility bills that's typically 30-50% of the total bill in temperate
// climates. Honest only when computed on a service-entrance meter — otherwise
// it's just "peak of a circuit" which has no billing meaning.

export interface DemandSample {
    /** Power in kW. */
    readonly powerKW: number;
    /** Sample timestamp. */
    readonly ts: Date;
}

export interface DemandChargeInput {
    readonly samples: readonly DemandSample[];
    /** Demand window in minutes — utility-default is 15. */
    readonly windowMinutes?: number;
    /** Demand rate in currency per kW-month. */
    readonly demandRate: number;
}

export interface DemandChargeResult {
    /** Peak average kW over any windowMinutes-long window. */
    readonly peakKW: number;
    /** Currency owed (peakKW × demandRate). */
    readonly cost: number;
    /** When the peak window started. */
    readonly peakStart: Date | null;
    /** How long the demand window is (echoed for transparency). */
    readonly windowMinutes: number;
}

const DEFAULT_WINDOW_MINUTES = 15;

export function computeDemandCharges(
    input: DemandChargeInput
): DemandChargeResult {
    const windowMinutes = input.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
    if (input.samples.length === 0 || input.demandRate <= 0) {
        return {peakKW: 0, cost: 0, peakStart: null, windowMinutes};
    }
    const peak = findPeakAverageWindow(input.samples, windowMinutes);
    return {
        peakKW: round3(peak.averageKW),
        cost: round2(peak.averageKW * input.demandRate),
        peakStart: peak.startedAt,
        windowMinutes
    };
}

interface PeakWindow {
    readonly averageKW: number;
    readonly startedAt: Date | null;
}

function findPeakAverageWindow(
    samples: readonly DemandSample[],
    windowMinutes: number
): PeakWindow {
    const windowMs = windowMinutes * 60_000;
    const sorted = sortedSamples(samples);
    let bestAvg = 0;
    let bestStart: Date | null = null;
    for (let startIdx = 0; startIdx < sorted.length; startIdx += 1) {
        const start = sorted[startIdx];
        const endTime = start.ts.getTime() + windowMs;
        const windowAvg = averagePowerInRange(sorted, startIdx, endTime);
        if (windowAvg > bestAvg) {
            bestAvg = windowAvg;
            bestStart = start.ts;
        }
    }
    return {averageKW: bestAvg, startedAt: bestStart};
}

function sortedSamples(samples: readonly DemandSample[]): DemandSample[] {
    return [...samples]
        .filter((s) => Number.isFinite(s.powerKW) && s.ts instanceof Date)
        .sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

// Inclusive on start, exclusive on end — matches the utility-billing
// "demand window" definition so adjacent windows don't double-count
// the boundary sample.
function averagePowerInRange(
    sorted: readonly DemandSample[],
    startIdx: number,
    endTime: number
): number {
    let sum = 0;
    let count = 0;
    for (let i = startIdx; i < sorted.length; i += 1) {
        if (sorted[i].ts.getTime() >= endTime) break;
        sum += sorted[i].powerKW;
        count += 1;
    }
    return count > 0 ? sum / count : 0;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}
