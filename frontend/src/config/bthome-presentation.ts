// ---------------------------------------------------------------------------
// BThome presentation map — PRESENTATION ONLY.
//
// The backend is the single source of truth for BTHome device knowledge:
// classification (entity properties.sensorType), units (properties.unit)
// and the per-device BTHomeOverview (status['bthomedevice:N'].overview).
// This module only maps backend-sent objName strings to frontend display
// choices: which FA icon, which card layout variant, display wording and
// binary state words. No numeric obj ids, no analog/binary classification
// live here — an unknown objName still renders correctly from backend data
// via the generic fallbacks.
// ---------------------------------------------------------------------------

/**
 * Card variant used by CardValue_Sensor.
 * Analog variants render a numeric value + unit.
 * Binary variants render state text.
 */
export type SensorVariant =
    | 'temp'
    | 'humidity'
    | 'illuminance'
    | 'energy'
    | 'voltage'
    | 'door'
    | 'motion'
    | 'flood'
    | 'smoke'
    | 'presencezone'
    | 'battery'
    | 'pressure'
    | 'uv'
    | 'wind'
    | 'rain'
    | 'rotation'
    | 'channel'
    | 'generic';

interface BThomePresentation {
    /** Which CardValue_Sensor layout to use */
    variant: SensorVariant;
    /** FontAwesome icon class */
    icon: string;
    /** Display wording when the mechanical objName format isn't right */
    label?: string;
}

const DEFAULT_PRESENTATION: BThomePresentation = {
    variant: 'generic',
    icon: 'fas fa-satellite-dish',
    label: 'Sensor'
};

