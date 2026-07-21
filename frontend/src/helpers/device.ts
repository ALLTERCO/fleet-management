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
        return '/images/branding/shelly_logo.png';
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

const DEVICE_IMAGE_MODEL_ALIASES: Readonly<Record<string, string>> = {
    'S4PL-10416EU': 'S4PL-00416EU'
};

function normalizeModel(model: string): string {
    model = DEVICE_IMAGE_MODEL_ALIASES[model] ?? model;
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
export const GENERIC_LOGO = '/images/branding/shelly_logo.png';

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

export function getPredefinedImageForEntity(
    entityType?: string,
    properties?: Record<string, any>
) {
    if (!entityType) return '/images/branding/shelly_logo.png';
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

// Case-insensitive match on device name or ID.
export function deviceMatchesQuery(
    device: {name: string; id: string},
    query: string
): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
        device.name.toLowerCase().includes(q) ||
        device.id.toLowerCase().includes(q)
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
 * For Cury devices: the backend cury projection resolves vial presence and
 * the worst-vial level (lowestVialLevel); the frontend just reads it.
 * For battery-powered devices: returns battery percentage.
 */
type LevelResult = {value: number | null; type: 'battery' | 'vial' | null};

const NO_LEVEL: LevelResult = {value: null, type: null};

/** Cury scent diffuser: backend-projected worst vial level (null = none readable) */
function getCuryVialLevel(status: any): LevelResult {
    const level = status['cury:0']?.lowestVialLevel;
    return typeof level === 'number' ? {value: level, type: 'vial'} : NO_LEVEL;
}

/** Battery-powered devices: detect from status, not hardcoded list */
function getBatteryLevel(status: any): LevelResult {
    const percent =
        status?.devicepower?.battery?.percent ??
        status?.['devicepower:0']?.battery?.percent ??
        status?.bluetoothdevice?.battery;
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

export function shouldShowBatteryBadge(
    percent: number | null | undefined
): boolean {
    return typeof percent === 'number' && percent < 30;
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
