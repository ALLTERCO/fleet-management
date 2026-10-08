/**
 * Project an end-of-period total from a partial period.
 *
 * This is a run-rate, not a forecast. It answers "at the pace observed so far,
 * where does this period land", and it is honest about how much that pace can
 * be trusted. It does not model weather, seasonality or occupancy, and it does
 * not pretend to.
 *
 * Two things it now gets right that the earlier version did not:
 *
 * - It projects from WHOLE DAYS when the caller passes the series it already
 *   has. Extrapolating by elapsed milliseconds meant six quiet overnight hours
 *   were stretched as if the site had been running all night, so the same
 *   period projected differently at 06:00 and at 18:00.
 * - The confidence band is derived from how steady those days actually were.
 *   It used to be hand-picked from days elapsed — 15/10/5 percent — so a
 *   metronomic site and a wildly erratic one were quoted the same certainty.
 *
 * `confidenceBand` is null when there is nothing to be confident about. A
 * number there means it was measured.
 */

import {DAY_MS} from '../../modules/util/timeUnits';

export interface ProjectionSample {
    /** Bucket timestamp; anything Date can parse. */
    readonly date: string | Date;
    readonly consumption_kwh: number;
}

export interface ProjectionInput {
    readonly kwhSoFar: number;
    readonly costSoFar: number;
    readonly from: Date;
    readonly to: Date;
    readonly now: Date;
    /**
     * The period's own buckets, when the caller has them. With a series the
     * projection runs on whole days and the band is measured; without one it
     * falls back to elapsed time and a coarse stated band.
     */
    readonly series?: readonly ProjectionSample[];
    /**
     * Flat, always-on draw per day. Baseload does not scale with activity: a
     * fridge and a standby PSU pull the same on a quiet day as a busy one.
     * Scaling the whole figure treats a mostly-baseload office as though it
     * were a factory.
     */
    readonly baselineKWhPerDay?: number;
}

export interface ProjectionResult {
    readonly projectedKWh: number;
    readonly projectedCost: number;
    /**
     * Half-width of the expected range, as a fraction of the projection.
     * Null when the period has not started, or has closed and these are
     * actuals — in both cases there is no projection to be uncertain about.
     */
    readonly confidenceBand: number | null;
    /** True iff a partial period's remainder was extrapolated. */
    readonly extrapolated: boolean;
}

/** Anything that is not a usable number counts as zero, never as NaN. */
function finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function round(value: number, places: number): number {
    const factor = 10 ** places;
    return Math.round(finite(value) * factor) / factor;
}

/**
 * Fallback band when no series was supplied: still keyed to days elapsed,
 * because that is genuinely all we know, but the caller can tell it apart
 * from a measured one by the absence of a series.
 */
function statedBand(daysElapsed: number): number {
    if (daysElapsed <= 3) return 0.15;
    if (daysElapsed <= 14) return 0.1;
    return 0.05;
}

/** Total per calendar day, so a partial final day cannot skew the run rate. */
function dailyTotals(series: readonly ProjectionSample[]): DayTotal[] {
    const byDay = new Map<string, number>();
    for (const row of series) {
        const at = row.date instanceof Date ? row.date : new Date(row.date);
        if (Number.isNaN(at.getTime())) continue;
        const key = at.toISOString().slice(0, 10);
        byDay.set(key, (byDay.get(key) ?? 0) + finite(row.consumption_kwh));
    }
    return [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, kwh]) => {
            const at = new Date(`${key}T00:00:00Z`);
            return {at, kwh, weekend: isWeekend(at)};
        });
}

/**
 * How much the daily totals move about, as a fraction of the mean.
 *
 * Sample standard deviation over the mean — the coefficient of variation. A
 * flat site lands near zero; a site that swings between 1 and 25 kWh lands
 * high, which is exactly the distinction the old fixed buckets erased.
 *
 * Divided by sqrt(n) because the projection uses the MEAN of those days, and
 * the mean of many days is better known than any single day. More observed
 * days therefore narrows the band, which is the behaviour the old code was
 * reaching for by keying on days elapsed.
 */
function measuredBand(values: number[]): number | null {
    const days = values;
    if (days.length === 0) return null;
    const mean = days.reduce((a, b) => a + b, 0) / days.length;
    if (mean === 0) return null;
    if (days.length === 1) {
        // One day is a data point, not a trend. Say so with a wide band
        // rather than a zero one.
        return 0.25;
    }
    const variance =
        days.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (days.length - 1);
    const cv = Math.sqrt(variance) / Math.abs(mean);
    const band = cv / Math.sqrt(days.length);
    // Never quote total certainty, and never quote a band so wide it says
    // nothing. Two days of identical readings is still only two days.
    return Math.min(0.5, Math.max(0.01, round(band, 4)));
}

/** Sunday and Saturday behave unlike the working week almost everywhere. */
function isWeekend(at: Date): boolean {
    const day = at.getUTCDay();
    return day === 0 || day === 6;
}

interface DayTotal {
    readonly at: Date;
    readonly kwh: number;
    readonly weekend: boolean;
}

