// kWh-shift arithmetic. Caller resolves rate spread via pickRateSpread.

export interface TouShiftInput {
    readonly peakConsumption: number;
    readonly peakRate: number;
    readonly offPeakRate: number;
    readonly shiftableFraction: number;
}

export interface TouShiftResult {
    readonly shiftedKWh: number;
    readonly savings: number;
}

const ZERO_OPPORTUNITY: TouShiftResult = {shiftedKWh: 0, savings: 0};

export function computeTouShift(input: TouShiftInput): TouShiftResult {
    if (!hasOpportunity(input)) return ZERO_OPPORTUNITY;
    const fraction = Math.min(1, input.shiftableFraction);
    const shiftedKWh = +(input.peakConsumption * fraction).toFixed(3);
    const savings = +(
        shiftedKWh *
        (input.peakRate - input.offPeakRate)
    ).toFixed(2);
    return {shiftedKWh, savings};
}

function hasOpportunity(input: TouShiftInput): boolean {
    if (!isPositiveFinite(input.peakConsumption)) return false;
    if (!isPositiveFinite(input.peakRate)) return false;
    if (!Number.isFinite(input.offPeakRate)) return false;
    if (input.offPeakRate >= input.peakRate) return false;
    if (!isPositiveFinite(input.shiftableFraction)) return false;
    return true;
}

function isPositiveFinite(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}
