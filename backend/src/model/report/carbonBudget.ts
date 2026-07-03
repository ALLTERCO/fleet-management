// CO₂ budget tracking. Pure: compares projected vs allowed; no I/O.

export interface CarbonBudgetInput {
    readonly projectedKgCO2: number;
    readonly budgetKg: number | null;
}

export interface CarbonBudgetStatus {
    readonly hasBudget: boolean;
    readonly projectedKg: number;
    readonly budgetKg: number;
    readonly overBudget: boolean;
    readonly overshootPct: number;
}

const NO_BUDGET: CarbonBudgetStatus = {
    hasBudget: false,
    projectedKg: 0,
    budgetKg: 0,
    overBudget: false,
    overshootPct: 0
};

export function evaluateCarbonBudget(
    input: CarbonBudgetInput
): CarbonBudgetStatus {
    if (!hasBudgetInput(input)) return NO_BUDGET;
    const overshoot = input.projectedKgCO2 - input.budgetKg!;
    return {
        hasBudget: true,
        projectedKg: +input.projectedKgCO2.toFixed(2),
        budgetKg: input.budgetKg!,
        overBudget: overshoot > 0,
        overshootPct:
            overshoot > 0
                ? +((overshoot / input.budgetKg!) * 100).toFixed(1)
                : 0
    };
}

function hasBudgetInput(input: CarbonBudgetInput): boolean {
    if (input.budgetKg === null) return false;
    if (!Number.isFinite(input.budgetKg) || input.budgetKg <= 0) return false;
    if (!Number.isFinite(input.projectedKgCO2)) return false;
    return true;
}
