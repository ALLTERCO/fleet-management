/**
 * One rule for "is this time of day inside this window". Billing and alerting
 * share it; it was written seven times before.
 *
 *   start === end   all day
 *   end < start     wraps midnight
 *   otherwise       plain [start, end)
 *
 * The end is EXCLUSIVE, so back-to-back windows tile without billing the
 * boundary minute twice.
 *
 * Unit-agnostic. Pass minutes, or the fractional hours the resolver already
 * has, as long as all arguments share one unit.
 */

/** Minutes in a day — the unit most callers use. */
export const MINUTES_PER_DAY = 1440;

/** A window whose start and end are equal covers the whole day. */
export function isAllDayWindow(start: number, end: number): boolean {
    return start === end;
}

/**
 * True when the window runs past midnight into the next day.
 * An all-day window is not a wrap: it has no outside.
 */
export function isOvernightWindow(start: number, end: number): boolean {
    return !isAllDayWindow(start, end) && end < start;
}

/**
 * Is `at` inside [start, end)? All three share one unit.
 *
 * This is the whole rule. Everything else in this module is expressed in terms
 * of it, so a change here changes billing and alerting together rather than
 * one of them quietly.
 */
export function windowContains(
    start: number,
    end: number,
    at: number
): boolean {
    if (isAllDayWindow(start, end)) return true;
    if (end < start) return at >= start || at < end; // wraps midnight
    return at >= start && at < end;
}

/**
 * How long the window lasts, in the caller's unit.
 * `dayLength` is that unit's full day (1440 for minutes, 24 for hours).
 */
export function windowSpan(
    start: number,
    end: number,
    dayLength: number
): number {
    if (isAllDayWindow(start, end)) return dayLength;
    return end > start ? end - start : dayLength - start + end;
}

/**
 * The window as concrete ranges within one day, so a caller can fill a buffer
 * without re-deriving the wrap. An overnight window yields two: the part
 * belonging to the window's own day, then the part after midnight.
 *
 * Ranges are [from, to) in the caller's unit.
 */
export function windowRanges(
    start: number,
    end: number,
    dayLength: number
): {from: number; to: number; afterMidnight: boolean}[] {
    if (isAllDayWindow(start, end)) {
        return [{from: 0, to: dayLength, afterMidnight: false}];
    }
    if (end < start) {
        return [
            {from: start, to: dayLength, afterMidnight: false},
            {from: 0, to: end, afterMidnight: true}
        ];
    }
    return [{from: start, to: end, afterMidnight: false}];
}

/**
 * Parse 'HH:MM' (or 'HH:MM:SS') to minutes past midnight.
 * Returns null on anything unparseable, so a caller can decide whether a bad
 * value is a validation error or a default — the tariff paths disagree on that
 * and both are right for their own case.
 */
export function parseTimeOfDay(value: string): number | null {
    const parts = String(value).split(':');
    if (parts.length < 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || minutes < 0) return null;
    return hours * 60 + minutes;
}

/**
 * Convert a Sunday-based weekday (`Date.getUTCDay`, `weekdayInZone`) to the
 * Monday-based bit index `daysMask` uses. Off by one here shifts every
 * weekday-scoped window by a day, which reads as "the tariff is just wrong on
 * Mondays" rather than as a bug in this line.
 */
export function dayBitIndex(sundayBasedDay: number): number {
    return sundayBasedDay === 0 ? 6 : sundayBasedDay - 1;
}

/** Weekday bit test. Bit 0 is Monday, matching TariffWindowSpec.daysMask. */
export function daysMaskSelects(
    daysMask: number,
    mondayBasedDay: number
): boolean {
    return ((daysMask >> mondayBasedDay) & 1) === 1;
}

/**
 * The day before, in a 0-6 cycle. Works in either basis — callers pass
 * Sunday-based or Monday-based days and get the same basis back.
 *
 * An overnight window's after-midnight half belongs to the day it started on:
 * a Friday 22:00-06:00 window owns Saturday's early hours. Backwards, and a
 * weekend tariff bills Monday morning at the weekend rate.
 */
export function priorDay(day: number): number {
    return (day + 6) % 7;
}
