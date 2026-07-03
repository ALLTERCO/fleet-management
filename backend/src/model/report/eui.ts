// Energy Use Intensity: a site's energy normalized by its size, headcount, or
// throughput so two sites can be compared (kWh/m², kWh/person, kWh/unit). Pure
// math over a focused metadata input — the report engine maps a Location (with
// inherited fields) onto SiteMetadata, so this stays decoupled and testable.

const DAYS_PER_YEAR = 365;
// Throughput periods expressed in days, so a value/period pair normalizes to a
// per-day rate. Month is an even 30 — a benchmark approximation, not a calendar.
const PERIOD_DAYS: Record<ThroughputPeriod, number> = {
    day: 1,
    month: 30,
    year: DAYS_PER_YEAR
};

export type ThroughputPeriod = 'day' | 'month' | 'year';

export interface SiteMetadata {
    areaM2?: number | null;
    headcount?: number | null;
    throughputValue?: number | null;
    throughputUnit?: string | null;
    throughputPeriod?: ThroughputPeriod | null;
}

export interface EUI {
    energyKwh: number;
    perM2: number | null;
    perPerson: number | null;
    perThroughput: number | null;
    throughputUnit: string | null;
    periodDays: number;
    annualizedPerM2: number | null;
}

// Divide only by a positive denominator; a missing or zero divisor yields null
// rather than a NaN/Infinity that would poison the report.
function ratioOrNull(
    numerator: number,
    denominator: number | null | undefined
): number | null {
    return typeof denominator === 'number' && denominator > 0
        ? numerator / denominator
        : null;
}

function periodDaysBetween(from: Date, to: Date): number {
    return Math.max(0, to.getTime() - from.getTime()) / 86_400_000;
}

// Total throughput over the report window: the per-period value re-expressed as
// a per-day rate, times the number of days in the window. Null when unset.
function throughputOverPeriod(
    site: SiteMetadata,
    periodDays: number
): number | null {
    if (typeof site.throughputValue !== 'number' || !site.throughputPeriod) {
        return null;
    }
    const perDay = site.throughputValue / PERIOD_DAYS[site.throughputPeriod];
    return perDay * periodDays;
}

export function computeEUI(input: {
    totalKwh: number;
    site: SiteMetadata;
    period: {from: Date; to: Date};
}): EUI {
    const {totalKwh, site} = input;
    const periodDays = periodDaysBetween(input.period.from, input.period.to);
    const perM2 = ratioOrNull(totalKwh, site.areaM2);
    return {
        energyKwh: totalKwh,
        perM2,
        perPerson: ratioOrNull(totalKwh, site.headcount),
        perThroughput: ratioOrNull(
            totalKwh,
            throughputOverPeriod(site, periodDays)
        ),
        throughputUnit: site.throughputUnit ?? null,
        periodDays,
        annualizedPerM2:
            perM2 !== null && periodDays > 0
                ? perM2 * (DAYS_PER_YEAR / periodDays)
                : null
    };
}
