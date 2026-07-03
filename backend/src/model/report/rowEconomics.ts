/**
 * Pure per-row economics for the energy report: Wh->kWh conversion, net,
 * the applicable day/night rate (classified by the hour in the org timezone),
 * and cost. Single source of truth so the report and its tests agree.
 *
 * Rounding mirrors the original inline math (toFixed) so the report's numbers
 * do not shift when this logic moved out of the engine.
 */

import {hourInZone} from './localTimeInZone';

export interface RateContext {
    tariffMode: 'single' | 'day_night' | 'tou';
    tariff: number;
    dayRate: number;
    nightRate: number;
    /** Day window hours, half-open [start, end), in `timezone`. */
    dayStartHour: number;
    dayEndHour: number;
    /** IANA zone the day window is expressed in; null = UTC. */
    timezone?: string | null;
}

export interface RowEconomics {
    netKWh: number;
    rate: number;
    cost: number;
    isDay: boolean;
}

function round2(value: number): number {
    return +value.toFixed(2);
}

function round3(value: number): number {
    return +value.toFixed(3);
}

export function whToKWh(wh: number): number {
    return round3(wh / 1000);
}

// Day vs night by the hour in ctx.timezone. End is exclusive, so hour 23 with a
// 07:00-23:00 window is night.
export function isDayHour(
    bucketDate: Date | string,
    ctx: RateContext
): boolean {
    const hour = hourInZone(new Date(bucketDate), ctx.timezone ?? null);
    return hour >= ctx.dayStartHour && hour < ctx.dayEndHour;
}

// The rate given a known day/night classification — no zone work.
function rateFor(ctx: RateContext, isDay: boolean): number {
    if (ctx.tariffMode !== 'day_night') return ctx.tariff;
    return isDay ? ctx.dayRate : ctx.nightRate;
}

export function resolveEnergyRate(
    bucketDate: Date | string,
    ctx: RateContext
): number {
    return rateFor(ctx, isDayHour(bucketDate, ctx));
}

export function deriveRowEconomics(input: {
    consumptionKWh: number;
    returnedKWh: number;
    bucketDate: Date | string;
    rate: RateContext;
}): RowEconomics {
    // Classify once — the zone lookup is the hot-path cost.
    const isDay = isDayHour(input.bucketDate, input.rate);
    const rate = rateFor(input.rate, isDay);
    return {
        netKWh: round3(input.consumptionKWh - input.returnedKWh),
        rate,
        cost: round2(input.consumptionKWh * rate),
        isDay
    };
}
