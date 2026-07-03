/** Resolve a CSS custom property from :root to its computed value (trimmed).
 *  Returns empty string if not defined. SSR-safe (guards document access). */
function cssVar(name: string): string {
    if (typeof document === 'undefined') return '';
    return getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
}

/** Chart palette — single source of truth for chart-friendly colors.
 *  Backed by design-tokens.css; reading via CSS vars means theme changes
 *  propagate automatically. Each property is a getter so values stay live.
 *
 *  Use in chart components instead of hardcoded hex literals. */
export const chartColors = {
    /* Brand / status */
    get primary() {
        return cssVar('--color-primary');
    },
    get primaryHover() {
        return cssVar('--color-primary-hover');
    },
    get success() {
        return cssVar('--color-success-text');
    },
    get danger() {
        return cssVar('--color-danger-text');
    },
    get warning() {
        return cssVar('--color-warning-text');
    },
    get info() {
        return cssVar('--color-info-text');
    },
    get accent() {
        return cssVar('--color-accent');
    },
    get statusOn() {
        return cssVar('--color-status-on');
    },
    get statusOff() {
        return cssVar('--color-status-off');
    },
    get statusWarn() {
        return cssVar('--color-status-warn');
    },
    /* Categorical palette (--chart-color-1..8) */
    get chart1() {
        return cssVar('--chart-color-1');
    },
    get chart2() {
        return cssVar('--chart-color-2');
    },
    get chart3() {
        return cssVar('--chart-color-3');
    },
    get chart4() {
        return cssVar('--chart-color-4');
    },
    get chart5() {
        return cssVar('--chart-color-5');
    },
    get chart6() {
        return cssVar('--chart-color-6');
    },
    get chart7() {
        return cssVar('--chart-color-7');
    },
    get chart8() {
        return cssVar('--chart-color-8');
    },
    /* Chart chrome */
    get grid() {
        return cssVar('--chart-grid');
    },
    get axis() {
        return cssVar('--chart-axis');
    },
    get tooltipBg() {
        return cssVar('--chart-tooltip-bg');
    },
    get tooltipBorder() {
        return cssVar('--chart-tooltip-border');
    },
    /* Text */
    get textPrimary() {
        return cssVar('--color-text-primary');
    },
    get textSecondary() {
        return cssVar('--color-text-secondary');
    },
    get textTertiary() {
        return cssVar('--color-text-tertiary');
    },
    get textDisabled() {
        return cssVar('--color-text-disabled');
    },
    get overlayFaint() {
        return cssVar('--color-chart-overlay-faint');
    },
    get overlaySubtle() {
        return cssVar('--color-chart-overlay-subtle');
    },
    get overlaySoft() {
        return cssVar('--color-chart-overlay-soft');
    }
};

/** Convert 6-char hex, rgb(), or rgba() color to rgba string with given opacity.
 *  Does NOT handle 3-char hex (#abc), named colors, or hsl(). */
export function hexToRgba(color: string, opacity: number): string {
    if (color.startsWith('rgba')) {
        return color.replace(/,\s*[\d.]+\)$/, `,${opacity})`);
    }
    if (color.startsWith('rgb')) {
        return color.replace('rgb(', 'rgba(').replace(')', `,${opacity})`);
    }
    const h = color.replace('#', '');
    const r = Number.parseInt(h.substring(0, 2), 16);
    const g = Number.parseInt(h.substring(2, 4), 16);
    const b = Number.parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${opacity})`;
}

/** Format number with locale commas and fixed decimals */
export function formatMetric(
    value: number | null | undefined,
    decimals = 1
): string {
    if (value == null) return '\u2014';
    return value.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
    });
}
