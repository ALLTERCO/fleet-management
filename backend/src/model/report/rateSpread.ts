// Single source of truth for the peak/off-peak rate gap across tariff modes.

import type {TariffMode, TariffWindow} from '../../types/api/dashboard';

export interface RateSpreadInput {
    readonly tariffMode: TariffMode;
    readonly dayRate: number;
    readonly nightRate: number;
    readonly tariffWindows: readonly TariffWindow[] | null;
}

export interface RateSpread {
    readonly peakRate: number;
    readonly offPeakRate: number;
}

export function pickRateSpread(input: RateSpreadInput): RateSpread | null {
    switch (input.tariffMode) {
        case 'day_night':
            return pickDayNightSpread(input.dayRate, input.nightRate);
        case 'tou':
            return pickTouSpread(input.tariffWindows);
        default:
            return null;
    }
}

function pickDayNightSpread(
    dayRate: number,
    nightRate: number
): RateSpread | null {
    if (!isFinitePositive(dayRate) || !isFinitePositive(nightRate)) return null;
    if (dayRate <= nightRate) return null;
    return {peakRate: dayRate, offPeakRate: nightRate};
}

function pickTouSpread(
    windows: readonly TariffWindow[] | null
): RateSpread | null {
    if (!windows || windows.length < 2) return null;
    const rates = windows
        .map((w) => w.rate)
        .filter((r): r is number => isFinitePositive(r));
    if (rates.length < 2) return null;
    const peakRate = Math.max(...rates);
    const offPeakRate = Math.min(...rates);
    if (peakRate <= offPeakRate) return null;
    return {peakRate, offPeakRate};
}

function isFinitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
