// Demand-charge calculation for the structured tariff demand contract.
// Values stay in their metered billing unit: kVA is never converted to kW.

import {
    APPARENT_POWER_METHOD,
    type ApparentPowerMethod,
    type TariffDemandSeasonSpec,
    type TariffDemandSpec,
    type TariffDemandUnit,
    type TariffDemandWindowSpec
} from '../../types/api/tariff';
import {
    dayBitIndex,
    daysMaskSelects,
    isOvernightWindow,
    MINUTES_PER_DAY,
    priorDay,
    windowRanges
} from '../timeWindow';
import {dateInZone, hourInZone, weekdayInZone} from './localTimeInZone';
import {
    billingPeriodBounds,
    billingPeriodCalendarKey,
    billingPeriodDays,
    billingPeriodIndexAt
} from './reportPeriod';

export interface TariffDemandSample {
    /** Start of a complete stored interval bucket. */
    at: Date;
    /** Average demand over this complete bucket. */
    value: number;
    unit: TariffDemandUnit;
    intervalMinutes: 15 | 30;
}

/** One device's contribution to a stored demand bucket. */
export interface TariffDemandDeviceSample extends TariffDemandSample {
    deviceId: number;
}

export interface TariffHistoricalDemandPeak {
    at: Date;
    value: number;
    unit: TariffDemandUnit;
}

export interface TariffDemandPeriodCharge {
    /** Calendar month the period opens in, 'YYYY-MM'. */
    periodKey: string;
    /** Instant the period opens: local billingDay midnight in the tariff zone. */
    periodStart: Date;
    /** Exclusive instant the period closes. */
    periodEnd: Date;
    billingDays: number;
    measuredPeak: number;
    billedPeak: number;
    charge: number;
    peakAt: Date | null;
    ratchetApplied: boolean;
}

