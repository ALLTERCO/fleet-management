/** Read a CSS custom property at runtime and convert it into a value our
 *  WebGL renderers can consume.
 *
 *  Three.js + MapLibre layers can't directly bind `var(--color-primary)`
 *  the way a stylesheet does. These small helpers pull the live computed
 *  value (which respects theme toggles) and hand it back as a `Color` or
 *  string. Centralised here so every renderer reads tokens the same way. */

import {Color} from 'three';

/** Read a CSS custom property string. Returns the fallback when the
 *  document is unavailable (SSR / test env) or the property is unset. */
export function readTokenString(name: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    return raw.length > 0 ? raw : fallback;
}

/** Resolve a CSS custom property into a Three.js Color. Accepts any
 *  CSS color string the token might hold (hex, rgb, rgba, hsl, …) and
 *  returns the fallback color if parsing fails. */
export function resolveBrandColor(name: string, fallbackHex: string): Color {
    const raw = readTokenString(name, fallbackHex);
    const parsed = new Color();
    try {
        parsed.set(raw);
    } catch {
        parsed.set(fallbackHex);
    }
    return parsed;
}
