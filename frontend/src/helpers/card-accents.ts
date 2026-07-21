/**
 * Card accent color helpers.
 *
 * Maps entity type → CSS accent variable for the DRY `--ar` system.
 * Each card sets `style="--ar: var(--accent-{type})"` so all accent-derived
 * CSS (icon bg, hover glow, ON tint, active border) references `--ar`.
 */

const ACCENT_MAP: Record<string, string> = {
    switch: 'var(--accent-switch)',
    cb: 'var(--accent-cb)',
    light: 'var(--accent-dimmer)',
    dimmer: 'var(--accent-dimmer)',
    rgbw: 'var(--accent-rgbw)',
    rgb: 'var(--accent-rgbw)',
    cct: 'var(--accent-rgbw)',
    rgbcct: 'var(--accent-rgbw)',
    cover: 'var(--accent-cover)',
    roller: 'var(--accent-cover)',
    energy: 'var(--accent-energy)',
    em: 'var(--accent-energy)',
    em3: 'var(--accent-em3)',
    em1: 'var(--accent-energy)',
    pm1: 'var(--accent-energy)',
    temp: 'var(--accent-temp)',
    temperature: 'var(--accent-temp)',
    humidity: 'var(--accent-humidity)',
    thermostat: 'var(--accent-trv)',
    motion: 'var(--accent-motion)',
    door: 'var(--accent-door)',
    window: 'var(--accent-door)',
    flood: 'var(--accent-flood)',
    smoke: 'var(--accent-smoke)',
    trv: 'var(--accent-trv)',
    button: 'var(--accent-button)',
    inputbtn: 'var(--accent-button)',
    input: 'var(--accent-input)',
    camera: 'var(--accent-camera)',
    audio: 'var(--accent-audio)',
    media: 'var(--accent-audio)',
    illuminance: 'var(--accent-illuminance)',
    generic: 'var(--accent-generic)',
    voltmeter: 'var(--accent-energy)',
    voltage: 'var(--accent-energy)',
    cury: 'var(--accent-switch)',
    group: 'var(--accent-generic)',
    bthomedevice: 'var(--accent-temp)',
    bthomecontrol: 'var(--accent-button)',
    service: 'var(--accent-temp)'
};

/** Default accent when entity type is unknown */
const DEFAULT_ACCENT = 'var(--accent-switch)';

/**
 * Returns the CSS variable reference for an entity type's accent color.
 * Use inside `rgba(${getAccentVar(type)}, 0.1)` or bind to `--ar`.
 */
export function getAccentVar(entityType: string): string {
    return ACCENT_MAP[entityType.toLowerCase()] ?? DEFAULT_ACCENT;
}

/**
 * Returns a data-type value suitable for the `.ec[data-type="..."]` CSS selector.
 * Normalizes aliases (e.g. 'roller' → 'cover', 'rgb' → 'rgbw').
 */
const TYPE_NORMALIZE: Record<string, string> = {
    light: 'dimmer',
    roller: 'cover',
    rgb: 'rgbw',
    cct: 'rgbw',
    rgbcct: 'bulb',
    em: 'energy',
    em1: 'energy',
    pm1: 'energy',
    temperature: 'temp',
    thermostat: 'trv',
    window: 'door',
    media: 'audio',
    input: 'inputbtn',
    voltmeter: 'voltage',
    cury: 'cury'
};

export function normalizeCardType(entityType: string): string {
    const lower = entityType.toLowerCase();
    return TYPE_NORMALIZE[lower] ?? lower;
}

/**
 * Returns inline style object to set `--ar` on a card element.
 * Preferred over data-type when you need programmatic control.
 */
export function getAccentStyle(entityType: string): Record<string, string> {
    return {'--ar': getAccentVar(entityType)};
}
