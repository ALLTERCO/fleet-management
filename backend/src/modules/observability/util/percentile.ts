// Nearest-rank percentile over an unsorted array.
export function percentile(values: readonly number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
    return sorted[idx];
}
