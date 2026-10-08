// A UTC-anchored "today" splits a Sydney store's trading day, so Fleet resolves every period on the tenant clock.

import type {ExternalStore} from './external-store';
import type {
    FleetOrganizationProfile,
    FleetPeriodBaseKey,
    FleetPeriodBucket,
    FleetPeriodKey,
    FleetPeriodOptions,
    FleetPeriodSelection,
    FleetPeriods,
    FleetPeriodWindow
} from './types';

/** A window must mean the same thing to every reader, so the browser zone is never the answer. */
const FALLBACK_TIME_ZONE = 'UTC';

const DAY_MS = 86_400_000;
/** Safety valve — a broken window must never build an unbounded axis. */
const MAX_AXIS_BUCKETS = 400;
const ROLLING_DAYS = {last7: 7, last30: 30, last90: 90} as const;

type RollingKey = keyof typeof ROLLING_DAYS;

const formatters = new Map<string, Intl.DateTimeFormat>();
const zoneUsable = new Map<string, boolean>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            calendar: 'gregory',
            numberingSystem: 'latn',
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        });
        formatters.set(timeZone, formatter);
    }
    return formatter;
}

/** A zone Intl cannot resolve would throw on every window, so it is checked once. */
function usableZone(zone: string): boolean {
    const known = zoneUsable.get(zone);
    if (known !== undefined) return known;
    let ok = true;
    try {
        new Intl.DateTimeFormat('en', {timeZone: zone}).format(0);
    } catch {
        ok = false;
    }
    zoneUsable.set(zone, ok);
    return ok;
}

type Wall = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
};

function wallClock(instantMs: number, timeZone: string): Wall {
    const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
    const read = (type: string): number =>
        Number(parts.find((part) => part.type === type)?.value ?? '0');
    return {
        year: read('year'),
        month: read('month'),
        day: read('day'),
        hour: read('hour'),
        minute: read('minute'),
        second: read('second')
    };
}

