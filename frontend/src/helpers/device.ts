import {getEntityIcon} from '@/config/entity-registry';
import {BUNDLED_DEVICE_IMAGES} from '@/helpers/deviceImageManifest';
import type {shelly_device_t} from '@/types';

export function deviceSupports(
    device: {methods?: string[]} | null | undefined,
    ...required: string[]
): boolean {
    const have = device?.methods;
    if (!have?.length || required.length === 0) return false;
    return required.every((m) => have.includes(m));
}

export function getLogo(device?: shelly_device_t | undefined) {
    const deviceInfo = device?.info;
    if (deviceInfo === undefined || deviceInfo.model === undefined) {
        return '/images/branding/shelly_logo_black.jpg';
    }

    // Check for Cury device (shellyID starts with "cury-" or app is "Cury")
    if (device?.shellyID?.startsWith('cury-') || deviceInfo.app === 'Cury') {
        return '/images/devices/cury.png';
    }

    return getLogoFromModel(deviceImageSku(deviceInfo));
}

// CDN image key: modular devices (XT1 service / XMOD product) key by their
// service/product code, not the base model. Falls back to the model SKU.
export function deviceImageSku(
    deviceInfo: NonNullable<shelly_device_t['info']>
): string | undefined {
    const jwt = deviceInfo.jwt;
    if (jwt != null && typeof jwt === 'object') {
        const svcType = jwt?.xt1?.svc0?.type;
        if (typeof svcType === 'string') return svcType;
        const prefix = jwt.p;
        if (typeof prefix === 'string' && prefix.length > 0) return prefix;
    }
    return deviceInfo.model;
}

const CLOUD_CDN = 'https://control.shelly.cloud/images/device_images';

function normalizeModel(model: string): string {
    if (
        model.length > 5 &&
        model.charAt(2) === 'S' &&
        model.charAt(3) === 'W' &&
        model.charAt(5) !== '0'
    ) {
        const temp = model.split('');
        temp[5] = '0';
        model = temp.join('');
    }
    return model;
}

/** Local (bundled) → cloud → generic. Models we ship an image for are served
 *  from the same origin (no CDN round-trip, no 404 probe); everything else
 *  falls back to the cloud CDN. Any tier already marked bad this session is
 *  skipped, so a network round-trip + console 404 fires at most once per
 *  (model, tier) per tab. */
export function getLogoFromModel(model?: string) {
    if (!model || model === 'S3MX-0A') return GENERIC_LOGO;
    const normalized = normalizeModel(model);
    const local = `/images/devices/${normalized}.png`;
    // Bundled locally → serve it directly. Fast: same origin, no CDN fetch.
    if (BUNDLED_DEVICE_IMAGES.has(normalized) && !isKnownBadImageUrl(local)) {
        return local;
    }
    // Not bundled → cloud CDN, then any local, then generic.
    const cloud = `${CLOUD_CDN}/${normalized}.png`;
    if (!isKnownBadImageUrl(cloud)) return cloud;
    if (!isKnownBadImageUrl(local)) return local;
    return GENERIC_LOGO;
}

/** Local fallback when cloud URL fails (private networks, offline). */
export function getLogoFallback(model?: string): string {
    if (!model || model === 'S3MX-0A') return GENERIC_LOGO;
    const normalized = normalizeModel(model);
    const local = `/images/devices/${normalized}.png`;
    if (!isKnownBadImageUrl(local)) return local;
    return GENERIC_LOGO;
}

/** Generic fallback logo. */
export const GENERIC_LOGO = '/images/branding/shelly_logo_black.jpg';

// Negative cache persisted in sessionStorage so an in-tab navigation
// (e.g. dashboard → devices → dashboard) doesn't re-fire the same 404s.
// Per-tab only; clears when the tab closes.
const BAD_URLS_KEY = 'fm.deviceLogo.badUrls';
const KNOWN_BAD_IMAGE_URLS = loadBadUrls();

function loadBadUrls(): Set<string> {
    try {
        const raw = sessionStorage.getItem(BAD_URLS_KEY);
        if (raw === null) return new Set();
        const arr = JSON.parse(raw);
        return Array.isArray(arr)
            ? new Set(arr.filter((v) => typeof v === 'string'))
            : new Set();
    } catch {
        return new Set();
    }
}

function persistBadUrls(): void {
    try {
        sessionStorage.setItem(
            BAD_URLS_KEY,
            JSON.stringify([...KNOWN_BAD_IMAGE_URLS])
        );
    } catch {
        /* quota / disabled storage — non-fatal */
    }
}

export function isKnownBadImageUrl(url: string): boolean {
    return KNOWN_BAD_IMAGE_URLS.has(url);
}

export function markBadImageUrl(url: string): void {
    if (KNOWN_BAD_IMAGE_URLS.has(url)) return;
    KNOWN_BAD_IMAGE_URLS.add(url);
    persistBadUrls();
}

