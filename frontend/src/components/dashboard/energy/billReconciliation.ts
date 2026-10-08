import {fromCurrencyMinorUnits, toCurrencyMinorUnits} from '@api/_currency';

export interface RecordedUtilityBill {
    id: number;
    periodStart: string;
    periodEnd: string;
    actualCost: number;
    currency: string;
    utilityAccountId: string | null;
    meterIdentifier: string | null;
    servicePointIdentifier: string | null;
}

export type RecordedBillLookup =
    | {status: 'loading'; message: string}
    | {status: 'unavailable'; message: string}
    | {
          status: 'ready';
          bill: RecordedUtilityBill;
          coverageWarning: string;
      };

export type RecordedBillComparison =
    | {status: 'loading' | 'unavailable'; message: string}
    | {
          status: 'ready';
          recorded: number;
          shadow: number;
          varianceAbs: number;
          variancePct: number | null;
          direction: 'over' | 'under' | 'match';
          coverageWarning: string;
      };

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Match the backend's tariff-zone conversion for bill calendar periods. */
export function recordedBillPeriodDate(
    value: string,
    timezone: string | null
): string {
    if (BARE_DATE.test(value)) return value;
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return value.slice(0, 10);
    try {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone ?? 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(instant);
    } catch {
        return instant.toISOString().slice(0, 10);
    }
}

/** Select only an exactly aligned bill; overlapping periods are incomparable. */
export function findExactRecordedBill(
    bills: readonly RecordedUtilityBill[],
    from: string,
    to: string,
    timezone: string | null
): RecordedUtilityBill | null {
    const matches = findExactRecordedBills(bills, from, to, timezone);
    return matches.length === 1 ? matches[0] : null;
}

/** Return every exact-period candidate so callers fail closed on ambiguity. */
export function findExactRecordedBills(
    bills: readonly RecordedUtilityBill[],
    from: string,
    to: string,
    timezone: string | null
): RecordedUtilityBill[] {
    const periodStart = recordedBillPeriodDate(from, timezone);
    const periodEnd = recordedBillPeriodDate(to, timezone);
    return bills.filter(
        (bill) =>
            bill.periodStart === periodStart && bill.periodEnd === periodEnd
    );
}

export function recordedBillIdentity(
    bill: RecordedUtilityBill
): Record<string, string> | null {
    const identity = {
        ...(bill.utilityAccountId
            ? {utilityAccountId: bill.utilityAccountId}
            : {}),
        ...(bill.meterIdentifier
            ? {meterIdentifier: bill.meterIdentifier}
            : {}),
        ...(bill.servicePointIdentifier
            ? {servicePointIdentifier: bill.servicePointIdentifier}
            : {})
    };
    return Object.keys(identity).length > 0 ? identity : null;
}

export function recordedBillIdentityLabel(bill: RecordedUtilityBill): string {
    const parts = [
        bill.utilityAccountId ? `Account ${bill.utilityAccountId}` : null,
        bill.meterIdentifier ? `Meter ${bill.meterIdentifier}` : null,
        bill.servicePointIdentifier
            ? `Service point ${bill.servicePointIdentifier}`
            : null
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(' · ') : 'Period-only legacy bill';
}

/**
 * Compare only compatible money. Both inputs are first rounded to the ISO 4217
 * minor unit, so JPY, USD and three-decimal currencies reconcile correctly.
 */
export function compareRecordedBill(
    lookup: RecordedBillLookup,
    shadowBillTotal: number | null,
    shadowCurrency: string | null
): RecordedBillComparison {
    if (lookup.status !== 'ready') return lookup;
    if (shadowBillTotal === null || !shadowCurrency) {
        return {
            status: 'unavailable',
            message:
                'The platform shadow bill is incomplete, so no recorded-bill variance is shown.'
        };
    }
    if (lookup.bill.currency !== shadowCurrency) {
        return {
            status: 'unavailable',
            message:
                `Recorded bill currency ${lookup.bill.currency} does not match ` +
                `platform shadow-bill currency ${shadowCurrency}. No FX conversion is configured.`
        };
    }

    const shadowMinor = toCurrencyMinorUnits(shadowBillTotal, shadowCurrency);
    const recordedMinor = toCurrencyMinorUnits(
        lookup.bill.actualCost,
        shadowCurrency
    );
    const varianceMinor = recordedMinor - shadowMinor;
    const variancePct =
        shadowMinor === 0 ? null : (varianceMinor / shadowMinor) * 100;
    return {
        status: 'ready',
        recorded: fromCurrencyMinorUnits(recordedMinor, shadowCurrency),
        shadow: fromCurrencyMinorUnits(shadowMinor, shadowCurrency),
        varianceAbs: fromCurrencyMinorUnits(varianceMinor, shadowCurrency),
        variancePct,
        direction:
            varianceMinor === 0
                ? 'match'
                : varianceMinor > 0
                  ? 'over'
                  : 'under',
        coverageWarning: lookup.coverageWarning
    };
}
