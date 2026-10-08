// Named report period → {from, to} UTC range, resolved in the org timezone.
//
// PURE: `now` is injected — never read the clock here, so the resolution is
// deterministic and unit-testable. Calendar boundaries (first of month, Jan 1,
// a billing-day anchor) are local wall-clock instants in the given zone; we
// reuse dateInZone() (no hand-rolled tz math) to map a local midnight back to
// the correct UTC instant, honouring each date's own DST offset.

// ReportPeriod/REPORT_PERIODS live in the contract layer (types/api/report).
import type {ReportPeriod} from '../../types/api/report';
import {dateInZone, type LocalDate} from './localTimeInZone';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReportPeriodOptions {
    // Day-of-month (1-28) the billing cycle resets on. Defaults to 1. The
    // tariff-driven billing day can be wired into this later; 1-28 only so
    // every month has the anchor (no Feb-30 gaps).
    billingDay?: number;
}

export interface DateRange {
    from: Date;
    to: Date;
}

export function resolveReportPeriod(
    period: ReportPeriod,
    now: Date,
    timezone: string | null,
    opts: ReportPeriodOptions = {}
): DateRange {
    const today = dateInZone(now, timezone);
    switch (period) {
        case 'last_7_days':
            return {from: new Date(now.getTime() - 7 * DAY_MS), to: now};
        case 'mtd':
            return {from: monthStart(today, 0, timezone), to: now};
        case 'last_month':
            return {
                from: monthStart(today, -1, timezone),
                to: monthStart(today, 0, timezone)
            };
        case 'ytd':
            return {from: yearStart(today, 0, timezone), to: now};
        case 'last_year':
            return {
                from: yearStart(today, -1, timezone),
                to: yearStart(today, 0, timezone)
            };
        case 'billing_period':
            return billingPeriod(today, timezone, opts.billingDay ?? 1);
    }
}

// Most recent COMPLETE billing month aligned to `billingDay`: [anchor of the
// previous cycle, anchor of the current cycle). The current cycle's anchor is
// this month's billingDay if it has already arrived, else last month's.
function billingPeriod(
    today: LocalDate,
    timezone: string | null,
    billingDay: number
): DateRange {
    const day = clampBillingDay(billingDay);
    const reached = today.day >= day;
    const cycleEnd = anchor(today, reached ? 0 : -1, day, timezone);
    const cycleStart = anchor(today, reached ? -1 : -2, day, timezone);
    return {from: cycleStart, to: cycleEnd};
}

function clampBillingDay(day: number): number {
    if (!Number.isFinite(day)) return 1;
    return Math.min(28, Math.max(1, Math.trunc(day)));
}

// UTC instant of `day` at 00:00 local in the month `monthOffset` away.
function anchor(
    base: LocalDate,
    monthOffset: number,
    day: number,
    timezone: string | null
): Date {
    const {year, month} = shiftMonth(base.year, base.month, monthOffset);
    return localMidnightToUtc({year, month, day}, timezone);
}

function monthStart(
    base: LocalDate,
    monthOffset: number,
    timezone: string | null
): Date {
    const {year, month} = shiftMonth(base.year, base.month, monthOffset);
    return localMidnightToUtc({year, month, day: 1}, timezone);
}

function yearStart(
    base: LocalDate,
    yearOffset: number,
    timezone: string | null
): Date {
    return localMidnightToUtc(
        {year: base.year + yearOffset, month: 1, day: 1},
        timezone
    );
}

// Billing-period index for a local date: periods reset on billingDay, so a date
// before billingDay still belongs to the previous month's period. Shared by
// every charge that bills "once per period" — standing, demand and blocks must
// agree on where one period ends and the next begins.
export function billingPeriodIndex(
    date: LocalDate,
    billingDay: number
): number {
    const monthIndex = date.year * 12 + (date.month - 1);
    return date.day < billingDay ? monthIndex - 1 : monthIndex;
}

/** Billing-period index of an instant, anchored in the tariff's own zone. */
export function billingPeriodIndexAt(
    at: Date,
    timezone: string | null,
    billingDay: number
): number {
    return billingPeriodIndex(dateInZone(at, timezone), billingDay);
}

