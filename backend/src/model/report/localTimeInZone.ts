// Local fractional hour-of-day (e.g. 07:30 → 7.5) and weekday (0=Sunday, like
// getUTCDay) of an instant in an IANA zone, for tariff day/night and
// weekday/weekend classification. The fractional hour keeps a sub-hour tariff
// boundary (07:30) from being misbilled. Null/invalid zone falls back to UTC.

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
};

function formatter(timezone: string): Intl.DateTimeFormat | null {
    const cached = FORMATTERS.get(timezone);
    if (cached) return cached;
    try {
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'short',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        FORMATTERS.set(timezone, fmt);
        return fmt;
    } catch {
        return null;
    }
}

function utcCalendarDate(instant: Date): LocalDate {
    return {
        year: instant.getUTCFullYear(),
        month: instant.getUTCMonth() + 1,
        day: instant.getUTCDate()
    };
}

function utcFractionalHour(instant: Date): number {
    return instant.getUTCHours() + instant.getUTCMinutes() / 60;
}

export function hourInZone(instant: Date, timezone: string | null): number {
    const fmt = timezone ? formatter(timezone) : null;
    if (!fmt) return utcFractionalHour(instant);
    const parts = fmt.formatToParts(instant);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    if (!Number.isFinite(hour)) return utcFractionalHour(instant);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    // Some engines render midnight as '24'.
    return (hour % 24) + (Number.isFinite(minute) ? minute / 60 : 0);
}

export function weekdayInZone(instant: Date, timezone: string | null): number {
    const fmt = timezone ? formatter(timezone) : null;
    if (!fmt) return instant.getUTCDay();
    const value = fmt
        .formatToParts(instant)
        .find((p) => p.type === 'weekday')?.value;
    return value && value in WEEKDAY_INDEX
        ? WEEKDAY_INDEX[value]
        : instant.getUTCDay();
}

export interface LocalDate {
    year: number;
    month: number; // 1-12
    day: number; // 1-31
}

// Calendar date of an instant in an IANA zone. Null/invalid zone falls back to
// UTC. For date-boundary logic (e.g. billing-day anchors) that must reset in
// the tariff's local time, not UTC.
export function dateInZone(instant: Date, timezone: string | null): LocalDate {
    const fmt = timezone ? formatter(timezone) : null;
    if (!fmt) return utcCalendarDate(instant);
    const parts = fmt.formatToParts(instant);
    const num = (type: string): number =>
        Number(parts.find((p) => p.type === type)?.value);
    const year = num('year');
    const month = num('month');
    const day = num('day');
    if (![year, month, day].every(Number.isFinite)) {
        return utcCalendarDate(instant);
    }
    return {year, month, day};
}
