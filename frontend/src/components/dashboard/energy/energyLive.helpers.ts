// Pure aggregation helpers for the live energy fetches in [id].vue — extracted
// so the bucket/tag/role math is unit-tested independently of the page.

/** Buckets with the fleet min voltage under 207 V or max over 253 V (EN 50160). */
export function countVoltageEvents(items: {bucket: string; tag: string; value: number}[]): number {
    const byBucket = new Map<string, {min?: number; max?: number}>();
    for (const it of items) {
        const slot = byBucket.get(it.bucket) ?? {};
        if (it.tag === 'min_voltage') slot.min = it.value;
        if (it.tag === 'max_voltage') slot.max = it.value;
        byBucket.set(it.bucket, slot);
    }
    let events = 0;
    for (const {min, max} of byBucket.values()) {
        if ((typeof min === 'number' && min < 207) || (typeof max === 'number' && max > 253)) events++;
    }
    return events;
}

/** Mean of each environmental tag across the returned buckets; null when absent. */
export function averageByTag(items: {tag: string; value: number}[]): {
    temp: number | null;
    humidity: number | null;
    luminance: number | null;
    flow: number | null;
} {
    const mean = (tag: string) => {
        const vals = items.filter((i) => i.tag === tag).map((i) => i.value);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {temp: mean('temperature'), humidity: mean('humidity'), luminance: mean('luminance'), flow: null};
}

/** Per-day-average hourly kWh profile (24 values) for the matching days of week. */
export function hourlyProfile(
    raw: {day: number; hour: number; value: number}[],
    dayMatch: (d: number) => boolean,
    dayCount: number
): number[] {
    const sum = new Array(24).fill(0);
    for (const p of raw) if (dayMatch(p.day)) sum[p.hour] += p.value;
    return dayCount > 0 ? sum.map((s) => s / dayCount) : sum;
}

/** Value of one role from a groupBy='role' response (0 when absent). */
export function roleKwh(groups: {key: string; value: number}[] | undefined, role: string): number {
    return (groups ?? []).find((g) => g.key === role)?.value ?? 0;
}

/** Signed % change vs a prior value, formatted "+5%" / "-3%"; '' with no baseline. */
export function deltaLabel(current: number, prior: number | undefined): string {
    if (prior === undefined || !Number.isFinite(prior) || prior === 0) return '';
    const pct = Math.round(((current - prior) / Math.abs(prior)) * 100);
    return `${pct >= 0 ? '+' : ''}${pct}%`;
}