/**
 * Recent days predict better than old ones. A linear ramp from 1 to 2 across
 * the window: enough to follow a step change, not so steep that one odd day
 * at the end takes over.
 */
function recencyWeight(index: number, count: number): number {
    return count <= 1 ? 1 : 1 + index / (count - 1);
}

function weightedMean(days: readonly DayTotal[]): number {
    if (days.length === 0) return 0;
    let sum = 0;
    let weight = 0;
    days.forEach((d, i) => {
        const w = recencyWeight(i, days.length);
        sum += d.kwh * w;
        weight += w;
    });
    return weight === 0 ? 0 : sum / weight;
}

/** How many of each day type remain between `now` and the end of the period. */
function remainingDayTypes(
    now: Date,
    to: Date
): {weekday: number; weekend: number} {
    let weekday = 0;
    let weekend = 0;
    // Start at the day `now` falls in. If `now` is partway through that day,
    // part of it is already in the observed series, so skip it — otherwise it
    // would be counted twice.
    const cursor = new Date(now.getTime());
    cursor.setUTCHours(0, 0, 0, 0);
    if (cursor.getTime() < now.getTime()) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    while (cursor.getTime() < to.getTime()) {
        if (isWeekend(cursor)) weekend += 1;
        else weekday += 1;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return {weekday, weekend};
}

/**
 * The projection as a range a person can read. "290 to 310" is understood
 * correctly far more often than "300 ±3%".
 * Null when there is no band to speak of.
 */
export function projectionRange(input: {
    projectedKWh: number;
    confidenceBand: number | null;
}): string | null {
    const {projectedKWh, confidenceBand} = input;
    if (!confidenceBand || !Number.isFinite(projectedKWh)) return null;
    const half = Math.abs(projectedKWh) * confidenceBand;
    const trim = (n: number) => String(round(n, 1)).replace(/\.0$/, '');
    return `${trim(projectedKWh - half)} to ${trim(projectedKWh + half)}`;
}

export function projectPeriodTotal({
    kwhSoFar,
    costSoFar,
    from,
    to,
    now,
    series,
    baselineKWhPerDay
}: ProjectionInput): ProjectionResult {
    const kwh = finite(kwhSoFar);
    const cost = finite(costSoFar);
    const totalMs = to.getTime() - from.getTime();
    const elapsedMs = now.getTime() - from.getTime();

    // Not started, or a zero-length window. There is nothing to project and
    // nothing to be confident about.
    if (!Number.isFinite(totalMs) || totalMs <= 0 || elapsedMs <= 0) {
        return {
            projectedKWh: 0,
            projectedCost: 0,
            confidenceBand: null,
            extrapolated: false
        };
    }

    // Closed: these are actuals, on an invoice. They must not move.
    if (elapsedMs >= totalMs) {
        return {
            projectedKWh: round(kwh, 3),
            projectedCost: round(cost, 2),
            confidenceBand: 0,
            extrapolated: false
        };
    }

    const days = series ? dailyTotals(series) : [];

    // With whole days in hand, project from the daily mean. Both the value and
    // its uncertainty then come from the same observations.
    if (days.length > 0) {
        const baseline = Math.max(0, finite(baselineKWhPerDay ?? 0));
        // Only the variable part is projected. The flat part is added back for
        // every day of the period, because it does not scale with activity.
        const variable = days.map((d) => ({
            ...d,
            kwh: Math.max(0, d.kwh - baseline)
        }));
        const weekdays = variable.filter((d) => !d.weekend);
        const weekends = variable.filter((d) => d.weekend);

        // Per day type, weighted toward recent days. When a type was never
        // observed there is no evidence for it, so it borrows the overall mean
        // rather than being assumed to be zero.
        const overall = weightedMean(variable);
        const perWeekday =
            weekdays.length > 0 ? weightedMean(weekdays) : overall;
        const perWeekend =
            weekends.length > 0 ? weightedMean(weekends) : overall;

        const remaining = remainingDayTypes(now, to);
        const observedKWh = days.reduce((a, d) => a + d.kwh, 0);
        const projectedRemaining =
            perWeekday * remaining.weekday +
            perWeekend * remaining.weekend +
            baseline * (remaining.weekday + remaining.weekend);
        const projectedKWh = observedKWh + projectedRemaining;

        // Cost follows the same ratio: the period's tariff mix is already
        // priced into the cost so far, and a second model here would guess.
        const ratio = observedKWh === 0 ? 0 : projectedKWh / observedKWh;
        // The band measures the VARIABLE part, which is what actually moves.
        return {
            projectedKWh: round(projectedKWh, 3),
            projectedCost: round(cost * ratio, 2),
            confidenceBand: measuredBand(variable.map((d) => d.kwh)),
            extrapolated: true
        };
    }

    // No series: fall back to elapsed time, with a band that is stated rather
    // than measured.
    const scale = totalMs / elapsedMs;
    return {
        projectedKWh: round(kwh * scale, 3),
        projectedCost: round(cost * scale, 2),
        confidenceBand: statedBand(elapsedMs / DAY_MS),
        extrapolated: true
    };
}
