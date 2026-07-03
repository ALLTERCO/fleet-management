// Real solar self-consumption when a logical meter with role=pv exists.
// Replaces the min(consumed,returned) heuristic the basic report falls back to.
//
// self = produced − exported (clamped at zero)
// rate = self / produced

export interface SolarSelfConsumptionInput {
    /** kWh produced by the solar PV inverter — measured, not derived. */
    readonly producedKWh: number;
    /** kWh exported to the grid — measured at service entrance. */
    readonly exportedKWh: number;
}

export interface SolarSelfConsumptionResult {
    readonly selfConsumedKWh: number;
    readonly selfConsumptionRatePct: number; // 0..100, 1dp
    readonly avoidedGridImportKWh: number; // alias for selfConsumedKWh
}

export function computeSolarSelfConsumption(
    input: SolarSelfConsumptionInput
): SolarSelfConsumptionResult {
    const produced = clampPositive(input.producedKWh);
    const exported = clampPositive(input.exportedKWh);
    const selfRaw = Math.max(0, produced - exported);
    const ratePct =
        produced > 0 ? Math.round((selfRaw / produced) * 1000) / 10 : 0;
    return {
        selfConsumedKWh: round3(selfRaw),
        selfConsumptionRatePct: ratePct,
        avoidedGridImportKWh: round3(selfRaw)
    };
}

function clampPositive(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}