// On load error, drop to the next tier: a failed cloud image falls back to the
// bundled local one (then generic); a failed local image drops to generic. Each
// failed URL is marked so subsequent cards skip the round-trip entirely.
export function handleDeviceImgError(e: Event, model?: string): void {
    const img = e.target as HTMLImageElement;
    const src = img.src;
    markBadImageUrl(src);
    if (src.includes(CLOUD_CDN)) {
        img.src = getLogoFallback(model);
        return;
    }
    img.src = GENERIC_LOGO;
}

/**
 * Best-effort logo from shellyID prefix (e.g. "shelly2pmg4-98a31671fa04").
 * Maps common prefixes to a representative model image.
 * Falls back to the generic Shelly logo for unknown prefixes.
 */
const SHELLY_ID_PREFIX_TO_MODEL: Readonly<Record<string, string>> = {
    // Gen 2 Plus
    shellyplus1: 'SPSW-101PE16EU',
    shellyplus1pm: 'SPSW-001PE16EU',
    shellyplus2pm: 'SPSW-202PE16EU',
    shellyplusht: 'SBHT-003C',
    shellyplusplugs: 'SNPL-00110EU',
    shellyplusplugus: 'SNPL-00116US',
    shellyplusplugit: 'SNPL-00116IT',
    shellypluspluguk: 'SNPL-00112UK',
    shellyplusuni: 'SNSW-001X16EU',
    shellyplusdimmer010v: 'SNDM-00100WW',
    shellyplusi4: 'SNSN-0024X',
    shellyplussmoke: 'SNSN-0031Z',
    shellyplusrgbwpm: 'SNDC-0D4P10WW',
    // Gen 2 Pro
    shellypro1: 'SPSW-101PE16EU',
    shellypro1pm: 'SPSW-001PE16EU',
    shellypro2: 'SPSW-102PE16EU',
    shellypro2pm: 'SPSW-202PE16EU',
    shellypro3: 'SPSW-102PE16EU',
    shellypro4pm: 'SPSW-004PE16EU',
    shellypro3em: 'SPEM-003CEBEU',
    shellyproem50: 'SPEM-002CEBEU50',
    shellyprodm1pm: 'SPDM-001PE01EU',
    shellyprodm2pm: 'SPDM-002PE01EU',
    // Gen 3
    shelly1g3: 'S3SW-001X8EU',
    shelly1pmg3: 'S3SW-001P8EU',
    shelly2pmg3: 'S3SW-002P16EU',
    shellypmminig3: 'S3PM-001PCEU16',
    shellyplugsg3: 'S3PL-00112EU',
    shellyhtg3: 'S3SN-0024X',
    shellyi4g3: 'S3SN-0D24X',
    shelly0110dimg3: 'S3DM-0010WW',
    shellyemg3: 'S3EM-002CXCEU',
    shellyblug3: 'S3BL-C010007AEU',
    shellyxtrg3: 'S3XT-0S',
    // Gen 4
    shelly1g4: 'S4SW-001X8EU',
    shelly1pmg4: 'S4SW-001P8EU',
    shelly2pmg4: 'S4SW-002P16EU',
    shellyplugsg4: 'S4PL-00416EU',
    // BLU
    sbbt: 'SBBT-002C',
    sbdw: 'SBDW-002C',
    sbmo: 'SBMO-003Z',
    // Wall Display
    shellywalldisplay: 'SAWD-0A1XX10EU1',
    // Cury
    cury: 'cury'
};

// Model for a card: explicit model, else the model the shellyID prefix
// identifies, else ''. One home for the prefix→model lookup.
export function modelForCard(shellyID: string, model?: string): string {
    const explicit = model?.trim();
    if (explicit) return explicit;
    const prefix = shellyID.split('-')[0]?.toLowerCase() ?? '';
    return SHELLY_ID_PREFIX_TO_MODEL[prefix] ?? '';
}

export function getLogoFromShellyID(shellyID: string): string {
    const model = modelForCard(shellyID);
    if (!model) return '/images/branding/shelly_logo.png';
    const local = `/images/devices/${model}.png`;
    return isKnownBadImageUrl(local)
        ? '/images/branding/shelly_logo.png'
        : local;
}

export function getPredefinedImageForEntity(
    entityType?: string,
    properties?: Record<string, any>
) {
    if (!entityType) return '/images/branding/shelly_logo_black.jpg';
    return getEntityIcon(entityType, properties);
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined;
}

export function getDeviceName(info?: any, shellyID?: string) {
    return (
        nonEmptyString(info?.name) ??
        nonEmptyString(info?.jwt?.n) ??
        nonEmptyString(info?.id) ??
        nonEmptyString(shellyID) ??
        'Unknown device'
    );
}

export function getAppName(info?: any) {
    return info?.jwt?.p || info?.app || 'Shelly Smart Device';
}

/**
 * Determines the accent color for a device card based on its actual
 * status components (e.g. switch:0, cover:0, em:0).
 * Colors match the entity card accent palette in design-tokens.css.
 *
 * Priority ordered: most distinctive component type wins, so a device
 * with both 'cover' and 'switch' components is classified as a cover.
 */
