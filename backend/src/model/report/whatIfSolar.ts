// What-if scenario: add N kW of PV. Pure projection — no I/O.

export interface WhatIfSolarInput {
    readonly currentGridKWh: number;
    readonly currentTariff: number;
    readonly emissionFactorGPerKWh: number;
    readonly addedKwP: number;
    readonly periodDays: number;
    readonly solarYieldKWhPerKwPPerYear?: number;
}

export interface WhatIfSolarResult {
    readonly addedKwP: number;
    readonly projectedGenerationKWh: number;
    readonly projectedSavingsCost: number;
    readonly projectedAvoidedKgCO2: number;
}

// EU average PV-yield rule-of-thumb: 1 kWp ≈ 1000 kWh/year.
const DEFAULT_YIELD_KWH_PER_KWP_PER_YEAR = 1000;
const DAYS_PER_YEAR = 365;

const EMPTY: WhatIfSolarResult = {
    addedKwP: 0,
    projectedGenerationKWh: 0,
    projectedSavingsCost: 0,
    projectedAvoidedKgCO2: 0
};

export function computeWhatIfSolar(input: WhatIfSolarInput): WhatIfSolarResult {
    if (!isValid(input)) return EMPTY;
    const yieldPerKwp =
        input.solarYieldKWhPerKwPPerYear ?? DEFAULT_YIELD_KWH_PER_KWP_PER_YEAR;
    const generation =
        (input.addedKwP * yieldPerKwp * input.periodDays) / DAYS_PER_YEAR;
    // Bounded by available grid load — can't displace more than was imported.
    const displaceableGrid = Math.min(generation, input.currentGridKWh);
    return {
        addedKwP: input.addedKwP,
        projectedGenerationKWh: +generation.toFixed(2),
        projectedSavingsCost: +(displaceableGrid * input.currentTariff).toFixed(
            2
        ),
        projectedAvoidedKgCO2: +(
            (displaceableGrid * input.emissionFactorGPerKWh) /
            1000
        ).toFixed(2)
    };
}

function isValid(i: WhatIfSolarInput): boolean {
    if (!Number.isFinite(i.currentGridKWh) || i.currentGridKWh < 0)
        return false;
    if (!Number.isFinite(i.currentTariff) || i.currentTariff < 0) return false;
    if (
        !Number.isFinite(i.emissionFactorGPerKWh) ||
        i.emissionFactorGPerKWh <= 0
    )
        return false;
    if (!Number.isFinite(i.addedKwP) || i.addedKwP <= 0) return false;
    if (!Number.isFinite(i.periodDays) || i.periodDays <= 0) return false;
    return true;
}
