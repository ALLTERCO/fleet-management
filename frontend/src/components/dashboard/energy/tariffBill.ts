import type {TariffSpec} from '@api/tariff';
import {currencyFractionDigits} from '@api/_currency';

interface LocalDate {
    year: number;
    month: number;
    day: number;
}

function dateInZone(at: Date, timezone: string): LocalDate {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(at);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value ?? 0);
    return {year: value('year'), month: value('month'), day: value('day')};
}

function billingPeriodIndex(date: LocalDate, billingDay: number): number {
    const monthIndex = date.year * 12 + date.month - 1;
    return date.day < billingDay ? monthIndex - 1 : monthIndex;
}

/** Same half-open, timezone-aware billing-period count used by reports. */
export function countBillingMonths(
    from: Date,
    to: Date,
    billingDay: number,
    timezone: string
): number {
    if (to <= from) return 0;
    const last = new Date(to.getTime() - 1);
    return (
        billingPeriodIndex(dateInZone(last, timezone), billingDay) -
        billingPeriodIndex(dateInZone(from, timezone), billingDay) +
        1
    );
}

export interface DashboardAdditionalCharges {
    complete: boolean;
    demand: number;
    standing: number;
    message: string | null;
}

/**
 * Fixed-charge subset that the live dashboard can prove from its summary.
 * Structured demand needs stored interval samples/ratchets, which the report
 * owns; never approximate it from an instantaneous dashboard peak.
 */
export function dashboardAdditionalCharges(input: {
    tariff: TariffSpec;
    from: Date;
    to: Date;
    periodDays: number;
    peakKw: number;
}): DashboardAdditionalCharges {
    const {tariff} = input;
    if (tariff.demand || (tariff.demandRate ?? 0) > 0) {
        return {
            complete: false,
            demand: 0,
            standing: 0,
            message:
                'Additional charges are available in the report because this tariff needs exact scoped interval demand history.'
        };
    }
    const months = countBillingMonths(
        input.from,
        input.to,
        tariff.billingDay,
        tariff.timezone
    );
    const units =
        tariff.standingChargePeriod === 'day'
            ? Math.ceil(Math.max(0, input.periodDays))
            : months;
    return {
        complete: true,
        demand: 0,
        standing: +(tariff.standingCharge * units).toFixed(
            currencyFractionDigits(tariff.currency)
        ),
        message: null
    };
}
