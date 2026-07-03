// Cost of running below the utility-target power factor (typ. 0.9).
// Many commercial tariffs uplift the kWh rate when pf falls below a threshold.

export interface PowerFactorPenaltyInput {
    readonly avgPowerFactor: number; // 0..1
    readonly kWh: number;
    readonly tariff: number; // currency per kWh
    readonly targetPf?: number; // default 0.9
}

export interface PowerFactorPenaltyResult {
    readonly fires: boolean;
    readonly avgPf: number;
    readonly penaltyCost: number;
    readonly upliftFactor: number; // (target/pf - 1), 0 when above target
}

const DEFAULT_TARGET_PF = 0.9;

export function computePowerFactorPenalty(
    input: PowerFactorPenaltyInput
): PowerFactorPenaltyResult {
    const target = input.targetPf ?? DEFAULT_TARGET_PF;
    const pf = clamp01(input.avgPowerFactor);
    if (pf >= target || pf <= 0 || input.kWh <= 0 || input.tariff <= 0) {
        return {fires: false, avgPf: pf, penaltyCost: 0, upliftFactor: 0};
    }
    const upliftFactor = target / pf - 1;
    return {
        fires: true,
        avgPf: round3(pf),
        penaltyCost: round2(input.kWh * input.tariff * upliftFactor),
        upliftFactor: round3(upliftFactor)
    };
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

function round3(v: number): number {
    return Math.round(v * 1000) / 1000;
}
