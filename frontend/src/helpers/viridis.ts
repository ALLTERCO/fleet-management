// Viridis 10-stop palette resolved from --viridis-* tokens at call time.
// Used by HexagonLayer.colorRange and heatmap colorRange — both prefer
// RGB-triplet arrays, so we parse hex once and cache by-document.

const STOPS = 10;
const FALLBACK: ReadonlyArray<[number, number, number]> = [
    [68, 1, 84],
    [72, 40, 120],
    [62, 73, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [108, 206, 88],
    [181, 222, 43],
    [253, 231, 37]
];

function parseHex(hex: string): [number, number, number] | null {
    const h = hex.replace('#', '').trim();
    const full =
        h.length === 3
            ? h
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : h;
    if (full.length !== 6) return null;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return [r, g, b];
}

export function viridisColorRange(): Array<[number, number, number]> {
    if (typeof document === 'undefined') return [...FALLBACK];
    const root = getComputedStyle(document.documentElement);
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < STOPS; i++) {
        const raw = root.getPropertyValue(`--viridis-${i}`)?.trim();
        const parsed = raw ? parseHex(raw) : null;
        out.push(parsed ?? FALLBACK[i]);
    }
    return out;
}
