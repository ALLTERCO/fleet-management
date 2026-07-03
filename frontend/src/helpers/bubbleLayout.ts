// Pure layout math for DashFleetBubbles.

export interface BubbleInput {
    readonly id: number | string;
    readonly metric: number;
}

export interface PlacedBubble<T extends BubbleInput> {
    readonly input: T;
    readonly cx: number;
    readonly cy: number;
    readonly r: number;
}

export interface LayoutOptions {
    readonly width: number;
    readonly height: number;
    readonly minRadius: number;
    readonly maxRadius: number;
    readonly padding: number;
}

const DEFAULT_OPTIONS: LayoutOptions = {
    width: 600,
    height: 320,
    minRadius: 8,
    maxRadius: 36,
    padding: 6
};

export function layoutBubbles<T extends BubbleInput>(
    bubbles: readonly T[],
    overrides: Partial<LayoutOptions> = {}
): readonly PlacedBubble<T>[] {
    if (bubbles.length === 0) return [];
    const opts = {...DEFAULT_OPTIONS, ...overrides};
    const radii = computeRadii(bubbles, opts);
    return packGrid(bubbles, radii, opts);
}

function computeRadii<T extends BubbleInput>(
    bubbles: readonly T[],
    opts: LayoutOptions
): readonly number[] {
    const metrics = bubbles.map((b) => Math.max(0, b.metric));
    const max = Math.max(...metrics, 0);
    if (max <= 0) return bubbles.map(() => opts.minRadius);
    const range = opts.maxRadius - opts.minRadius;
    return metrics.map((m) => opts.minRadius + (m / max) * range);
}

function packGrid<T extends BubbleInput>(
    bubbles: readonly T[],
    radii: readonly number[],
    opts: LayoutOptions
): readonly PlacedBubble<T>[] {
    const cellSize = opts.maxRadius * 2 + opts.padding * 2;
    const cols = Math.max(1, Math.floor(opts.width / cellSize));
    const placed: PlacedBubble<T>[] = [];
    for (let i = 0; i < bubbles.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = cellSize / 2 + col * cellSize;
        const cy = cellSize / 2 + row * cellSize;
        placed.push({input: bubbles[i], cx, cy, r: radii[i]});
    }
    return placed;
}

// Total height required to render a layout of N bubbles at the given width.
export function requiredHeight(
    bubbleCount: number,
    opts: Partial<LayoutOptions> = {}
): number {
    const merged = {...DEFAULT_OPTIONS, ...opts};
    if (bubbleCount === 0) return merged.height;
    const cellSize = merged.maxRadius * 2 + merged.padding * 2;
    const cols = Math.max(1, Math.floor(merged.width / cellSize));
    const rows = Math.ceil(bubbleCount / cols);
    return Math.max(merged.height, rows * cellSize);
}
