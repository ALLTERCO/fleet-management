import {
    currencyFractionDigits,
    roundCurrencyAmount
} from '../../types/api/_currency';
import type {ReportMeasuredUsageCost} from '../../types/api/report';

export function measuredUsageCost(
    amount: number,
    currency: string
): ReportMeasuredUsageCost {
    const roundedAmount = roundCurrencyAmount(amount, currency);
    return {
        amount,
        roundedAmount,
        currency,
        fractionDigits: currencyFractionDigits(currency),
        roundsToZeroAtMinorUnit: amount !== 0 && roundedAmount === 0
    };
}