const COMPONENT_ACCENT: [string, string][] = [
    ['camera', '#60A5FA'],
    ['media', '#C084FC'],
    ['cury', '#C084FC'],
    ['cover', '#7B8FA1'],
    ['rgbcct', '#F472B6'],
    ['rgbw', '#F472B6'],
    ['rgb', '#F472B6'],
    ['cct', '#F472B6'],
    ['light', '#FCD34D'],
    ['em', '#F59E0B'],
    ['em1', '#F59E0B'],
    ['pm1', '#F59E0B'],
    ['service', '#34D399'],
    ['thermostat', '#34D399'],
    ['switch', '#4495D1'],
    ['temperature', '#818EF8'],
    ['humidity', '#38BDF8'],
    ['flood', '#06B6D4'],
    ['smoke', '#EF4444'],
    ['illuminance', '#FACC15'],
    ['input', '#475569'],
    ['button', '#A855F7']
];
const DEFAULT_DEVICE_ACCENT = '#4495D1';

export function getDeviceCategoryAccent(status?: any): string {
    if (!status || typeof status !== 'object') return DEFAULT_DEVICE_ACCENT;
    const keys = Object.keys(status);
    const types = new Set<string>();
    for (const key of keys) {
        const i = key.indexOf(':');
        if (i > 0) types.add(key.substring(0, i));
    }
    for (const [type, color] of COMPONENT_ACCENT) {
        if (types.has(type)) return color;
    }
    return DEFAULT_DEVICE_ACCENT;
}

export function isDiscovered(shellyID?: string) {
    return shellyID?.endsWith('.local');
}

/**
 * Get the level indicator for a device (battery %, vial level %, etc.)
 * For Cury devices: returns the minimum vial level of left/right slots (or the only valid one)
 * For battery-powered devices: returns battery percentage
 * Rule for Cury: We use the minimum of left/right vial levels because when either
 * vial runs out, the device functionality is impacted. This provides a "worst case"
 * view that helps users know when they need to refill.
 */
type LevelResult = {value: number | null; type: 'battery' | 'vial' | null};

const NO_LEVEL: LevelResult = {value: null, type: null};
const EMPTY_VIAL_SERIAL = '0000000000000000';

/** Check if a Cury vial slot has a valid level reading */
function getVialLevel(slot: any): number | null {
    const hasVial =
        slot?.vial?.serial && slot.vial.serial !== EMPTY_VIAL_SERIAL;
    if (!hasVial) return null;
    const level = slot.vial.level;
    // -1 means "still reading" — exclude
    return typeof level === 'number' && level >= 0 ? level : null;
}

/** Cury scent diffuser: return minimum of left/right vial levels */
function getCuryVialLevel(status: any): LevelResult {
    const slots = status['cury:0']?.slots;
    if (!slots) return NO_LEVEL;
    const levels = [getVialLevel(slots.left), getVialLevel(slots.right)].filter(
        (v): v is number => v !== null
    );
    // Why min: when either vial runs out, user should be notified
    return levels.length > 0
        ? {value: Math.min(...levels), type: 'vial'}
        : NO_LEVEL;
}

/** Battery-powered devices: detect from status, not hardcoded list */
function getBatteryLevel(status: any): LevelResult {
    const percent =
        status?.devicepower?.battery?.percent ??
        status?.['devicepower:0']?.battery?.percent;
    return typeof percent === 'number'
        ? {value: percent, type: 'battery'}
        : NO_LEVEL;
}

export function getLevelIndicator(device?: shelly_device_t): LevelResult {
    if (!device?.status) return NO_LEVEL;
    const vial = getCuryVialLevel(device.status);
    if (vial.value !== null) return vial;
    return getBatteryLevel(device.status);
}

export function parseFwVersion(ver: string): number[] {
    const match = ver.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0];
    return [
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10),
        Number.parseInt(match[3], 10)
    ];
}

export function fwVersionAtLeast(
    ver: string,
    minMajor: number,
    minMinor: number,
    minPatch: number
): boolean {
    const [major, minor, patch] = parseFwVersion(ver);
    if (major !== minMajor) return major > minMajor;
    if (minor !== minMinor) return minor > minMinor;
    return patch >= minPatch;
}

/**
 * Format a MAC address. Devices report it as 12 unseparated hex chars
 * (`98A31679F438`); display it as canonical `XX:XX:XX:XX:XX:XX`. If the
 * input is already separated or non-standard, returns it unchanged.
 */
/** Strip a MAC/addr to hex-only lowercase — the single home for MAC compares. */
export function normalizeMac(addr: string | undefined | null): string {
    return (addr ?? '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

export function formatMac(mac: string): string {
    if (!mac) return '';
    const clean = normalizeMac(mac).toUpperCase();
    if (clean.length !== 12) return mac;
    return clean.match(/.{2}/g)!.join(':');
}

/**
 * Wi-Fi signal tier from RSSI (dBm). Used to colour-code signal values.
 *   ≥ -60 dBm  → good   (green)
 *   ≥ -75 dBm  → ok     (default)
 *   <  -75 dBm → warn   (amber)
 */
export type RssiTier = 'good' | 'ok' | 'warn';
export function rssiTier(rssi: number): RssiTier {
    if (rssi >= -60) return 'good';
    if (rssi >= -75) return 'ok';
    return 'warn';
}
