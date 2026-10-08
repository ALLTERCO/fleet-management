// Compares a report's computed cost against the actual utility-bill amount and
// reports the variance. Pure math — the bill amount is supplied by the caller.

import {
    fromCurrencyMinorUnits,
    toCurrencyMinorUnits
} from '../../types/api/_currency';

export type VarianceStatus = 'over' | 'under' | 'match';

export interface BillVariance {
    reportCost: number;
    actualCost: number;
    varianceAbs: number; // actual - report (positive = bill higher than report)
    variancePct: number | null; // null when a zero report has no percentage base
    status: VarianceStatus;
}

// `tolerancePct` is the band within which report and bill count as matching.
export function reconcileBill(
    reportCost: number,
    actualCost: number,
    currency: string,
    tolerancePct = 1
): BillVariance {
    const reportMinor = toCurrencyMinorUnits(reportCost, currency);
    const actualMinor = toCurrencyMinorUnits(actualCost, currency);
    const varianceMinor = actualMinor - reportMinor;
    const variancePct =
        reportMinor === 0 ? null : (varianceMinor / reportMinor) * 100;
    return {
        reportCost: fromCurrencyMinorUnits(reportMinor, currency),
        actualCost: fromCurrencyMinorUnits(actualMinor, currency),
        varianceAbs: fromCurrencyMinorUnits(varianceMinor, currency),
        variancePct,
        status: statusOf(varianceMinor, variancePct, tolerancePct)
    };
}

function statusOf(
    varianceMinor: number,
    variancePct: number | null,
    tolerancePct: number
): VarianceStatus {
    if (varianceMinor === 0) return 'match';
    if (variancePct !== null && Math.abs(variancePct) <= tolerancePct) {
        return 'match';
    }
    return varianceMinor > 0 ? 'over' : 'under';
}