function offsetAt(instantMs: number, timeZone: string): number {
    const wall = wallClock(instantMs, timeZone);
    const asUtc = Date.UTC(
        wall.year,
        wall.month - 1,
        wall.day,
        wall.hour,
        wall.minute,
        wall.second
    );
    return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** Two passes: the offset that converts a wall clock is the one at the instant it resolves to, not at the guess. */
function instantOf(wall: Wall, timeZone: string): number {
    const naive = Date.UTC(
        wall.year,
        wall.month - 1,
        wall.day,
        wall.hour,
        wall.minute,
        wall.second
    );
    const first = naive - offsetAt(naive, timeZone);
    const second = naive - offsetAt(first, timeZone);
    return second;
}

const isoOf = (instantMs: number): string => new Date(instantMs).toISOString();

const dayKey = (wall: Wall): string =>
    `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;

function parseDayKey(day: string): {year: number; month: number; date: number} {
    const [year, month, date] = day.split('-').map(Number);
    return {year: year ?? 0, month: month ?? 1, date: date ?? 1};
}

/** Plain-date arithmetic; a day is a calendar step, never a fixed span of ms. */
function shiftDay(day: string, days: number): string {
    const {year, month, date} = parseDayKey(day);
    return new Date(Date.UTC(year, month - 1, date + days))
        .toISOString()
        .slice(0, 10);
}

function shiftMonth(day: string, months: number): string {
    const {year, month} = parseDayKey(day);
    return `${new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 7)}-01`;
}

/** Shorter months have no 31st, so the day is clamped rather than rolling over. */
function shiftMonthKeepingDay(day: string, months: number): string {
    const {year, month, date} = parseDayKey(day);
    const target = new Date(Date.UTC(year, month - 1 + months, 1));
    const lastDay = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
    ).getUTCDate();
    const clamped = Math.min(date, lastDay);
    return `${target.toISOString().slice(0, 7)}-${String(clamped).padStart(2, '0')}`;
}

const monthStart = (day: string): string => `${day.slice(0, 7)}-01`;
const yearStart = (day: string): string => `${day.slice(0, 4)}-01-01`;

/** Monday-anchored, matching the ISO week every report header already names. */
function weekStart(day: string): string {
    const {year, month, date} = parseDayKey(day);
    const at = new Date(Date.UTC(year, month - 1, date));
    return shiftDay(day, -((at.getUTCDay() + 6) % 7));
}

function atHour(day: string, hour: number, timeZone: string): number {
    const {year, month, date} = parseDayKey(day);
    return instantOf(
        {year, month, day: date, hour, minute: 0, second: 0},
        timeZone
    );
}

const atDayStart = (day: string, timeZone: string): number =>
    atHour(day, 0, timeZone);

function isRolling(key: FleetPeriodKey): key is RollingKey {
    return key in ROLLING_DAYS;
}

function isoDay(at: Date): string {
    return at.toISOString().slice(0, 10);
}

function parseSelectionDay(day: string | undefined): Date | null {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const value = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(value.getTime())) return null;
    return isoDay(value) === day ? value : null;
}

function orderedCustomDays(
    selection: FleetPeriodSelection
): {from: Date; to: Date} | null {
    const from = parseSelectionDay(selection.from);
    const to = parseSelectionDay(selection.to);
    if (!from || !to) return null;
    return from > to ? {from: to, to: from} : {from, to};
}

function bucketKeysIn(
    bucket: FleetPeriodBucket,
    fromMs: number,
    endMs: number,
    timeZone: string
): string[] {
    const hourly = bucket === '1 hour';
    const monthly = bucket === '1 month';
    const start = wallClock(fromMs, timeZone);
    let day = monthly ? monthStart(dayKey(start)) : dayKey(start);
    let hour = hourly ? start.hour : 0;
    const keys: string[] = [];
    for (let count = 0; count < MAX_AXIS_BUCKETS; count += 1) {
        const at = hourly
            ? atHour(day, hour, timeZone)
            : atDayStart(day, timeZone);
        if (at >= endMs) break;
        keys.push(isoOf(at));
        if (hourly) {
            hour += 1;
            if (hour === 24) {
                hour = 0;
                day = shiftDay(day, 1);
            }
        } else {
            day = monthly ? shiftMonth(day, 1) : shiftDay(day, 1);
        }
    }
    return keys;
}

/** Fleet's period owner, so every named period, comparison and chart axis resolves on one clock. */
export function createPeriods(
    profile: ExternalStore<FleetOrganizationProfile | null>
): FleetPeriods {
    /** Caller's zone, else the organization's clock, else UTC. */
    function timeZone(zone?: string | null): string {
        const asked = zone?.trim();
        if (asked && usableZone(asked)) return asked;
        const organization = profile.getSnapshot()?.timezoneDefault?.trim();
        return organization && usableZone(organization)
            ? organization
            : FALLBACK_TIME_ZONE;
    }

    function resolve(options?: FleetPeriodOptions): {zone: string; now: Date} {
        return {
            zone: timeZone(options?.timeZone),
            now: options?.now ?? new Date()
        };
    }

    function baseWindow(
        base: FleetPeriodBaseKey,
        now: Date,
        zone: string
    ): FleetPeriodWindow {
        const today = dayKey(wallClock(now.getTime(), zone));
        const to = now.toISOString();
        if (base === 'today') {
            return {from: isoOf(atDayStart(today, zone)), to, bucket: '1 hour'};
        }
        if (base === 'year') {
            return {
                from: isoOf(atDayStart(yearStart(today), zone)),
                to,
                bucket: '1 month'
            };
        }
        if (base === 'week') {
            return {
                from: isoOf(atDayStart(weekStart(today), zone)),
                to,
                bucket: '1 day'
            };
        }
        return {
            from: isoOf(atDayStart(monthStart(today), zone)),
            to,
            bucket: '1 day'
        };
    }

    function window(
        selection: FleetPeriodSelection,
        options?: FleetPeriodOptions
    ): FleetPeriodWindow {
        const {zone, now} = resolve(options);
        if (selection.key === 'custom') {
            const picked = orderedCustomDays(selection);
            // An incomplete custom range is not a window; the current month is the one every picker can express.
            if (!picked) return baseWindow('month', now, zone);
            const endDay = shiftDay(isoDay(picked.to), 1);
            const end = Math.min(atDayStart(endDay, zone), now.getTime());
            const start = Math.min(atDayStart(isoDay(picked.from), zone), end);
            const days = (end - start) / DAY_MS;
            return {
                from: isoOf(start),
                to: isoOf(end),
                bucket: days <= 2 ? '1 hour' : days <= 92 ? '1 day' : '1 month'
            };
        }
        if (selection.key === 'last24') {
            return {
                from: isoOf(now.getTime() - DAY_MS),
                to: now.toISOString(),
                bucket: '1 hour'
            };
        }
        const today = dayKey(wallClock(now.getTime(), zone));
        const to = now.toISOString();
        if (isRolling(selection.key)) {
            const rolling = ROLLING_DAYS[selection.key];
            return {
                from: isoOf(atDayStart(shiftDay(today, -(rolling - 1)), zone)),
                to,
                bucket: '1 day'
            };
        }
        if (selection.key === 'lastMonth') {
            return {
                from: isoOf(atDayStart(shiftMonth(today, -1), zone)),
                to: isoOf(atDayStart(monthStart(today), zone)),
                bucket: '1 day'
            };
        }
        if (selection.key === 'ytd') {
            return {
                from: isoOf(atDayStart(yearStart(today), zone)),
                to,
                bucket: '1 month'
            };
        }
        if (selection.key === 'lastYear') {
            return {
                from: isoOf(
                    atDayStart(`${Number(today.slice(0, 4)) - 1}-01-01`, zone)
                ),
                to: isoOf(atDayStart(yearStart(today), zone)),
                bucket: '1 month'
            };
        }
        return baseWindow(selection.key, now, zone);
    }

    /** Same wall-clock time on another day, so a part-period compares against a part-period. */
    function clampedTimeOfDay(now: Date, day: string, zone: string): number {
        const wall = wallClock(now.getTime(), zone);
        const {year, month, date} = parseDayKey(day);
        return instantOf(
            {
                year,
                month,
                day: date,
                hour: wall.hour,
                minute: wall.minute,
                second: wall.second
            },
            zone
        );
    }

    function previousWindow(
        selection: FleetPeriodSelection,
        options?: FleetPeriodOptions
    ): FleetPeriodWindow {
        const {zone, now} = resolve(options);
        const base = selection.key;
        if (
            base === 'today' ||
            base === 'week' ||
            base === 'month' ||
            base === 'year'
        ) {
            const today = dayKey(wallClock(now.getTime(), zone));
            if (base === 'today') {
                return {
                    from: isoOf(atDayStart(shiftDay(today, -1), zone)),
                    to: isoOf(now.getTime() - DAY_MS),
                    bucket: '1 hour'
                };
            }
            if (base === 'week') {
                return {
                    from: isoOf(
                        atDayStart(shiftDay(weekStart(today), -7), zone)
                    ),
                    to: isoOf(now.getTime() - 7 * DAY_MS),
                    bucket: '1 day'
                };
            }
            if (base === 'year') {
                return {
                    from: isoOf(
                        atDayStart(
                            `${Number(today.slice(0, 4)) - 1}-01-01`,
                            zone
                        )
                    ),
                    to: isoOf(
                        clampedTimeOfDay(
                            now,
                            shiftMonthKeepingDay(today, -12),
                            zone
                        )
                    ),
                    bucket: '1 month'
                };
            }
            return {
                from: isoOf(atDayStart(shiftMonth(today, -1), zone)),
                to: isoOf(
                    clampedTimeOfDay(now, shiftMonthKeepingDay(today, -1), zone)
                ),
                bucket: '1 day'
            };
        }
        const current = window(selection, {now, timeZone: zone});
        const from = Date.parse(current.from);
        const span = Date.parse(current.to) - from;
        return {
            from: isoOf(from - span),
            to: isoOf(from),
            bucket: current.bucket
        };
    }

    /** A custom range answers through its resolved bucket, so grain and window can never disagree. */
    function granularity(
        selection: FleetPeriodSelection,
        options?: FleetPeriodOptions
    ): FleetPeriodBaseKey {
        if (selection.key === 'today' || selection.key === 'last24') {
            return 'today';
        }
        if (
            selection.key === 'year' ||
            selection.key === 'ytd' ||
            selection.key === 'lastYear'
        ) {
            return 'year';
        }
        if (selection.key === 'custom') {
            const bucket = window(selection, options).bucket;
            return bucket === '1 hour'
                ? 'today'
                : bucket === '1 month'
                  ? 'year'
                  : 'month';
        }
        return 'month';
    }

    return {
        timeZone,
        window,
        previousWindow,
        granularity,
        /** A history query answers only buckets with data, so the axis is the window, not the answer. */
        bucketKeys(selection, options) {
            const {zone} = resolve(options);
            const covered = window(selection, options);
            const from = Date.parse(covered.from);
            const end = Date.parse(covered.to);
            if (!Number.isFinite(from) || !Number.isFinite(end)) return [];
            return bucketKeysIn(covered.bucket, from, end, zone);
        },
        /** Every tenant-local calendar day in a fixed report window; end is exclusive. */
        dailyBucketKeys(from, to, options) {
            const start = Date.parse(from);
            const end = Date.parse(to);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
            return bucketKeysIn('1 day', start, end, resolve(options).zone);
        },
        /** The bucket an instant belongs to, floored on the tenant clock. */
        floorBucketKey(instant, bucket, options) {
            const at =
                instant instanceof Date
                    ? instant.getTime()
                    : Date.parse(String(instant));
            if (!Number.isFinite(at)) return null;
            const zone = resolve(options).zone;
            const wall = wallClock(at, zone);
            if (bucket === '1 hour') {
                return isoOf(atHour(dayKey(wall), wall.hour, zone));
            }
            const day =
                bucket === '1 month' ? monthStart(dayKey(wall)) : dayKey(wall);
            return isoOf(atDayStart(day, zone));
        },
        /** Where the next bucket starts, so a bucket's span is read the way it was built. */
        nextBucketKey(bucketKey, bucket, options) {
            const at = Date.parse(bucketKey);
            if (!Number.isFinite(at)) return null;
            const zone = resolve(options).zone;
            const wall = wallClock(at, zone);
            const day = dayKey(wall);
            if (bucket === '1 hour') {
                const hour = wall.hour + 1;
                return isoOf(
                    hour === 24
                        ? atDayStart(shiftDay(day, 1), zone)
                        : atHour(day, hour, zone)
                );
            }
            return isoOf(
                atDayStart(
                    bucket === '1 month'
                        ? shiftMonth(day, 1)
                        : shiftDay(day, 1),
                    zone
                )
            );
        }
    };
}