/** Display choices per backend-sent objName. */
const BTHOME_PRESENTATION: Record<string, BThomePresentation> = {
    // ── Analog sensors ──────────────────────────────────────────────────
    packet_id: {variant: 'generic', icon: 'fas fa-hashtag', label: 'Packet ID'},
    battery: {variant: 'battery', icon: 'fas fa-battery-three-quarters'},
    temperature: {variant: 'temp', icon: 'fas fa-thermometer-half'},
    humidity: {variant: 'humidity', icon: 'fas fa-droplet'},
    pressure: {variant: 'pressure', icon: 'fas fa-meter'},
    illuminance: {variant: 'illuminance', icon: 'fas fa-sun'},
    mass_kg: {variant: 'generic', icon: 'fas fa-weight-scale', label: 'Mass'},
    mass_lb: {variant: 'generic', icon: 'fas fa-weight-scale', label: 'Mass'},
    dewpoint: {
        variant: 'temp',
        icon: 'fas fa-thermometer-half',
        label: 'Dew Point'
    },
    count: {variant: 'generic', icon: 'fas fa-hashtag'},
    energy: {variant: 'energy', icon: 'fas fa-bolt'},
    power: {variant: 'energy', icon: 'fas fa-bolt'},
    voltage: {variant: 'energy', icon: 'fas fa-bolt'},
    current: {variant: 'energy', icon: 'fas fa-bolt'},
    'pm2.5': {variant: 'generic', icon: 'fas fa-smog', label: 'PM2.5'},
    pm10: {variant: 'generic', icon: 'fas fa-smog', label: 'PM10'},
    co2: {variant: 'generic', icon: 'fas fa-cloud', label: 'CO₂'},
    tvoc: {variant: 'generic', icon: 'fas fa-cloud', label: 'TVOC'},
    moisture: {variant: 'humidity', icon: 'fas fa-droplet'},
    rotation: {variant: 'rotation', icon: 'fas fa-rotate'},
    distance_mm: {
        variant: 'generic',
        icon: 'fas fa-ruler',
        label: 'Distance'
    },
    distance_m: {variant: 'generic', icon: 'fas fa-ruler', label: 'Distance'},
    duration: {variant: 'generic', icon: 'fas fa-clock'},
    speed: {variant: 'wind', icon: 'fas fa-wind', label: 'Wind Speed'},
    uv_index: {variant: 'uv', icon: 'fas fa-sun-bright', label: 'UV Index'},
    volume: {variant: 'generic', icon: 'fas fa-flask'},
    volume_flow_rate: {
        variant: 'generic',
        icon: 'fas fa-faucet-drip',
        label: 'Flow Rate'
    },
    gas: {variant: 'generic', icon: 'fas fa-fire-flame-simple'},
    water: {variant: 'generic', icon: 'fas fa-water'},
    timestamp: {variant: 'generic', icon: 'fas fa-clock'},
    acceleration: {variant: 'generic', icon: 'fas fa-gauge-high'},
    gyroscope: {variant: 'generic', icon: 'fas fa-compass'},
    direction: {
        variant: 'wind',
        icon: 'fas fa-compass',
        label: 'Wind Direction'
    },
    precipitation: {variant: 'rain', icon: 'fas fa-cloud-rain'},
    channel: {variant: 'channel', icon: 'fas fa-tower-broadcast'},
    rotational_speed: {variant: 'generic', icon: 'fas fa-fan', label: 'RPM'},
    volume_storage: {
        variant: 'generic',
        icon: 'fas fa-flask',
        label: 'Volume'
    },
    conductivity: {variant: 'generic', icon: 'fas fa-bolt'},
    light_level: {variant: 'illuminance', icon: 'fas fa-sun'},
    device_type_id: {
        variant: 'generic',
        icon: 'fas fa-microchip',
        label: 'Device Type'
    },
    firmware_version: {
        variant: 'generic',
        icon: 'fas fa-code-branch',
        label: 'Firmware'
    },
    text: {variant: 'generic', icon: 'fas fa-font'},
    raw: {variant: 'generic', icon: 'fas fa-database'},

    // ── Binary sensors ──────────────────────────────────────────────────
    generic_boolean: {
        variant: 'generic',
        icon: 'fas fa-circle-dot',
        label: 'Boolean'
    },
    power_status: {variant: 'generic', icon: 'fas fa-plug'},
    opening: {variant: 'door', icon: 'fas fa-door-open'},
    battery_status: {variant: 'generic', icon: 'fas fa-battery-quarter'},
    battery_charging: {
        variant: 'generic',
        icon: 'fas fa-battery-bolt',
        label: 'Charging'
    },
    carbon_monoxide: {variant: 'smoke', icon: 'fas fa-smog'},
    cold: {variant: 'generic', icon: 'fas fa-snowflake'},
    connectivity: {variant: 'generic', icon: 'fas fa-wifi'},
    door: {variant: 'door', icon: 'fas fa-door-open'},
    garage_door: {variant: 'door', icon: 'fas fa-warehouse'},
    heat: {variant: 'generic', icon: 'fas fa-temperature-high'},
    light: {variant: 'generic', icon: 'fas fa-lightbulb'},
    lock: {variant: 'door', icon: 'fas fa-lock'},
    motion: {variant: 'motion', icon: 'fas fa-person-walking'},
    moving: {variant: 'motion', icon: 'fas fa-person-running'},
    occupancy: {variant: 'motion', icon: 'fas fa-person'},
    plug: {variant: 'generic', icon: 'fas fa-plug'},
    presence: {variant: 'motion', icon: 'fas fa-person'},
    problem: {variant: 'smoke', icon: 'fas fa-triangle-exclamation'},
    running: {variant: 'generic', icon: 'fas fa-circle-play'},
    safety: {variant: 'generic', icon: 'fas fa-shield-halved'},
    smoke: {variant: 'smoke', icon: 'fas fa-smog'},
    sound: {variant: 'generic', icon: 'fas fa-volume-high'},
    tamper: {variant: 'smoke', icon: 'fas fa-shield-halved'},
    vibration: {variant: 'motion', icon: 'fas fa-wave-square'},
    window: {variant: 'door', icon: 'fas fa-window-maximize'},

    // ── Controls ────────────────────────────────────────────────────────
    button: {variant: 'generic', icon: 'fas fa-circle-dot'},
    dimmer: {variant: 'generic', icon: 'fas fa-sliders'}
};

function presentationFor(objName?: string): BThomePresentation {
    if (!objName) return DEFAULT_PRESENTATION;
    return BTHOME_PRESENTATION[objName] ?? DEFAULT_PRESENTATION;
}

/** Card layout variant for a BThome sensor by backend-sent objName. */
export function getBThomeVariant(objName?: string): SensorVariant {
    return presentationFor(objName).variant;
}

/** FA icon class for a BThome sensor by backend-sent objName. */
export function getBThomeIcon(objName?: string): string {
    return presentationFor(objName).icon;
}

/** Display label: wording override or the formatted backend objName. */
export function getBThomeLabel(objName?: string): string {
    const override = presentationFor(objName).label;
    if (override) return override;
    return formatObjName(objName ?? '') || 'Sensor';
}

