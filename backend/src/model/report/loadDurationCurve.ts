// Classic energy-audit chart: how many hours each power band was active.
// A long top-band tail means peak-shaving is worth it.

export interface LoadDurationInput {
    readonly hourlyPowerKW: readonly number[];
    /** Inclusive lower edges of each band in kW, sorted ascending. The
     *  highest band catches every value above its lower edge. */
    readonly bandLowerEdgesKW: readonly number[];
}

export interface LoadDurationBand {
    readonly fromKW: number;
    readonly toKW: number | null; // null = unbounded above
    readonly hours: number;
    readonly sharePct: number; // 0..100, rounded to 1dp
}

export function buildLoadDurationCurve(
    input: LoadDurationInput
): readonly LoadDurationBand[] {
    if (input.bandLowerEdgesKW.length === 0) return [];
    const edges = sortedAscending(input.bandLowerEdgesKW);
    const counts = new Array<number>(edges.length).fill(0);
    let totalSamples = 0;
    for (const sample of input.hourlyPowerKW) {
        const bandIndex = findBandIndex(sample, edges);
        if (bandIndex === null) continue;
        counts[bandIndex] += 1;
        totalSamples += 1;
    }
    return materialiseBands(edges, counts, totalSamples);
}

function sortedAscending(edges: readonly number[]): number[] {
    return [...edges].filter((e) => Number.isFinite(e)).sort((a, b) => a - b);
}

function findBandIndex(
    sample: number,
    edges: readonly number[]
): number | null {
    if (!Number.isFinite(sample) || sample < edges[0]) return null;
    let chosen = 0;
    for (let i = 0; i < edges.length; i += 1) {
        if (sample >= edges[i]) chosen = i;
        else break;
    }
    return chosen;
}

function materialiseBands(
    edges: readonly number[],
    counts: readonly number[],
    totalSamples: number
): LoadDurationBand[] {
    return edges.map((fromKW, i) => ({
        fromKW,
        toKW: i + 1 < edges.length ? edges[i + 1] : null,
        hours: counts[i],
        sharePct:
            totalSamples > 0
                ? Math.round((counts[i] / totalSamples) * 1000) / 10
                : 0
    }));
}
