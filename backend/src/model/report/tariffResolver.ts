// Resolves the active price per kWh for a manual tariff at a given instant.
// Live tariff pricing is a later phase — returns null for kind='live'.
// Only pure logic here: no I/O, no globals.

import {
    TARIFF_BANDS,
    type TariffBand,
    type TariffSeasonSpec,
    type TariffSpec,
    type TariffWindowSpec
} from '../../types/api/tariff';
import {
    dayBitIndex,
    isOvernightWindow,
    priorDay,
    windowContains
} from '../timeWindow';
import {dateInZone, hourInZone, weekdayInZone} from './localTimeInZone';

// daysMask bit-index: bit0=Mon, bit1=Tue, ..., bit6=Sun.
// weekdayInZone returns 0=Sun..6=Sat; map to the mask's convention.
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
export function seasonContains(
    season: Pick<TariffSeasonSpec, 'startMonthDay' | 'endMonthDay'>,
    md: string
): boolean {
    const {startMonthDay: s, endMonthDay: e} = season;
    if (s <= e) return md >= s && md <= e;
    // Wrapped: md is in [start..Dec-31] OR [Jan-01..end].
    return md >= s || md <= e;
}

// Fractional hours so sub-hour boundaries bill correctly. The window rule
// itself lives in model/timeWindow, shared with the coverage validator and the
// alert engine — it is unit-agnostic, so hours pass through unchanged.
function windowTimeContains(window: TariffWindowSpec, hour: number): boolean {
    return windowContains(
        parseHour(window.startTime),
        parseHour(window.endTime),
        hour
    );
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
    const local = dateInZone(at, tz);
    const prior = new Date(
        Date.UTC(local.year, local.month - 1, local.day - 1)
    );
    const priorMd = `${String(prior.getUTCMonth() + 1).padStart(2, '0')}-${String(prior.getUTCDate()).padStart(2, '0')}`;
    const priorWeekday = priorDay(weekday);

    for (const season of tariff.seasons) {
        for (const window of season.windows) {
            const start = parseHour(window.startTime);
            const end = parseHour(window.endTime);
            const overnightAfterMidnight =
                isOvernightWindow(start, end) && hour < end;
            const ownerMd = overnightAfterMidnight ? priorMd : md;
            const ownerWeekday = overnightAfterMidnight
                ? priorWeekday
                : weekday;
            if (
                seasonContains(season, ownerMd) &&
                windowDayContains(window, ownerWeekday) &&
                windowTimeContains(window, hour)
            ) {
                return {season, window};
            }
        }
    }
    return null;
}

/**
 * True when `at` falls inside the tariff's contract validity, read as an
 * inclusive local calendar date in the tariff's own zone. Every kind honours
 * the same window, so block and window pricing cannot disagree on it.
 */
export function tariffContractCovers(tariff: TariffSpec, at: Date): boolean {
    if (!tariff.effectiveFrom && !tariff.effectiveTo) return true;
    const local = dateInZone(at, tariff.timezone);
    const localDate = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
    if (tariff.effectiveFrom && localDate < tariff.effectiveFrom) return false;
    if (tariff.effectiveTo && localDate > tariff.effectiveTo) return false;
    return true;
}

export interface TariffPricing {
    price: number;
    // true when this window carries the season's peak (highest) price.
    // For a single-window season the only price is the maximum, so isDay = true.
    isDay: boolean;
    /** Which named band the window is, or null when Fleet cannot say. */
    band: TariffBand | null;
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
    // 'live' prices come from the feed and 'block' prices from cumulative
    // period usage; neither is a function of the instant alone.
    if (tariff.kind === 'live' || tariff.kind === 'block') return null;
    if (!tariffContractCovers(tariff, at)) return null;

    const match = resolveWindow(tariff, at);
    if (!match) return null;

    const {season, window} = match;
    const maxPrice = Math.max(...season.windows.map((w) => w.price));
    return {
        price: window.price,
        isDay: window.price === maxPrice,
        // Declared beats derived: an administrator naming the window knows the
        // network's own naming, which the price order only usually matches.
        band: window.band ?? bandByPriceRank(season, window.price)
    };
}

/**
 * Ranks the season's distinct prices, most expensive first, and names them.
 * Windows sharing a price share a band, because the band is a price tier and
 * not a clock position.
 *
 * Unnamed on purpose in two cases: one distinct price is no split to report,
 * and more than three has no name Fleet can justify. A guess there would be
 * printed to an operator as fact.
 */
function bandByPriceRank(
    season: TariffSeasonSpec,
    price: number
): TariffBand | null {
    const distinct = [...new Set(season.windows.map((w) => w.price))].sort(
        (high, low) => low - high
    );
    if (distinct.length < 2 || distinct.length > TARIFF_BANDS.length) {
        return null;
    }
    const rank = distinct.indexOf(price);
    if (rank < 0) return null;
    // Two prices are the ends of the vocabulary: peak and off-peak, no middle.
    return distinct.length === 2 && rank === 1
        ? 'off_peak'
        : TARIFF_BANDS[rank];
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
