// ---------------------------------------------------------------------------
// BThome Configuration
// ---------------------------------------------------------------------------
// Centralised BLE device and sensor type definitions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// BLU Device Names & Remote Models
// ---------------------------------------------------------------------------
// Source of truth: backend/src/config/BTHomeData.ts
// The backend resolves names and isRemote flag in discovery events.
// These are NOT needed for discovery (backend provides name + isRemote).
// Only kept as minimal fallback for paired devices loaded from device store
// where the backend hasn't enriched the data yet.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// BThome Sensor Type Definitions
// ---------------------------------------------------------------------------
// Centralised mapping of every BThome objName to its display category,
// card variant, icon, and binary-state labels.  Mirrors the backend's
// BTHomeData.ts (82 object types) so the frontend knows exactly what to
// expect from each sensor.
// ---------------------------------------------------------------------------

/**
 * Card variant used by CardValue_Sensor.
 * Analog variants render a numeric value + unit.
 * Binary variants render ON/OFF state text.
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

/** How a sensor's value should be read from device status. */
export type SensorCategory = 'analog' | 'binary' | 'button' | 'dimmer';

/** Labels for binary sensor ON/OFF states. */
export interface BinaryLabels {
    on: string;
    off: string;
    onClass: string;
    offClass: string;
}

export interface BThomeSensorDef {
    /** Display category — analog shows value, binary shows state */
    category: SensorCategory;
    /** Which CardValue_Sensor variant to use */
    variant: SensorVariant;
    /** FontAwesome icon class */
    icon: string;
    /** Human-readable label for the sensor type */
    label: string;
    /** For binary sensors: ON/OFF state labels and CSS classes */
    binaryLabels?: BinaryLabels;
}

// ---------------------------------------------------------------------------
// Binary state label presets (reused across multiple objNames)
// ---------------------------------------------------------------------------

const LABELS_DOOR: BinaryLabels = {
    on: 'OPEN',
    off: 'CLOSED',
    onClass: 's-open',
    offClass: 's-closed'
};
const LABELS_MOTION: BinaryLabels = {
    on: 'MOTION',
    off: 'CLEAR',
    onClass: 's-motion',
    offClass: 's-clear'
};
const LABELS_ALARM: BinaryLabels = {
    on: 'ALARM',
    off: 'CLEAR',
    onClass: 's-alarm',
    offClass: 's-clear'
};
const _LABELS_FLOOD: BinaryLabels = {
    on: 'FLOOD',
    off: 'DRY',
    onClass: 's-flood',
    offClass: 's-dry'
};
const LABELS_ON_OFF: BinaryLabels = {
    on: 'ON',
    off: 'OFF',
    onClass: 's-on',
    offClass: 's-off'
};
const LABELS_YES_NO: BinaryLabels = {
    on: 'YES',
    off: 'NO',
    onClass: 's-on',
    offClass: 's-off'
};
const LABELS_DETECTED: BinaryLabels = {
    on: 'DETECTED',
    off: 'CLEAR',
    onClass: 's-alarm',
    offClass: 's-clear'
};
const LABELS_OK_LOW: BinaryLabels = {
    on: 'OK',
    off: 'LOW',
    onClass: 's-clear',
    offClass: 's-alarm'
};

// ---------------------------------------------------------------------------
// Complete BThome objName → definition mapping
// ---------------------------------------------------------------------------