function formatObjName(value: string): string {
    return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Binary state words ───────────────────────────────────────────────────

export type BinaryStateWords = {on: string; off: string};

const DEFAULT_BINARY_STATE_WORDS: BinaryStateWords = {on: 'On', off: 'Off'};

// Keyed by backend-sent objName; polarity follows the BTHome v2 spec
// (e.g. battery_status 1 = Low). Exported for the backend parity gate
// (test/bthomeWordsParity.test.ts) — must stay entry-for-entry equal to
// backend/src/config/BTHomeData.ts BTHOME_BINARY_STATE_WORDS.
export const BTHOME_BINARY_STATE_WORDS: Record<string, BinaryStateWords> = {
    generic_boolean: {on: 'Yes', off: 'No'},
    power_status: {on: 'On', off: 'Off'},
    opening: {on: 'Open', off: 'Closed'},
    battery_status: {on: 'Low', off: 'OK'},
    battery_charging: {on: 'Charging', off: 'Not Charging'},
    carbon_monoxide: {on: 'Detected', off: 'Clear'},
    cold: {on: 'Detected', off: 'Clear'},
    connectivity: {on: 'Connected', off: 'Disconnected'},
    door: {on: 'Open', off: 'Closed'},
    garage_door: {on: 'Open', off: 'Closed'},
    gas: {on: 'Detected', off: 'Clear'},
    heat: {on: 'Detected', off: 'Clear'},
    light: {on: 'On', off: 'Off'},
    lock: {on: 'Locked', off: 'Unlocked'},
    moisture: {on: 'Wet', off: 'Dry'},
    motion: {on: 'Motion', off: 'Clear'},
    moving: {on: 'Moving', off: 'Still'},
    occupancy: {on: 'Occupied', off: 'Vacant'},
    plug: {on: 'On', off: 'Off'},
    presence: {on: 'Present', off: 'Away'},
    problem: {on: 'Detected', off: 'Clear'},
    running: {on: 'On', off: 'Off'},
    safety: {on: 'Safe', off: 'Unsafe'},
    smoke: {on: 'Alarm', off: 'Clear'},
    sound: {on: 'Detected', off: 'Clear'},
    tamper: {on: 'Alarm', off: 'Clear'},
    vibration: {on: 'Detected', off: 'Clear'},
    window: {on: 'Open', off: 'Closed'}
};

/** Binary state display words for a backend-sent objName (On/Off fallback). */
export function getBThomeBinaryStateWords(objName?: string): BinaryStateWords {
    if (!objName) return DEFAULT_BINARY_STATE_WORDS;
    return BTHOME_BINARY_STATE_WORDS[objName] ?? DEFAULT_BINARY_STATE_WORDS;
}

// BLU light-level enum (BTHome 0x64 light_level) — a coarse brightness the ZB
// door/window and presence sensors report instead of lux. Order = the device's
// 0/1/2 values, per the Shelly BTHome spec.
const LIGHT_LEVEL_LABELS = ['Dark', 'Twilight', 'Bright'];

/** Word for a BLU 3-state light level (0 dark, 1 twilight, 2 bright). */
export function getLightLevelLabel(level: number): string {
    return LIGHT_LEVEL_LABELS[level] ?? String(level);
}

// ── Binary state tone classes ────────────────────────────────────────────
// CSS tone per binary state word (words above / backend displayValue).
const STATE_WORD_CLASSES: Record<string, string> = {
    open: 's-open',
    closed: 's-closed',
    motion: 's-motion',
    moving: 's-motion',
    occupied: 's-motion',
    present: 's-motion',
    detected: 's-alarm',
    alarm: 's-alarm',
    low: 's-alarm',
    unlocked: 's-alarm',
    unsafe: 's-alarm',
    disconnected: 's-alarm',
    wet: 's-flood',
    dry: 's-dry',
    clear: 's-clear',
    ok: 's-clear',
    locked: 's-clear',
    vacant: 's-clear',
    away: 's-clear',
    safe: 's-clear',
    still: 's-clear',
    connected: 's-clear'
};

/** CSS state class for a backend-sent binary state word. */
export function binaryStateClass(word: string, active: boolean): string {
    return (
        STATE_WORD_CLASSES[word.trim().toLowerCase()] ??
        (active ? 's-on' : 's-off')
    );
}
