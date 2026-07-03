// Resolves the active price per kWh for a manual tariff at a given instant.
// Live tariff pricing is a later phase — returns null for kind='live'.
// Only pure logic here: no I/O, no globals.

import type {
    TariffSeasonSpec,
    TariffSpec,
    TariffWindowSpec
} from '../../types/api/tariff';
import {hourInZone, weekdayInZone} from './localTimeInZone';

// daysMask bit-index: bit0=Mon, bit1=Tue, ..., bit6=Sun.
// weekdayInZone returns 0=Sun..6=Sat; map to the mask's convention.
function dayBitIndex(weekday: number): number {
    return weekday === 0 ? 6 : weekday - 1;
}

function parseHour(hhmm: string): number {
    const [h, m] = hhmm.split(':');
    return Number(h) + Number(m) / 60;
}

// Local 'MM-DD' for the instant in the given zone. Falls back to UTC when
// the zone is invalid — mirrors localTimeInZone's fallback strategy.
function monthDayInZone(instant: Date, timezone: string): string {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(instant);
        // en-CA formats as YYYY-MM-DD; extract month and day parts.
        const month = parts.find((p) => p.type === 'month')?.value;
        const day = parts.find((p) => p.type === 'day')?.value;
        if (month && day) return `${month}-${day}`;
    } catch {
        // Fall through to UTC fallback.
    }
    const m = String(instant.getUTCMonth() + 1).padStart(2, '0');
    const d = String(instant.getUTCDate()).padStart(2, '0');
    return `${m}-${d}`;
}

// Season ranges are inclusive 'MM-DD' string comparisons.
// Wrap-around (e.g. '11-01'..'02-28') spans the new year boundary.
export function seasonContains(season: TariffSeasonSpec, md: string): boolean {
    const {startMonthDay: s, endMonthDay: e} = season;
    if (s <= e) return md >= s && md <= e;
    // Wrapped: md is in [start..Dec-31] OR [Jan-01..end].
    return md >= s || md <= e;
}

// Window time matching uses fractional hours so sub-hour boundaries bill
// correctly. startTime === endTime means 24 h coverage (full day).
function windowTimeContains(window: TariffWindowSpec, hour: number): boolean {
    const start = parseHour(window.startTime);
    const end = parseHour(window.endTime);
    if (start === end) return true; // all-day sentinel
    if (end <= start) return hour >= start || hour < end; // overnight wrap
    return hour >= start && hour < end;
}

function windowDayContains(window: TariffWindowSpec, weekday: number): boolean {
    return ((window.daysMask >> dayBitIndex(weekday)) & 1) === 1;
}

// Shared season+window matching — the core of both exported resolvers.
function resolveWindow(
    tariff: TariffSpec,
    at: Date
): {season: TariffSeasonSpec; window: TariffWindowSpec} | null {
    const tz = tariff.timezone;
    const hour = hourInZone(at, tz);
    const weekday = weekdayInZone(at, tz);
    const md = monthDayInZone(at, tz);

    const season = tariff.seasons.find((s) => seasonContains(s, md));
    if (!season) return null;

    const window = season.windows.find(
        (w) => windowDayContains(w, weekday) && windowTimeContains(w, hour)
    );
    if (!window) return null;

    return {season, window};
}

export interface TariffPricing {
    price: number;
    // true when this window carries the season's peak (highest) price.
    // For a single-window season the only price is the maximum, so isDay = true.
    isDay: boolean;
}

/**
 * Returns the price and day/night classification for `tariff` at instant `at`,
 * or null for 'live' tariffs or when no window matches.
 *
 * isDay = true when the matched window's price equals the season maximum
 * (i.e. it is the peak / day window).
 */
export function resolveTariffPricing(
    tariff: TariffSpec,
    at: Date
): TariffPricing | null {
    if (tariff.kind === 'live') return null;

    const match = resolveWindow(tariff, at);
    if (!match) return null;

    const {season, window} = match;
    const maxPrice = Math.max(...season.windows.map((w) => w.price));
    return {price: window.price, isDay: window.price === maxPrice};
}

/**
 * Returns the price per kWh active for `tariff` at instant `at`, or null
 * when the kind is 'live' (resolved externally) or no window matches the
 * instant's local time / day / season.
 */
export function resolveTariffPrice(
    tariff: TariffSpec,
    at: Date
): number | null {
    return resolveTariffPricing(tariff, at)?.price ?? null;
}