export const BTHOME_SENSOR_DEFS: Record<string, BThomeSensorDef> = {
    // ── Analog sensors ──────────────────────────────────────────────────
    packet_id: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-hashtag',
        label: 'Packet ID'
    },
    battery: {
        category: 'analog',
        variant: 'battery',
        icon: 'fas fa-battery-three-quarters',
        label: 'Battery'
    },
    temperature: {
        category: 'analog',
        variant: 'temp',
        icon: 'fas fa-thermometer-half',
        label: 'Temperature'
    },
    humidity: {
        category: 'analog',
        variant: 'humidity',
        icon: 'fas fa-droplet',
        label: 'Humidity'
    },
    pressure: {
        category: 'analog',
        variant: 'pressure',
        icon: 'fas fa-meter',
        label: 'Pressure'
    },
    illuminance: {
        category: 'analog',
        variant: 'illuminance',
        icon: 'fas fa-sun',
        label: 'Illuminance'
    },
    mass_kg: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-weight-scale',
        label: 'Mass'
    },
    mass_lb: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-weight-scale',
        label: 'Mass'
    },
    dewpoint: {
        category: 'analog',
        variant: 'temp',
        icon: 'fas fa-thermometer-half',
        label: 'Dew Point'
    },
    count: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-hashtag',
        label: 'Count'
    },
    energy: {
        category: 'analog',
        variant: 'energy',
        icon: 'fas fa-bolt',
        label: 'Energy'
    },
    power: {
        category: 'analog',
        variant: 'energy',
        icon: 'fas fa-bolt',
        label: 'Power'
    },
    voltage: {
        category: 'analog',
        variant: 'energy',
        icon: 'fas fa-bolt',
        label: 'Voltage'
    },
    current: {
        category: 'analog',
        variant: 'energy',
        icon: 'fas fa-bolt',
        label: 'Current'
    },
    'pm2.5': {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-smog',
        label: 'PM2.5'
    },
    pm10: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-smog',
        label: 'PM10'
    },
    co2: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-cloud',
        label: 'CO\u2082'
    },
    tvoc: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-cloud',
        label: 'TVOC'
    },
    moisture: {
        category: 'analog',
        variant: 'humidity',
        icon: 'fas fa-droplet',
        label: 'Moisture'
    },
    rotation: {
        category: 'analog',
        variant: 'rotation',
        icon: 'fas fa-rotate',
        label: 'Rotation'
    },
    distance_mm: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-ruler',
        label: 'Distance'
    },
    distance_m: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-ruler',
        label: 'Distance'
    },
    duration: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-clock',
        label: 'Duration'
    },
    speed: {
        category: 'analog',
        variant: 'wind',
        icon: 'fas fa-wind',
        label: 'Wind Speed'
    },
    uv_index: {
        category: 'analog',
        variant: 'uv',
        icon: 'fas fa-sun-bright',
        label: 'UV Index'
    },
    volume: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-flask',
        label: 'Volume'
    },
    volume_flow_rate: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-faucet-drip',
        label: 'Flow Rate'
    },
    gas: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-fire-flame-simple',
        label: 'Gas'
    },
    water: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-water',
        label: 'Water'
    },
    timestamp: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-clock',
        label: 'Timestamp'
    },
    acceleration: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-gauge-high',
        label: 'Acceleration'
    },
    gyroscope: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-compass',
        label: 'Gyroscope'
    },

    // ── Binary sensors ──────────────────────────────────────────────────
    generic_boolean: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-circle-dot',
        label: 'Boolean',
        binaryLabels: LABELS_ON_OFF
    },
    power_status: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-plug',
        label: 'Power Status',
        binaryLabels: LABELS_ON_OFF
    },
    opening: {
        category: 'binary',
        variant: 'door',
        icon: 'fas fa-door-open',
        label: 'Opening',
        binaryLabels: LABELS_DOOR
    },
    battery_status: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-battery-quarter',
        label: 'Battery Status',
        binaryLabels: LABELS_OK_LOW
    },
    battery_charging: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-battery-bolt',
        label: 'Charging',
        binaryLabels: LABELS_YES_NO
    },
    carbon_monoxide: {
        category: 'binary',
        variant: 'smoke',
        icon: 'fas fa-smog',
        label: 'Carbon Monoxide',
        binaryLabels: LABELS_DETECTED
    },
    cold: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-snowflake',
        label: 'Cold',
        binaryLabels: LABELS_DETECTED
    },
    connectivity: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-wifi',
        label: 'Connectivity',
        binaryLabels: LABELS_ON_OFF
    },
    door: {
        category: 'binary',
        variant: 'door',
        icon: 'fas fa-door-open',
        label: 'Door',
        binaryLabels: LABELS_DOOR
    },
    garage_door: {
        category: 'binary',
        variant: 'door',
        icon: 'fas fa-warehouse',
        label: 'Garage Door',
        binaryLabels: LABELS_DOOR
    },
    // Note: 'gas' exists as both analog (obj_id 75/76, m³) and binary (obj_id 28).
    // The analog version above takes precedence in the map. Binary gas sensors
    // will get LABELS_ON_OFF via getBThomeBinaryLabels() default fallback.
    heat: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-temperature-high',
        label: 'Heat',
        binaryLabels: LABELS_DETECTED
    },
    light: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-lightbulb',
        label: 'Light',
        binaryLabels: LABELS_ON_OFF
    },
    lock: {
        category: 'binary',
        variant: 'door',
        icon: 'fas fa-lock',
        label: 'Lock',
        binaryLabels: {
            on: 'LOCKED',
            off: 'UNLOCKED',
            onClass: 's-clear',
            offClass: 's-alarm'
        }
    },
    motion: {
        category: 'binary',
        variant: 'motion',
        icon: 'fas fa-person-walking',
        label: 'Motion',
        binaryLabels: LABELS_MOTION
    },
    moving: {
        category: 'binary',
        variant: 'motion',
        icon: 'fas fa-person-running',
        label: 'Moving',
        binaryLabels: LABELS_MOTION
    },
    occupancy: {
        category: 'binary',
        variant: 'motion',
        icon: 'fas fa-person',
        label: 'Occupancy',
        binaryLabels: {
            on: 'OCCUPIED',
            off: 'VACANT',
            onClass: 's-motion',
            offClass: 's-clear'
        }
    },
    plug: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-plug',
        label: 'Plug',
        binaryLabels: LABELS_ON_OFF
    },
    presence: {
        category: 'binary',
        variant: 'motion',
        icon: 'fas fa-person',
        label: 'Presence',
        binaryLabels: {
            on: 'PRESENT',
            off: 'AWAY',
            onClass: 's-motion',
            offClass: 's-clear'
        }
    },
    problem: {
        category: 'binary',
        variant: 'smoke',
        icon: 'fas fa-triangle-exclamation',
        label: 'Problem',
        binaryLabels: LABELS_DETECTED
    },
    running: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-circle-play',
        label: 'Running',
        binaryLabels: LABELS_ON_OFF
    },
    safety: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-shield-halved',
        label: 'Safety',
        binaryLabels: {
            on: 'SAFE',
            off: 'UNSAFE',
            onClass: 's-clear',
            offClass: 's-alarm'
        }
    },
    smoke: {
        category: 'binary',
        variant: 'smoke',
        icon: 'fas fa-smog',
        label: 'Smoke',
        binaryLabels: LABELS_ALARM
    },
    sound: {
        category: 'binary',
        variant: 'generic',
        icon: 'fas fa-volume-high',
        label: 'Sound',
        binaryLabels: LABELS_DETECTED
    },
    tamper: {
        category: 'binary',
        variant: 'smoke',
        icon: 'fas fa-shield-halved',
        label: 'Tamper',
        binaryLabels: LABELS_ALARM
    },
    vibration: {
        category: 'binary',
        variant: 'motion',
        icon: 'fas fa-wave-square',
        label: 'Vibration',
        binaryLabels: LABELS_DETECTED
    },
    window: {
        category: 'binary',
        variant: 'door',
        icon: 'fas fa-window-maximize',
        label: 'Window',
        binaryLabels: LABELS_DOOR
    },
    // ── Weather Station / Remote / Extended ────────────────────────────
    direction: {
        category: 'analog',
        variant: 'wind',
        icon: 'fas fa-compass',
        label: 'Wind Direction'
    },
    precipitation: {
        category: 'analog',
        variant: 'rain',
        icon: 'fas fa-cloud-rain',
        label: 'Precipitation'
    },
    channel: {
        category: 'analog',
        variant: 'channel',
        icon: 'fas fa-tower-broadcast',
        label: 'Channel'
    },
    rotational_speed: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-fan',
        label: 'RPM'
    },
    volume_storage: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-flask',
        label: 'Volume'
    },
    conductivity: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-bolt',
        label: 'Conductivity'
    },
    light_level: {
        category: 'analog',
        variant: 'illuminance',
        icon: 'fas fa-sun',
        label: 'Light Level'
    },
    device_type_id: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-microchip',
        label: 'Device Type'
    },
    firmware_version: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-code-branch',
        label: 'Firmware'
    },
    text: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-font',
        label: 'Text'
    },
    raw: {
        category: 'analog',
        variant: 'generic',
        icon: 'fas fa-database',
        label: 'Raw'
    },

    // ── Special types ───────────────────────────────────────────────────
    button: {
        category: 'button',
        variant: 'generic',
        icon: 'fas fa-circle-dot',
        label: 'Button'
    },
    dimmer: {
        category: 'dimmer',
        variant: 'generic',
        icon: 'fas fa-sliders',
        label: 'Dimmer'
    }
};

/** Default definition for unknown objNames */
const DEFAULT_DEF: BThomeSensorDef = {
    category: 'analog',
    variant: 'generic',
    icon: 'fas fa-satellite-dish',
    label: 'Sensor'
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up the full BThome sensor definition by objName. */
export function getBThomeDef(objName?: string): BThomeSensorDef {
    if (!objName) return DEFAULT_DEF;
    return BTHOME_SENSOR_DEFS[objName] ?? DEFAULT_DEF;
}

/** Get the card variant for a BThome sensor by objName. */
export function getBThomeVariant(objName?: string): SensorVariant {
    return getBThomeDef(objName).variant;
}

/** Get the icon class for a BThome sensor by objName. */
export function getBThomeIcon(objName?: string): string {
    return getBThomeDef(objName).icon;
}

/** Get the binary state labels for a BThome sensor, or a generic fallback. */
export function getBThomeBinaryLabels(objName?: string): BinaryLabels {
    return getBThomeDef(objName).binaryLabels ?? LABELS_ON_OFF;
}
