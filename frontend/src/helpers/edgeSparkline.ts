// Normalised polyline points for a per-edge throughput sparkline.
// Returns empty string when there are fewer than 2 samples.

export interface SparklineBox {
    width: number;
    height: number;
}

interface SamplePosition {
    index: number;
    total: number;
    peak: number;
    box: SparklineBox;
}

export function sparklinePoints(
    samples: readonly number[],
    box: SparklineBox
): string {
    if (samples.length < 2) return '';
    const peak = peakOf(samples);
    if (peak === 0) return baselinePoints(samples.length, box);
    return samples
        .map((value, index) =>
            samplePoint(value, {index, total: samples.length, peak, box})
        )
        .join(' ');
}

function peakOf(samples: readonly number[]): number {
    let max = 0;
    for (const v of samples) if (v > max) max = v;
    return max;
}

function baselinePoints(count: number, box: SparklineBox): string {
    const y = box.height - 1;
    return Array.from({length: count}, (_, index) =>
        formatPoint(horizontalAt(index, {total: count, width: box.width}), y)
    ).join(' ');
}

function samplePoint(value: number, position: SamplePosition): string {
    const x = horizontalAt(position.index, {
        total: position.total,
        width: position.box.width
    });
    const normalised = value / position.peak;
    const y = position.box.height - normalised * (position.box.height - 2) - 1;
    return formatPoint(x, y);
}

function horizontalAt(
    index: number,
    layout: {total: number; width: number}
): number {
    return (index / (layout.total - 1)) * layout.width;
}

function formatPoint(x: number, y: number): string {
    return `${x.toFixed(1)},${y.toFixed(1)}`;
}

export function averageOf(samples: readonly number[]): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (const v of samples) sum += v;
    return sum / samples.length;
}
