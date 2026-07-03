// Color contrast utilities. Pure math over hex strings — used wherever
// admin-supplied colors need a contrasting foreground (login chrome,
// preview tiles, badge text).

// Accepts #rgb, #rrggbb, and #rrggbbaa. Anything else is invalid and
// returned as a mid-luminance fallback by the helpers below.
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Threshold above which a color is "light enough" that dark text reads
// better against it. WCAG-style midpoint; not relative-contrast-ratio
// (that would need the second color too).
const LIGHT_LUMINANCE_THRESHOLD = 0.5;

// Answer — true if the input parses as a CSS hex color.
export function isHexColor(color: string): boolean {
    return HEX_RE.test(color);
}

// Answer — relative luminance per WCAG. Returns 0.5 for invalid input so
// callers can still pick a sensible foreground.
export function relativeLuminance(color: string): number {
    const match = color.match(HEX_RE);
    if (!match) return LIGHT_LUMINANCE_THRESHOLD;
    const hex = expandShortHex(match[1]);
    const linear = (eight: number): number => {
        const c = eight / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const r = linear(Number.parseInt(hex.slice(0, 2), 16));
    const g = linear(Number.parseInt(hex.slice(2, 4), 16));
    const b = linear(Number.parseInt(hex.slice(4, 6), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Answer — a foreground hex color (default white/dark text) that reads
// better against the background. Useful when the bg is admin-supplied
// and may be anything.
export function readableForeground(
    background: string,
    options: {light?: string; dark?: string} = {}
): string {
    const light = options.light ?? '#ffffff';
    const dark = options.dark ?? '#0f172a';
    return relativeLuminance(background) > LIGHT_LUMINANCE_THRESHOLD
        ? dark
        : light;
}

// Pure helper — turn '#rgb' or '#rrggbbaa' into '#rrggbb'.
function expandShortHex(body: string): string {
    if (body.length === 3) {
        return body
            .split('')
            .map((c) => c + c)
            .join('');
    }
    return body.slice(0, 6);
}
