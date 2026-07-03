/**
 * Local wall-clock resolution for one instant in one IANA timezone.
 *
 * The suppression, routing-suppression and on-call modules each used to
 * reimplement this with `Intl.DateTimeFormat`. This is the single home.
 * Returns null for an unrecognized timezone so callers fail open rather
 * than throwing a RangeError mid-evaluation.
 */

const DAY_MS = 86_400_000;

export interface LocalClock {
    /** Lowercased long weekday name, e.g. 'monday'. */
    weekday: string;
    /** Minutes since local midnight, 0..1439. */
    minuteOfDay: number;
    /** Whole days since the Unix epoch for the local calendar date. */
    dayEpoch: number;
}

export function localClock(at: Date, timezone: string): LocalClock | null {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            weekday: 'long',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(at);
        const get = (type: string): string | undefined =>
            parts.find((part) => part.type === type)?.value;

        const hour = Number(get('hour'));
        const minute = Number(get('minute'));
        const year = Number(get('year'));
        const month = Number(get('month'));
        const day = Number(get('day'));
        if (
            !Number.isFinite(hour) ||
            !Number.isFinite(minute) ||
            !Number.isFinite(year)
        ) {
            return null;
        }
        return {
            weekday: String(get('weekday') ?? '').toLowerCase(),
            minuteOfDay: (hour % 24) * 60 + minute,
            dayEpoch: Date.UTC(year, month - 1, day) / DAY_MS
        };
    } catch {
        return null;
    }
}
