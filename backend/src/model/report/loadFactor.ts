// Load factor = avg power / peak power. Reveals how peaky a load is —
// a value near 1 means the load is flat (good for grid); near 0 means
// short spikes dominate (drives demand charges).

export interface LoadFactorInput {
    readonly avgKW: number;
    readonly peakKW: number;
}

export function computeLoadFactor(input: LoadFactorInput): number | null {
    if (!Number.isFinite(input.avgKW) || !Number.isFinite(input.peakKW)) {
        return null;
    }
    if (input.peakKW <= 0) return null;
    if (input.avgKW < 0) return null;
    const ratio = input.avgKW / input.peakKW;
    return Math.min(1, Math.max(0, Math.round(ratio * 1000) / 1000));
}
