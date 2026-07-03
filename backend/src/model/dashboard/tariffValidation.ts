// Pure tariff validators (no I/O, no PG, no clock); the only import is the
// shared IANA timezone check. Each function answers one question. JSON schema
// covers shape; these cover cross-field semantics (24h coverage, no-overlap,
// valid IANA TZ, mode/payload consistency).

import {isValidTimezone} from '../../modules/location/isoData';
import {MINUTES_PER_DAY} from '../../modules/util/timeUnits';
import type {TariffMode, TariffWindow} from '../../types/api/dashboard';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type TariffValidationError =
    | 'tariff_windows_required'
    | 'tariff_windows_invalid_time_format'
    | 'tariff_windows_overlap'
    | 'tariff_windows_gap'
    | 'tariff_windows_empty_or_too_many'
    | 'tariff_invalid_timezone'
    | 'tariff_weekend_override_only_on_split_modes';

export function parseHourMinute(value: string): number | null {
    if (!HH_MM.test(value)) return null;
    const [h, m] = value.split(':').map((p) => Number.parseInt(p, 10));
    return h * 60 + m;
}

// Tariff timezone validity is the shared IANA check — single source in isoData.
export function isValidTariffTimezone(value: string): boolean {
    return isValidTimezone(value);
}

// Minute-of-day [start,end) ranges a window covers; a wrap past midnight
// splits into two. Callers parse + edge-check `from`/`to` first.
function windowSegments(from: number, to: number): Array<[number, number]> {
    const stop = to === 0 ? MINUTES_PER_DAY : to;
    return stop <= from
        ? [
              [from, MINUTES_PER_DAY],
              [0, stop]
          ]
        : [[from, stop]];
}

// 24-hour circular coverage. A window's [from, to) interval is mapped onto
// the 1440-minute day axis; intervals crossing midnight split into two
// segments (e.g., 22:00→04:00 becomes [1320, 1440) + [0, 240)). The window
// list is valid iff segments tile exactly once over the 1440 minutes.
export function tariffWindowsCover24h(windows: TariffWindow[]): boolean {
    if (windows.length === 0) return false;
    const minutes: boolean[] = new Array(MINUTES_PER_DAY).fill(false);
    for (const w of windows) {
        const from = parseHourMinute(w.from);
        const to = parseHourMinute(w.to);
        if (from === null || to === null) return false;
        if (from === to) return false;
        const segments = windowSegments(from, to);
        for (const [s, e] of segments) {
            for (let i = s; i < e; i++) {
                if (minutes[i]) return false; // overlap
                minutes[i] = true;
            }
        }
    }
    return minutes.every((m) => m);
}

// Which band covers a given local minute-of-day (0..1439). Used at serve
// time AND by the validator's coverage check. Returns null on no match.
export function bandForLocalMinute(
    minuteOfDay: number,
    windows: TariffWindow[]
): TariffWindow | null {
    if (minuteOfDay < 0 || minuteOfDay >= MINUTES_PER_DAY) return null;
    for (const w of windows) {
        const from = parseHourMinute(w.from);
        const to = parseHourMinute(w.to);
        if (from === null || to === null) continue;
        // Zero-length window — the validator rejects these; ignore at serve
        // time too so both paths agree.
        if (from === to) continue;
        const stop = to === 0 ? MINUTES_PER_DAY : to;
        const wraps = stop <= from;
        const inWindow = wraps
            ? minuteOfDay >= from || minuteOfDay < stop
            : minuteOfDay >= from && minuteOfDay < stop;
        if (inWindow) return w;
    }
    return null;
}

interface ValidateInput {
    tariffMode: TariffMode;
    tariffTimezone: string | null;
    tariffWindows: TariffWindow[] | null;
    tariffWeekendOverride: TariffWindow[] | null;
}

export interface ValidationFailure {
    error: TariffValidationError;
    field?: string;
}

// Top-level cross-field check. JSON schema has already enforced shape;
// this owns the semantic rules. Top-down narrative: timezone → mode →
// windows → weekend override.
export function validateTariffSettings(
    input: ValidateInput
): ValidationFailure | null {
    const tzError = checkTimezone(input.tariffTimezone);
    if (tzError) return tzError;

    const modeError = checkWindowsForMode(input);
    if (modeError) return modeError;

    const weekendError = checkWeekendOverride(input);
    if (weekendError) return weekendError;

    return null;
}

function checkTimezone(tz: string | null): ValidationFailure | null {
    if (tz === null) return null; // optional; backfill handles legacy rows
    if (!isValidTariffTimezone(tz)) {
        return {error: 'tariff_invalid_timezone', field: 'tariffTimezone'};
    }
    return null;
}

function checkWindowsForMode(input: ValidateInput): ValidationFailure | null {
    if (input.tariffMode !== 'tou') return null;
    const w = input.tariffWindows;
    if (!w || w.length === 0) {
        return {error: 'tariff_windows_required', field: 'tariffWindows'};
    }
    if (w.length > 8) {
        return {
            error: 'tariff_windows_empty_or_too_many',
            field: 'tariffWindows'
        };
    }
    return checkCoverage(w, 'tariffWindows');
}

function checkWeekendOverride(input: ValidateInput): ValidationFailure | null {
    const override = input.tariffWeekendOverride;
    if (override === null) return null;
    if (input.tariffMode === 'single') {
        return {
            error: 'tariff_weekend_override_only_on_split_modes',
            field: 'tariffWeekendOverride'
        };
    }
    if (override.length === 0 || override.length > 8) {
        return {
            error: 'tariff_windows_empty_or_too_many',
            field: 'tariffWeekendOverride'
        };
    }
    return checkCoverage(override, 'tariffWeekendOverride');
}

function checkCoverage(
    windows: TariffWindow[],
    field: string
): ValidationFailure | null {
    for (let i = 0; i < windows.length; i++) {
        const w = windows[i]!;
        if (parseHourMinute(w.from) === null) {
            return {
                error: 'tariff_windows_invalid_time_format',
                field: `${field}[${i}].from`
            };
        }
        if (parseHourMinute(w.to) === null) {
            return {
                error: 'tariff_windows_invalid_time_format',
                field: `${field}[${i}].to`
            };
        }
    }
    if (!tariffWindowsCover24h(windows)) {
        return overlapOrGap(windows, field);
    }
    return null;
}

function overlapOrGap(
    windows: TariffWindow[],
    field: string
): ValidationFailure {
    const minutes: number[] = new Array(MINUTES_PER_DAY).fill(0);
    for (const w of windows) {
        const from = parseHourMinute(w.from);
        const to = parseHourMinute(w.to);
        if (from === null || to === null) continue;
        const segments = windowSegments(from, to);
        for (const [s, e] of segments) {
            for (let i = s; i < e; i++) minutes[i]!++;
        }
    }
    const hasOverlap = minutes.some((m) => m > 1);
    return {
        error: hasOverlap ? 'tariff_windows_overlap' : 'tariff_windows_gap',
        field
    };
}
