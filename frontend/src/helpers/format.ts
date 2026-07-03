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

/** Local date+time via toLocaleString. */
export function formatTime(input: TimestampInput): string {
    return new Date(toMs(input)).toLocaleString();
}

/** Compact duration "{N}{s|m|h|d}" with no "ago" suffix. */
export function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}

/** Compact age ("3s", "5m") of a past timestamp, for monitoring tables. */
export function formatAge(ts: number): string {
    return formatDuration(Math.floor((Date.now() - ts) / 1000));
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
