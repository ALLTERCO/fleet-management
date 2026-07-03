// Round-trip efficiency = energy out / energy in. Lifetime AC-AC
// efficiency of a battery system from the BESS-tagged meter. Typical
// lithium home batteries land at 85-92% — values outside that range
// usually signal metering issues, not bad chemistry.

export interface BatteryEfficiencyInput {
    /** kWh consumed by the battery while charging — from BESS-role meter. */
    readonly chargedKWh: number;
    /** kWh discharged from the battery to the load. */
    readonly dischargedKWh: number;
}

export interface BatteryEfficiencyResult {
    readonly chargedKWh: number;
    readonly dischargedKWh: number;
    readonly roundTripPct: number | null; // 0..100, 1dp; null when no charge
    readonly losses: number; // chargedKWh − dischargedKWh, rounded
}

export function computeBatteryEfficiency(
    input: BatteryEfficiencyInput
): BatteryEfficiencyResult {
    const charged = clampPositive(input.chargedKWh);
    const discharged = clampPositive(input.dischargedKWh);
    return {
        chargedKWh: round3(charged),
        dischargedKWh: round3(discharged),
        roundTripPct:
            charged > 0 ? Math.round((discharged / charged) * 1000) / 10 : null,
        losses: round3(Math.max(0, charged - discharged))
    };
}

function clampPositive(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}
