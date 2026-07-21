/** Time/size/byte formatters — single source of truth across the app. */

type TimestampInput = number | string | Date;

function toMs(input: TimestampInput): number {
    if (typeof input === 'number') return input;
    if (input instanceof Date) return input.getTime();
    return new Date(input).getTime();
}

/** "X{s,m,h,d} ago" relative time string. */
export function formatRelative(
    input: TimestampInput,
    nowMs: number = Date.now()
): string {
    const ms = nowMs - toMs(input);
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

/** Future counterpart of formatRelative: "in {N}{s|m|h|d}"; "expired" once past.
 *  Rounds to the nearest unit so a token minted for 15 minutes reads
 *  "in 15m" everywhere, not "in 14m" one second later. */
export function formatUntil(
    input: TimestampInput,
    nowMs: number = Date.now()
): string {
    const s = Math.floor((toMs(input) - nowMs) / 1000);
    if (s <= 0) return 'expired';
    if (s < 60) return `in ${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `in ${m}m`;
    const h = Math.round(s / 3600);
    if (h < 24) return `in ${h}h`;
    return `in ${Math.round(s / 86400)}d`;
}

/** Live countdown clock: "H:MM:SS" over an hour, "M:SS" under, "0:00" done. */
export function formatCountdown(
    input: TimestampInput,
    nowMs: number = Date.now()
): string {
    const total = Math.max(0, Math.floor((toMs(input) - nowMs) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Local date+time via toLocaleString. */
export function formatTime(input: TimestampInput): string {
    return new Date(toMs(input)).toLocaleString();
}

/**
 * Human-readable duration from a number of SECONDS. Shows only the units that
 * matter — the largest non-zero unit plus up to `maxUnits-1` smaller ones, with
 * trailing zero units dropped:
 *   0s · 45s · 3m 20s · 2h 5m · 3d 4h · 1y 40d
 *
 * The ladder is year → day → hour → minute → second: there is no month unit, so
 * days convert straight to years (the ops-tool convention, e.g. kubectl's AGE
 * column — a raw second-count has no calendar, and months are the most
 * ambiguous unit). A year is a fixed 365 days: a DISPLAY approximation, not
 * calendar-exact, so a leap year's extra day surfaces honestly in the day slot
 * (a 366-day span reads "1y 1d"). Use for spans (uptime, ages, countdowns), not
 * for exact calendar math.
 */
export function formatDuration(seconds: number, maxUnits = 2): string {
    const total = Math.max(0, Math.floor(seconds));
    const UNITS: ReadonlyArray<readonly [string, number]> = [
        ['y', 365 * 86400],
        ['d', 86400],
        ['h', 3600],
        ['m', 60],
        ['s', 1],
    ];
    let start = UNITS.length - 1;
    for (let i = 0; i < UNITS.length; i++) {
        if (total >= UNITS[i][1]) {
            start = i;
            break;
        }
    }
    const parts: string[] = [];
    let rem = total;
    for (let i = start; i < UNITS.length && parts.length < maxUnits; i++) {
        const [label, size] = UNITS[i];
        parts.push(`${Math.floor(rem / size)}${label}`);
        rem %= size;
    }
    while (parts.length > 1 && parts[parts.length - 1].startsWith('0')) {
        parts.pop();
    }
    return parts.join(' ');
}

/** Compact single-unit age of a past timestamp, for monitoring tables. */
export function formatAge(ts: number): string {
    return formatDuration((Date.now() - ts) / 1000, 1);
}

/** HH:MM:SS time-of-day (for log streams, monitoring views). */
export function formatTimeOfDay(input: TimestampInput): string {
    const d = new Date(toMs(input));
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map((n) => String(n).padStart(2, '0'))
        .join(':');
}

/** Local date only ({month: short, day: numeric, year: numeric}). */
export function formatDate(input: TimestampInput): string {
    return new Date(toMs(input)).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

/** Duration in ms with the unit attached: sub-10ms keeps one decimal
 *  ("9.7ms"), anything above rounds to whole ms ("123ms"). */
export function formatMs(ms: number): string {
    if (!Number.isFinite(ms)) return '—';
    const rounded = ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms);
    return `${rounded}ms`;
}

/** Human-readable bytes with adaptive unit. `null` returns the empty marker. */
export function formatBytes(
    bytes: number | null | undefined,
    decimals = 1,
    emptyMarker = '—'
): string {
    if (bytes == null) return emptyMarker;
    if (bytes < 1024) return `${bytes} B`;
    const k = 1024;
    const units = ['KB', 'MB', 'GB', 'TB'];
    const i = Math.min(
        Math.floor(Math.log(bytes) / Math.log(k)) - 1,
        units.length - 1
    );
    return `${(bytes / k ** (i + 1)).toFixed(decimals)} ${units[i]}`;
}
