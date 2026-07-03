// Per-TOU-window cost split. Today's report flattens TOU into one cost
// number; this helper restores the per-window detail (peak / shoulder /
// off-peak) so users can see where their bill goes.

export interface TouWindow {
    readonly label: string;
    readonly startHour: number; // 0..23 inclusive
    readonly endHour: number; // 0..23 inclusive — wraps midnight when end < start
    readonly rate: number; // currency per kWh
}

export interface TouHourlySample {
    readonly hourOfDay: number; // 0..23
    readonly kWh: number;
}

export interface TouWindowRow {
    readonly label: string;
    readonly kWh: number;
    readonly cost: number;
    readonly sharePct: number; // % of total kWh, rounded to 1dp
}

export interface TouBreakdown {
    readonly rows: readonly TouWindowRow[];
    readonly totalKWh: number;
    readonly totalCost: number;
}

export function computeTouWindowBreakdown(input: {
    readonly samples: readonly TouHourlySample[];
    readonly windows: readonly TouWindow[];
}): TouBreakdown {
    if (input.windows.length === 0)
        return {rows: [], totalKWh: 0, totalCost: 0};
    const totals = new Array<{kWh: number; cost: number}>(input.windows.length);
    for (let i = 0; i < input.windows.length; i += 1)
        totals[i] = {kWh: 0, cost: 0};

    for (const sample of input.samples) {
        if (!isValidSample(sample)) continue;
        const windowIndex = pickWindow(sample.hourOfDay, input.windows);
        if (windowIndex === null) continue;
        totals[windowIndex].kWh += sample.kWh;
        totals[windowIndex].cost +=
            sample.kWh * input.windows[windowIndex].rate;
    }
    return finalise(input.windows, totals);
}

function isValidSample(sample: TouHourlySample): boolean {
    return (
        Number.isInteger(sample.hourOfDay) &&
        sample.hourOfDay >= 0 &&
        sample.hourOfDay <= 23 &&
        Number.isFinite(sample.kWh) &&
        sample.kWh >= 0
    );
}

function pickWindow(
    hour: number,
    windows: readonly TouWindow[]
): number | null {
    for (let i = 0; i < windows.length; i += 1) {
        if (hourIsInWindow(hour, windows[i])) return i;
    }
    return null;
}

function hourIsInWindow(hour: number, window: TouWindow): boolean {
    if (window.startHour <= window.endHour) {
        return hour >= window.startHour && hour <= window.endHour;
    }
    // Window wraps midnight (e.g. 22..6).
    return hour >= window.startHour || hour <= window.endHour;
}

function finalise(
    windows: readonly TouWindow[],
    totals: ReadonlyArray<{kWh: number; cost: number}>
): TouBreakdown {
    const totalKWh = totals.reduce((sum, t) => sum + t.kWh, 0);
    const rows = windows.map((window, i) => ({
        label: window.label,
        kWh: round3(totals[i].kWh),
        cost: round2(totals[i].cost),
        sharePct:
            totalKWh > 0
                ? Math.round((totals[i].kWh / totalKWh) * 1000) / 10
                : 0
    }));
    const totalCost = totals.reduce((sum, t) => sum + t.cost, 0);
    return {rows, totalKWh: round3(totalKWh), totalCost: round2(totalCost)};
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

function round3(v: number): number {
    return Math.round(v * 1000) / 1000;
}
