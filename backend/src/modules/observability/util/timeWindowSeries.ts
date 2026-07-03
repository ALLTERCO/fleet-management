export interface TimestampedSample {
    ts: number;
    value: number;
}

export function seriesFor<T>(map: Map<string, T[]>, name: string): T[] {
    const existing = map.get(name);
    if (existing) return existing;
    const fresh: T[] = [];
    map.set(name, fresh);
    return fresh;
}

export function dropExpiredBefore(
    samples: {ts: number}[],
    cutoff: number
): void {
    while (samples.length > 0 && samples[0].ts < cutoff) samples.shift();
}

export function capSeriesSize<T>(samples: T[], cap: number): void {
    while (samples.length > cap) samples.shift();
}
