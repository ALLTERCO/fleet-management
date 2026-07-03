// Negative deltas collapse to "just now" — clock-skew safety.
export function formatRelative(elapsedMs: number): string {
    if (elapsedMs < 0) return 'just now';
    const sec = Math.floor(elapsedMs / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
}

export function isStale(
    lastUpdateMs: number | undefined,
    expectedIntervalMs: number | undefined,
    nowMs: number
): boolean {
    if (!lastUpdateMs || !expectedIntervalMs) return false;
    return nowMs - lastUpdateMs > expectedIntervalMs;
}
