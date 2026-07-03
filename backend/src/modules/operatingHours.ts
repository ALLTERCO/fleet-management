// Open/closed time math for a location's operating hours. The data shape +
// validation live in the location module (kindSchemas / validator); this module
// only answers "open at this instant?" and "how much of this window was open?"
// so reports can split energy into business-hours vs after-hours. Day windows
// are same-day (the validator rejects open >= close), keyed by weekday in the
// location's IANA timezone, so DST is handled by converting each real instant.

const WEEKDAYS = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday'
] as const;

type Weekday = (typeof WEEKDAYS)[number];

export interface DayWindow {
    open?: string;
    close?: string;
    closed?: boolean;
}

export type OperatingHours = Partial<Record<Weekday, DayWindow>> & {
    timezone: string;
};

interface LocalParts {
    weekday: Weekday;
    minutes: number;
}

function minutesOf(hhmm: string): number {
    const [h, m] = hhmm.split(':');
    return Number(h) * 60 + Number(m);
}

// A zone-bound formatter, or null when the IANA zone is invalid. Building it can
// throw RangeError on a bad zone; we catch so one malformed location degrades to
// "closed" instead of throwing out of a whole report section.
function zoneFormatter(timezone: string): Intl.DateTimeFormat | null {
    try {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    } catch {
        return null;
    }
}

// Wall-clock weekday + minute-of-day at an instant, via a prebuilt formatter.
function localPartsAt(
    instant: Date,
    formatter: Intl.DateTimeFormat
): LocalParts {
    const parts = formatter.formatToParts(instant);
    const lookup = (type: string) =>
        parts.find((p) => p.type === type)?.value ?? '';
    const weekday = lookup('weekday').toLowerCase() as Weekday;
    // 24-hour formatting can emit '24' for midnight in some engines.
    const hour = Number(lookup('hour')) % 24;
    return {weekday, minutes: hour * 60 + Number(lookup('minute'))};
}

function windowOpen(window: DayWindow | undefined, minutes: number): boolean {
    if (!window || window.closed || !window.open || !window.close) return false;
    return (
        minutes >= minutesOf(window.open) && minutes < minutesOf(window.close)
    );
}

function openWith(
    hours: OperatingHours,
    instant: Date,
    formatter: Intl.DateTimeFormat
): boolean {
    const {weekday, minutes} = localPartsAt(instant, formatter);
    return windowOpen(hours[weekday], minutes);
}

// True when the location is within a declared open window at this instant. A
// day with no window, a closed day, or an invalid timezone is treated as closed.
export function isOpenAt(hours: OperatingHours, instant: Date): boolean {
    const formatter = zoneFormatter(hours.timezone);
    return formatter ? openWith(hours, instant, formatter) : false;
}

export interface PeriodSplit {
    openSec: number;
    closedSec: number;
    openFraction: number;
}

const STEP_MS = 60_000;

// Splits [from, to) into open vs closed seconds by walking it minute by minute.
// Each step is classified at its real instant, so DST changes (a 23- or 25-hour
// day) fall out correctly. openFraction is 0 for an empty or inverted range.
export function classifyPeriod(
    hours: OperatingHours,
    from: Date,
    to: Date
): PeriodSplit {
    // One formatter for the whole walk; null (bad zone) means the location's
    // schedule is unknown, so every minute counts as closed rather than throwing.
    const formatter = zoneFormatter(hours.timezone);
    let openSec = 0;
    let closedSec = 0;
    let cursor = from.getTime();
    const end = to.getTime();
    while (cursor < end) {
        const stepEnd = Math.min(cursor + STEP_MS, end);
        const seconds = (stepEnd - cursor) / 1000;
        const open = formatter
            ? openWith(hours, new Date(cursor), formatter)
            : false;
        if (open) openSec += seconds;
        else closedSec += seconds;
        cursor = stepEnd;
    }
    const total = openSec + closedSec;
    return {openSec, closedSec, openFraction: total > 0 ? openSec / total : 0};
}
