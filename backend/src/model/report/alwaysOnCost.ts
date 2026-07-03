import {HOURS_PER_DAY} from '../../modules/util/timeUnits';
// Cost split for continuous (always-on) baseline load across tariff modes.
// Single source of truth for "what does the 24/7 standby draw cost?".

export type AlwaysOnTariffMode = 'single' | 'day_night' | 'tou';

export interface AlwaysOnCostInput {
    readonly totalKWh: number;
    readonly tariffMode: AlwaysOnTariffMode;
    readonly tariff: number;
    readonly dayRate: number;
    readonly nightRate: number;
    /** "HH:MM[:SS]" — day window start (inclusive). */
    readonly dayStart: string;
    /** "HH:MM[:SS]" — day window end (exclusive). */
    readonly dayEnd: string;
}

export interface AlwaysOnCostResult {
    readonly totalCost: number;
    readonly dayKWh: number;
    readonly nightKWh: number;
    readonly dayCost: number;
    readonly nightCost: number;
    /** True when tariffMode === 'day_night' and a meaningful split exists. */
    readonly splitByDayNight: boolean;
}

export function computeAlwaysOnCost(
    input: AlwaysOnCostInput
): AlwaysOnCostResult {
    const safe = sanitize(input);
    if (safe.totalKWh === 0) return ZERO;
    if (safe.tariffMode === 'day_night') return splitDayNight(safe);
    return flatRate(safe);
}

// Clamp negatives/NaN to zero so downstream math stays finite. Callers are
// trusted (validated at the RPC boundary) — this is a defensive net.
function sanitize(input: AlwaysOnCostInput): AlwaysOnCostInput {
    return {
        ...input,
        totalKWh: positiveOrZero(input.totalKWh),
        tariff: positiveOrZero(input.tariff),
        dayRate: positiveOrZero(input.dayRate),
        nightRate: positiveOrZero(input.nightRate)
    };
}

function positiveOrZero(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function flatRate(input: AlwaysOnCostInput): AlwaysOnCostResult {
    const rate = blendedRate(input);
    return {
        totalCost: round2(input.totalKWh * rate),
        dayKWh: 0,
        nightKWh: 0,
        dayCost: 0,
        nightCost: 0,
        splitByDayNight: false
    };
}

function splitDayNight(input: AlwaysOnCostInput): AlwaysOnCostResult {
    const dayFraction = dayWindowFraction(input.dayStart, input.dayEnd);
    const dayKWh = input.totalKWh * dayFraction;
    const nightKWh = input.totalKWh - dayKWh;
    const dayCost = dayKWh * input.dayRate;
    const nightCost = nightKWh * input.nightRate;
    return {
        totalCost: round2(dayCost + nightCost),
        dayKWh: round3(dayKWh),
        nightKWh: round3(nightKWh),
        dayCost: round2(dayCost),
        nightCost: round2(nightCost),
        splitByDayNight: true
    };
}

function dayWindowFraction(dayStart: string, dayEnd: string): number {
    const start = parseHours(dayStart);
    const end = parseHours(dayEnd);
    if (start === null || end === null) return 0.5;
    // Handle day window that crosses midnight (e.g. 22:00 → 06:00).
    const span = end > start ? end - start : HOURS_PER_DAY - start + end;
    return Math.max(0, Math.min(1, span / HOURS_PER_DAY));
}

function parseHours(hms: string): number | null {
    const parts = hms.split(':');
    if (parts.length < 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h + m / 60;
}

function blendedRate(input: AlwaysOnCostInput): number {
    if (input.tariff > 0) return input.tariff;
    if (input.dayRate > 0 || input.nightRate > 0) {
        return (input.dayRate + input.nightRate) / 2;
    }
    return 0;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

const ZERO: AlwaysOnCostResult = {
    totalCost: 0,
    dayKWh: 0,
    nightKWh: 0,
    dayCost: 0,
    nightCost: 0,
    splitByDayNight: false
};
