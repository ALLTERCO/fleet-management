// iOS 26 Apple Maps place marker — circular disc, anchored at center so the
// pin sits exactly on the geographic coordinate (no tail-offset perception
// bug). Solid status fill, white border ring, soft shadow, optional red
// notification badge for alerting pins. No SVG filters (rasterize poorly
// through deck.gl's IconLayer pipeline).

import {statusHex} from '@/helpers/status-colors';
import type {MapPin} from '@/types/map';

export const PIN_SPRITE_W = 36;
export const PIN_SPRITE_H = 36;
export const PIN_ANCHOR_X = 18;
export const PIN_ANCHOR_Y = 18; // Center — pin sits on the coordinate.
export const PIN_SELECTED_SCALE = 1.22;

const BODY_R = 11;
const SHADOW_RX = 8;
const SHADOW_RY = 2;
const GLYPH: Record<string, string> = {warn: '!', off: '×'};

interface SpriteOpts {
    alerting: boolean;
}

function buildSprite(status: string, opts: SpriteOpts): string {
    const fill = statusHex(status as never);
    const glyph = GLYPH[status] ?? '';
    const cx = PIN_ANCHOR_X;
    const cy = PIN_ANCHOR_Y;

    // Stacked shadows below the disc for soft depth (no SVG filters).
    const shadow = [
        `<ellipse cx="${cx}" cy="${cy + BODY_R + 2}" rx="${SHADOW_RX}" ry="${SHADOW_RY}" fill="rgba(0,0,0,0.32)"/>`,
        `<ellipse cx="${cx}" cy="${cy + BODY_R + 1}" rx="${SHADOW_RX - 2}" ry="${SHADOW_RY - 0.5}" fill="rgba(0,0,0,0.28)"/>`
    ].join('');

    const body = `<circle cx="${cx}" cy="${cy}" r="${BODY_R}" fill="${fill}" stroke="#ffffff" stroke-width="2.25"/>`;

    const text = glyph
        ? `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="800" fill="#ffffff">${glyph}</text>`
        : '';

    // Red notification badge top-right when alerting (Apple convention).
    const badge = opts.alerting
        ? `<circle cx="${cx + 8}" cy="${cy - 8}" r="4.5" fill="#ff3b30" stroke="#ffffff" stroke-width="1.5"/>`
        : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_SPRITE_W}" height="${PIN_SPRITE_H}" viewBox="0 0 ${PIN_SPRITE_W} ${PIN_SPRITE_H}">${shadow}${body}${text}${badge}</svg>`;
}

export function pinSpriteUrl(pin: MapPin): string {
    const status = pin.status ?? 'unknown';
    const svg = buildSprite(status, {alerting: (pin.alertCount ?? 0) > 0});
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
