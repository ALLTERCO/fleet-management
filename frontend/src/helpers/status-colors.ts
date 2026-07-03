// Single source for status colors used by map pins (deck.gl) and floor-plan
// device sprites (PixiJS). Reads design tokens fresh each call so changes
// to the brand palette propagate without a cache invalidation hook.

import type {MapPin} from '@/types/map';

export type StatusKey = NonNullable<MapPin['status']>;

// SSR fallback — keep in sync with --color-status-* tokens.
const FALLBACK: Record<StatusKey, string> = {
    on: '#22c08e',
    off: '#c0293d',
    warn: '#e89d22',
    unknown: '#6b737c'
};

const TOKEN: Record<StatusKey, string> = {
    on: '--color-status-on',
    off: '--color-status-off',
    warn: '--color-status-warn',
    unknown: '--color-status-unknown'
};

function resolve(status: StatusKey): string {
    if (typeof document === 'undefined') return FALLBACK[status];
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(TOKEN[status])
        ?.trim();
    return v || FALLBACK[status];
}

function parseHex(hex: string): {r: number; g: number; b: number} {
    const h = hex.replace('#', '');
    const full =
        h.length === 3
            ? h
                  .split('')
                  .map((c) => c + c)
                  .join('')
            : h;
    return {
        r: Number.parseInt(full.slice(0, 2), 16) || 0,
        g: Number.parseInt(full.slice(2, 4), 16) || 0,
        b: Number.parseInt(full.slice(4, 6), 16) || 0
    };
}

export function statusHex(status: StatusKey): string {
    return resolve(status);
}

export function statusInt(status: StatusKey): number {
    const {r, g, b} = parseHex(resolve(status));
    return (r << 16) | (g << 8) | b;
}

export function statusRgba(
    status: StatusKey,
    alpha = 230
): [number, number, number, number] {
    const {r, g, b} = parseHex(resolve(status));
    return [r, g, b, alpha];
}