/** UTC instant a billing period opens: local midnight on its billingDay.
 * Private: callers want a period, and a period is a pair — use
 * `billingPeriodBounds` so nobody has to remember to ask for index + 1. */
function billingPeriodAnchor(
    periodIndex: number,
    billingDay: number,
    timezone: string | null
): Date {
    const year = Math.floor(periodIndex / 12);
    const month = periodIndex - year * 12 + 1;
    return localMidnightToUtc({year, month, day: billingDay}, timezone);
}

/** Calendar month a billing period opens in, as 'YYYY-MM'. A period runs from
 * its billingDay in this month to the same day of the next, so the key names
 * the opening month, not every month the period touches. */
export function billingPeriodCalendarKey(periodIndex: number): string {
    const year = Math.floor(periodIndex / 12);
    const month = periodIndex - year * 12 + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
}

/** Half-open bounds of a billing period, in the tariff's own zone. */
export function billingPeriodBounds(
    periodIndex: number,
    billingDay: number,
    timezone: string | null
): {from: Date; to: Date} {
    return {
        from: billingPeriodAnchor(periodIndex, billingDay, timezone),
        to: billingPeriodAnchor(periodIndex + 1, billingDay, timezone)
    };
}

// Whole local days in a billing period. Counted on the calendar, not from the
// bounds: a period crossing a DST change is an hour short of a whole number of
// days, and a per-day charge still bills every one of them.
export function billingPeriodDays(
    periodIndex: number,
    billingDay: number
): number {
    const year = Math.floor(periodIndex / 12);
    const month = periodIndex - year * 12;
    const start = Date.UTC(year, month, billingDay);
    const end = Date.UTC(year, month + 1, billingDay);
    return Math.round((end - start) / 86_400_000);
}

export function shiftMonth(
    year: number,
    month: number,
    delta: number
): {year: number; month: number} {
    const zeroBased = month - 1 + delta;
    return {
        year: year + Math.floor(zeroBased / 12),
        month: (((zeroBased % 12) + 12) % 12) + 1
    };
}

// Map a local wall-clock time to its UTC instant. The zone's UTC offset is
// itself date-dependent (DST), so we derive the offset at the candidate instant
// from dateInZone, correct, then re-check once to settle any DST edge.
export function localTimeToUtc(
    local: LocalDate,
    minutesOfDay: number,
    timezone: string | null
): Date {
    const wallMs =
        Date.UTC(local.year, local.month - 1, local.day) +
        minutesOfDay * 60_000;
    if (!timezone) return new Date(wallMs);
    let guess = wallMs;
    for (let i = 0; i < 2; i++) {
        const corrected = wallMs - zoneOffsetMs(new Date(guess), timezone);
        if (corrected === guess) break;
        guess = corrected;
    }
    return new Date(guess);
}

/** Midnight is the local time every calendar boundary is anchored at. */
export function localMidnightToUtc(
    local: LocalDate,
    timezone: string | null
): Date {
    return localTimeToUtc(local, 0, timezone);
}

// Zone offset (ms, east-positive) at an instant: local wall-clock minus UTC
// wall-clock, both read for the same instant.
function zoneOffsetMs(instant: Date, timezone: string): number {
    const local = dateInZone(instant, timezone);
    const localHour = hourMinuteInZone(instant, timezone);
    const localMs = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        localHour.hour,
        localHour.minute
    );
    const utcMs = Date.UTC(
        instant.getUTCFullYear(),
        instant.getUTCMonth(),
        instant.getUTCDate(),
        instant.getUTCHours(),
        instant.getUTCMinutes()
    );
    return localMs - utcMs;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function hourMinuteInZone(
    instant: Date,
    timezone: string
): {hour: number; minute: number} {
    let fmt = FORMATTERS.get(timezone);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        FORMATTERS.set(timezone, fmt);
    }
    const parts = fmt.formatToParts(instant);
    const num = (type: string): number =>
        Number(parts.find((p) => p.type === type)?.value);
    const hour = num('hour') % 24; // some engines render midnight as 24
    const minute = num('minute');
    return {
        hour: Number.isFinite(hour) ? hour : 0,
        minute: Number.isFinite(minute) ? minute : 0
    };
}
