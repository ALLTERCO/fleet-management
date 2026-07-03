// Per-source CO2 attribution from grid-side metering only.
// solar_self is a min() heuristic, not measured — flagged for UI.

export interface CarbonSourceInput {
    readonly totalConsumedKWh: number;
    readonly totalReturnedKWh: number;
    readonly factorGPerKWh: number;
}

export interface CarbonSourceBreakdown {
    readonly gridKWh: number;
    readonly solarSelfConsumedKWh: number;
    readonly solarExportedKWh: number;
    readonly gridKgCO2: number;
    readonly solarKgCO2: number;
    readonly avoidedKgCO2: number;
    /** True whenever solarSelfConsumedKWh > 0 — value is a floor estimate. */
    readonly solarSelfEstimated: boolean;
}

const EMPTY: CarbonSourceBreakdown = {
    gridKWh: 0,
    solarSelfConsumedKWh: 0,
    solarExportedKWh: 0,
    gridKgCO2: 0,
    solarKgCO2: 0,
    avoidedKgCO2: 0,
    solarSelfEstimated: false
};

export function computeCarbonSourceBreakdown(
    input: CarbonSourceInput
): CarbonSourceBreakdown {
    if (!isValid(input)) return EMPTY;
    const grid = Math.max(0, input.totalConsumedKWh - input.totalReturnedKWh);
    const solarSelf = Math.min(input.totalConsumedKWh, input.totalReturnedKWh);
    const solarExport = input.totalReturnedKWh;
    return {
        gridKWh: +grid.toFixed(3),
        solarSelfConsumedKWh: +solarSelf.toFixed(3),
        solarExportedKWh: +solarExport.toFixed(3),
        gridKgCO2: +((grid * input.factorGPerKWh) / 1000).toFixed(2),
        solarKgCO2: 0,
        avoidedKgCO2: +((solarExport * input.factorGPerKWh) / 1000).toFixed(2),
        solarSelfEstimated: solarSelf > 0
    };
}

function isValid(input: CarbonSourceInput): boolean {
    if (!Number.isFinite(input.totalConsumedKWh) || input.totalConsumedKWh < 0)
        return false;
    if (!Number.isFinite(input.totalReturnedKWh) || input.totalReturnedKWh < 0)
        return false;
    if (!Number.isFinite(input.factorGPerKWh) || input.factorGPerKWh <= 0)
        return false;
    return true;
}
