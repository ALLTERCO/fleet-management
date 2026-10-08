// What a colour on an architectural drawing *means*.
//
// The rule is derived from a real customer file (Shelly's Building 3 Floor 2
// test fit, AutoCAD 2022 → PDF → pdftocairo). That drawing carries 16 distinct
// fills and no layer names at all, so colour is the only evidence there is:
//
//   #000000 x1401 fill  walls (solid poché)     #ffffff x14897  furniture
//   #969696 x186        secondary linework      #d7ebd2 x8100   floor hatch
//   #4d58b3 #60859f #759f7b #a5f47b #a29b5d ... team zones, 3-9 paths each
//
// The naive rule — "dark means wall" — is wrong on this data: #4d58b3
// (PRODUCT OWNERS) has luminance 0.118, *darker* than #60859f (0.218) and
// darker than any sane black threshold. What actually separates structure
// from zoning is chroma, not darkness: a draughtsman draws structure in ink
// (black or grey, no hue) and means something by every hue they add.
//
// So: achromatic and not light -> ink -> structure.
//     very light               -> paper -> background, furniture, hatch.
//     anything with a hue      -> tint  -> somebody chose this colour.

export interface Rgb {
    /** 0..1 per channel. */
    readonly r: number;
    readonly g: number;
    readonly b: number;
}

/** ink   — structural linework, the wall signal.
 *  paper — page, floor fill and white furniture: no signal.
 *  tint  — a deliberate colour, the zone signal. */
export type PaintRole = 'ink' | 'paper' | 'tint';

// Widest chroma among the greys in the reference file is 0 (#969696,
// #b8b8b8, #e6e6e6); the narrowest real hue is #759f7b at 0.165. The gap is
// wide, so the threshold does not need to be tuned finely — but the pale
// floor hatch #d7ebd2 sits at 0.098, and calling it achromatic is correct:
// it is a wash, not a zone colour.
const ACHROMATIC_MAX_CHROMA = 0.12;

// Above this an achromatic paint is a light wash rather than linework.
// #e6e6e6 (0.791) reads as a filled region, #b8b8b8 (0.479) as linework.
const INK_MAX_LUMINANCE = 0.6;

// Near-white is the page. #e0fff7 (0.941) is the drawing's own background
// wash and covers 22% of the sheet in a single path — without this it would
// be the largest "zone" in the file.
const PAPER_MIN_LUMINANCE = 0.9;

/** Parse any paint an SVG can carry into linear-free 0..1 RGB. Returns null
 *  for "no paint here" — `none`, `transparent`, gradients, `currentColor`,
 *  and any named colour outside the handful below. Null is not an error: it
 *  means this element offers no colour evidence, which the resolver counts. */
export function parseSvgPaint(value: string | null | undefined): Rgb | null {
    if (!value) return null;
    const raw = value.trim().toLowerCase();
    if (isUnpainted(raw)) return null;

    const named = NAMED_PAINTS[raw];
    if (named) return named;

    if (raw.startsWith('#')) return parseHex(raw);
    if (raw.startsWith('rgb')) return parseRgbFunction(raw);
    return null;
}

/** A paint value that deliberately says "nothing is drawn here". Distinct
 *  from a value we failed to understand: `fill="none"` is the single most
 *  common paint in a CAD export and counting it as a parse failure would
 *  make every healthy file look broken in the report. */
export function isUnpainted(value: string | null | undefined): boolean {
    if (!value) return true;
    const raw = value.trim().toLowerCase();
    return raw === '' || raw === 'none' || raw === 'transparent';
}

/** WCAG relative luminance. Perceptual, so a mid grey and a mid blue do not
 *  land in the same bucket the way a naive channel average puts them. */
export function relativeLuminance(rgb: Rgb): number {
    return (
        0.2126 * toLinear(rgb.r) +
        0.7152 * toLinear(rgb.g) +
        0.0722 * toLinear(rgb.b)
    );
}

/** How much hue a paint carries: 0 for any grey, 1 for a pure primary. */
export function chroma(rgb: Rgb): number {
    return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b);
}

export function classifyPaint(rgb: Rgb): PaintRole {
    const luminance = relativeLuminance(rgb);
    if (luminance >= PAPER_MIN_LUMINANCE) return 'paper';
    if (chroma(rgb) <= ACHROMATIC_MAX_CHROMA) {
        return luminance <= INK_MAX_LUMINANCE ? 'ink' : 'paper';
    }
    return 'tint';
}

/** Stable `#rrggbb` key so paths of one colour group together, and so a zone
 *  proposal can be handed straight to a colour swatch in the UI. */
export function toHexKey(rgb: Rgb): string {
    return `#${channelHex(rgb.r)}${channelHex(rgb.g)}${channelHex(rgb.b)}`;
}

// Only the names that turn up in hand-written and Inkscape SVG. Anything
// else parses to null rather than being guessed at.
const NAMED_PAINTS: Readonly<Record<string, Rgb>> = {
    black: {r: 0, g: 0, b: 0},
    white: {r: 1, g: 1, b: 1},
    gray: {r: 128 / 255, g: 128 / 255, b: 128 / 255},
    grey: {r: 128 / 255, g: 128 / 255, b: 128 / 255}
};

function parseHex(raw: string): Rgb | null {
    const body = raw.slice(1);
    if (body.length === 3 || body.length === 4) {
        const digits = [...body.slice(0, 3)].map((c) => c + c).join('');
        return hexTriplet(digits);
    }
    if (body.length === 6 || body.length === 8) {
        return hexTriplet(body.slice(0, 6));
    }
    return null;
}

function hexTriplet(six: string): Rgb | null {
    if (!/^[0-9a-f]{6}$/.test(six)) return null;
    return {
        r: Number.parseInt(six.slice(0, 2), 16) / 255,
        g: Number.parseInt(six.slice(2, 4), 16) / 255,
        b: Number.parseInt(six.slice(4, 6), 16) / 255
    };
}

// pdftocairo writes percentages — `rgb(87.841797%, 100%, 96.862793%)` — while
// Illustrator and Inkscape write 0-255. Both are the same function.
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/;

function parseRgbFunction(raw: string): Rgb | null {
    const match = RGB_FUNCTION.exec(raw);
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter((p) => p.length > 0);
    if (parts.length < 3) return null;
    const channels = parts.slice(0, 3).map(readChannel);
    if (channels.some((c) => c === null)) return null;
    const [r, g, b] = channels as number[];
    return {r, g, b};
}

function readChannel(part: string): number | null {
    const percent = part.endsWith('%');
    const n = Number.parseFloat(percent ? part.slice(0, -1) : part);
    if (!Number.isFinite(n)) return null;
    return clamp01(percent ? n / 100 : n / 255);
}

// sRGB → linear light, the transfer function relative luminance is defined on.
function toLinear(channel: number): number {
    return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
}

function channelHex(channel: number): string {
    return Math.round(clamp01(channel) * 255)
        .toString(16)
        .padStart(2, '0');
}

function clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}