export interface TariffDemandChargeResult {
    unit: TariffDemandUnit;
    /** How a kVA peak was measured; null for kW demand. */
    apparentPowerMethod: ApparentPowerMethod | null;
    intervalMinutes: 15 | 30;
    chargePeriod: 'day' | 'month';
    total: number;
    periods: TariffDemandPeriodCharge[];
    complete: boolean;
    reason: string | null;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function roundCurrency(value: number, fractionDigits: number): number {
    const scale = 10 ** fractionDigits;
    return Math.round(value * scale) / scale;
}

function parseMinute(hhmm: string): number {
    const [hour, minute] = hhmm.split(':').map(Number);
    return hour * 60 + minute;
}

function windowContains(
    window: TariffDemandWindowSpec,
    at: Date,
    timezone: string
): boolean {
    const weekday = weekdayInZone(at, timezone);
    const minute = Math.round(hourInZone(at, timezone) * 60);
    const start = parseMinute(window.startTime);
    const end = parseMinute(window.endTime);
    // After-midnight time belongs to the window that began yesterday, so the
    // range that matched decides which day's mask is consulted.
    return windowRanges(start, end, MINUTES_PER_DAY).some((range) => {
        if (minute < range.from || minute >= range.to) return false;
        const owner = range.afterMidnight
            ? priorDay(dayBitIndex(weekday))
            : dayBitIndex(weekday);
        return daysMaskSelects(window.daysMask, owner);
    });
}

function monthDay(at: Date, timezone: string): string {
    const local = dateInZone(at, timezone);
    return `${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

function seasonContains(season: TariffDemandSeasonSpec, md: string): boolean {
    if (season.startMonthDay <= season.endMonthDay) {
        return md >= season.startMonthDay && md <= season.endMonthDay;
    }
    return md >= season.startMonthDay || md <= season.endMonthDay;
}

function dateKey(at: Date, timezone: string): string {
    const local = dateInZone(at, timezone);
    return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

function eligible(
    demand: TariffDemandSpec,
    at: Date,
    timezone: string,
    effectiveFrom?: string | null,
    effectiveTo?: string | null
): boolean {
    const localDate = dateKey(at, timezone);
    if (effectiveFrom && localDate < effectiveFrom) return false;
    if (effectiveTo && localDate > effectiveTo) return false;
    const local = dateInZone(at, timezone);
    const prior = new Date(
        Date.UTC(local.year, local.month - 1, local.day - 1)
    );
    const priorMd = `${String(prior.getUTCMonth() + 1).padStart(2, '0')}-${String(prior.getUTCDate()).padStart(2, '0')}`;
    const currentMd = monthDay(at, timezone);
    return demand.seasons.some((season) =>
        season.windows.some((window) => {
            const start = parseMinute(window.startTime);
            const end = parseMinute(window.endTime);
            const minute = Math.round(hourInZone(at, timezone) * 60);
            const ownerMd =
                isOvernightWindow(start, end) && minute < end
                    ? priorMd
                    : currentMd;
            return (
                seasonContains(season, ownerMd) &&
                windowContains(window, at, timezone)
            );
        })
    );
}

function completeDemandBlocks(
    samples: readonly TariffDemandSample[],
    intervalMinutes: 15 | 30,
    timezone: string
): TariffDemandSample[] {
    const sorted = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
    const complete: TariffDemandSample[] = [];
    for (let index = 0; index < sorted.length; index += 1) {
        const first = sorted[index];
        const localMinute = Math.round(hourInZone(first.at, timezone) * 60);
        if (localMinute % intervalMinutes !== 0) continue;
        if (first.intervalMinutes === intervalMinutes) {
            complete.push(first);
            continue;
        }
        if (intervalMinutes === 30 && first.intervalMinutes === 15) {
            const second = sorted[index + 1];
            if (
                second?.intervalMinutes === 15 &&
                second.unit === first.unit &&
                second.at.getTime() - first.at.getTime() === 15 * 60_000
            ) {
                complete.push({
                    at: first.at,
                    value: (first.value + second.value) / 2,
                    unit: first.unit,
                    intervalMinutes: 30
                });
                index += 1;
            }
        }
    }
    return complete;
}

function peak(samples: readonly TariffDemandSample[]): {
    value: number;
    at: Date | null;
} {
    let best: TariffDemandSample | null = null;
    for (const sample of samples) {
        if (!best || sample.value > best.value) best = sample;
    }
    return {value: best?.value ?? 0, at: best?.at ?? null};
}

/**
 * Bill all demand periods represented by samples. Monthly ratchets consider
 * prior peaks in the configured lookback, but never a peak in another unit.
 */
export function calculateTariffDemandCharges(input: {
    demand: TariffDemandSpec;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    timezone: string;
    billingDay: number;
    samples: readonly TariffDemandSample[];
    chargeFrom?: Date;
    chargeTo?: Date;
    historicalPeaks?: readonly TariffHistoricalDemandPeak[];
    /** ISO 4217 minor-unit precision for monetary charge fields. */
    currencyFractionDigits?: number;
    /** Billing-period indexes proven to have every expected qualifying block. */
    completePeriodKeys?: readonly string[];
}): TariffDemandChargeResult {
    const {demand, timezone, billingDay} = input;
    const groups = new Map<string, TariffDemandSample[]>();
    const periodIndex = new Map<string, number>();
    const targetKeys = new Set<string>();
    for (const sample of input.samples) {
        if (
            sample.unit !== demand.unit ||
            !Number.isFinite(sample.value) ||
            sample.value < 0 ||
            !eligible(
                demand,
                sample.at,
                timezone,
                input.effectiveFrom,
                input.effectiveTo
            )
        ) {
            continue;
        }
        const monthIndex = billingPeriodIndexAt(
            sample.at,
            timezone,
            billingDay
        );
        const key = String(monthIndex);
        const values = groups.get(key) ?? [];
        values.push(sample);
        groups.set(key, values);
        periodIndex.set(key, monthIndex);
        if (
            (!input.chargeFrom || sample.at >= input.chargeFrom) &&
            (!input.chargeTo || sample.at < input.chargeTo)
        ) {
            targetKeys.add(key);
        }
    }

    const measuredByPeriod = new Map(
        [...groups.entries()].map(([key, samples]) => [
            key,
            peak(
                completeDemandBlocks(samples, demand.intervalMinutes, timezone)
            )
        ])
    );
    const history = (input.historicalPeaks ?? []).filter(
        (peak) => peak.unit === demand.unit && Number.isFinite(peak.value)
    );
    let complete = true;
    let reason: string | null = null;
    const periods = [...groups.entries()]
        .filter(([key]) => targetKeys.size === 0 || targetKeys.has(key))
        .sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))
        .map(([periodKey]) => {
            const measured = measuredByPeriod.get(periodKey)!;
            const currentIndex = periodIndex.get(periodKey)!;
            let billedPeak = measured.value;
            if (demand.ratchetMonths > 0) {
                // ratchetMonths includes the current period. A 12-month
                // ratchet therefore considers at most the previous 11.
                const floor = currentIndex - (demand.ratchetMonths - 1);
                for (const [priorKey, priorPeak] of measuredByPeriod) {
                    const priorIndex = Number(priorKey);
                    if (priorIndex >= floor && priorIndex < currentIndex) {
                        billedPeak = Math.max(billedPeak, priorPeak.value);
                    }
                }
                for (const prior of history) {
                    const priorIndex = billingPeriodIndexAt(
                        prior.at,
                        timezone,
                        billingDay
                    );
                    if (priorIndex >= floor && priorIndex < currentIndex) {
                        billedPeak = Math.max(billedPeak, prior.value);
                    }
                }
                if (demand.ratchetMonths > 1) {
                    const known = new Set<number>(
                        (input.completePeriodKeys ?? []).map(Number)
                    );
                    for (const prior of history) {
                        known.add(
                            billingPeriodIndexAt(prior.at, timezone, billingDay)
                        );
                    }
                    for (let prior = floor; prior < currentIndex; prior += 1) {
                        if (!known.has(prior)) {
                            complete = false;
                            reason = `Demand charge unavailable: billing-period peak history is missing for ${billingPeriodCalendarKey(prior)}.`;
                        }
                    }
                }
            }
            const days = billingPeriodDays(currentIndex, billingDay);
            const bounds = billingPeriodBounds(
                currentIndex,
                billingDay,
                timezone
            );
            const rateUnits = demand.chargePeriod === 'day' ? days : 1;
            return {
                periodKey: billingPeriodCalendarKey(currentIndex),
                periodStart: bounds.from,
                periodEnd: bounds.to,
                billingDays: days,
                measuredPeak: round2(measured.value),
                billedPeak: round2(billedPeak),
                charge: roundCurrency(
                    billedPeak * demand.rate * rateUnits,
                    input.currencyFractionDigits ?? 2
                ),
                peakAt: measured.at,
                ratchetApplied: billedPeak > measured.value
            };
        });

    return {
        unit: demand.unit,
        apparentPowerMethod:
            demand.unit === 'kVA' ? APPARENT_POWER_METHOD : null,
        intervalMinutes: demand.intervalMinutes,
        chargePeriod: demand.chargePeriod,
        total: complete
            ? roundCurrency(
                  periods.reduce((sum, period) => sum + period.charge, 0),
                  input.currencyFractionDigits ?? 2
              )
            : 0,
        periods,
        complete,
        reason
    };
}

/** Proves full qualifying interval coverage for each represented billing period. */
export function completeTariffDemandPeriodKeys(input: {
    demand: TariffDemandSpec;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    timezone: string;
    billingDay: number;
    samples: readonly TariffDemandSample[];
}): string[] {
    const completeBlocks = completeDemandBlocks(
        input.samples.filter((sample) => sample.unit === input.demand.unit),
        input.demand.intervalMinutes,
        input.timezone
    );
    const present = new Set(
        completeBlocks.map((sample) => sample.at.getTime())
    );
    const indexes = new Set(
        input.samples.map((sample) =>
            billingPeriodIndexAt(sample.at, input.timezone, input.billingDay)
        )
    );
    const result: string[] = [];
    for (const index of indexes) {
        const bounds = billingPeriodBounds(
            index,
            input.billingDay,
            input.timezone
        );
        let expected = 0;
        let found = 0;
        const stepMs = input.demand.intervalMinutes * 60_000;
        for (
            let ms = bounds.from.getTime();
            ms < bounds.to.getTime();
            ms += stepMs
        ) {
            const at = new Date(ms);
            if (
                eligible(
                    input.demand,
                    at,
                    input.timezone,
                    input.effectiveFrom,
                    input.effectiveTo
                )
            ) {
                expected += 1;
                if (present.has(ms)) found += 1;
            }
        }
        if (expected > 0 && found === expected) result.push(String(index));
    }
    return result;
}
