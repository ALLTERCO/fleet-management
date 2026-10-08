/**
 * When a rule may fire. Uses the same window rule as billing (model/timeWindow).
 *
 * Two decisions live here:
 *   - No window means always active. Every existing rule has none.
 *   - A window that cannot be read FAILS OPEN. A muted alert looks exactly like
 *     a quiet system; a typo must not be why nobody heard the freezer thaw.
 *
 * Gates firing only. Out-of-window events still evaluate, so learning
 * evaluators keep their baselines, and recoveries still clear.
 */

import {hourInZone, weekdayInZone} from '../../model/report/localTimeInZone';
import {
    dayBitIndex,
    daysMaskSelects,
    isOvernightWindow,
    MINUTES_PER_DAY,
    parseTimeOfDay,
    priorDay,
    windowContains
} from '../../model/timeWindow';
import type {AlertActiveWindow} from '../../types/api/alert';

export type {AlertActiveWindow} from '../../types/api/alert';

/**
 * Mirrors TariffWindowSpec so an operator writes a window once and it means the
 * same thing wherever they write it — plus the timezone, which a tariff gets
 * from its parent and a rule has to carry itself.
 */
/** Is the rule allowed to fire at this instant? */
export function ruleIsActiveAt(
    window: AlertActiveWindow | null,
    at: Date
): boolean {
    if (!window) return true;

    const start = parseTimeOfDay(window.startTime);
    const end = parseTimeOfDay(window.endTime);
    // Unreadable bounds: fail open rather than mute the rule forever.
    if (start === null || end === null) return true;
    if (!Number.isInteger(window.daysMask)) return true;

    const minute = Math.round(hourInZone(at, window.timezone) * 60);
    if (!windowContains(start, end, minute)) return false;

    // The after-midnight half of an overnight window belongs to the weekday the
    // window opened on: a Friday-only 22:00-06:00 window is still active at
    // 02:00 on Saturday, and is NOT active at 02:00 on Friday.
    const weekday = dayBitIndex(weekdayInZone(at, window.timezone));
    const startedYesterday = isOvernightWindow(start, end) && minute < end;
    return daysMaskSelects(
        window.daysMask,
        startedYesterday ? priorDay(weekday) : weekday
    );
}

/**
 * Read the JSONB column into a window, or null for "always active".
 *
 * Anything that is not a complete, well-typed window becomes null. That is the
 * fail-open rule again, applied one layer earlier: a row written by an older
 * build, a hand-edited value, or a half-populated object must leave the rule
 * firing normally rather than silently muted.
 */
export function readActiveWindow(value: unknown): AlertActiveWindow | null {
    if (typeof value !== 'object' || value === null) return null;
    const {startTime, endTime, daysMask, timezone} =
        value as Partial<AlertActiveWindow>;
    if (typeof startTime !== 'string' || typeof endTime !== 'string') {
        return null;
    }
    if (!Number.isInteger(daysMask)) return null;
    return {
        startTime,
        endTime,
        daysMask: daysMask as number,
        timezone: typeof timezone === 'string' && timezone ? timezone : null
    };
}

/** Exported for the schema and the UI, so the day count lives in one place. */
export const ALL_DAYS_MASK = 0b1111111;

export {MINUTES_PER_DAY};
