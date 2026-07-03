// Compares a report's computed cost against the actual utility-bill amount and
// reports the variance. Pure math — the bill amount is supplied by the caller.

export type VarianceStatus = 'over' | 'under' | 'match';

export interface BillVariance {
    reportCost: number;
    actualCost: number;
    varianceAbs: number; // actual - report (positive = bill higher than report)
    variancePct: number; // share of the report cost, 0 when the report is 0
    status: VarianceStatus;
}

// `tolerancePct` is the band within which report and bill count as matching.
export function reconcileBill(
    reportCost: number,
    actualCost: number,
    tolerancePct = 1
): BillVariance {
    const varianceAbs = actualCost - reportCost;
    const variancePct = reportCost === 0 ? 0 : (varianceAbs / reportCost) * 100;
    return {
        reportCost,
        actualCost,
        varianceAbs,
        variancePct,
        status: statusOf(variancePct, tolerancePct)
    };
}

function statusOf(variancePct: number, tolerancePct: number): VarianceStatus {
    if (Math.abs(variancePct) <= tolerancePct) return 'match';
    return variancePct > 0 ? 'over' : 'under';
}
