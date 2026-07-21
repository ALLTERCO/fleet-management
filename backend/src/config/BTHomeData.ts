export const bthomeObjectInfos: Record<
    number,
    {
        name: string;
        type: 'sensor' | 'binary_sensor' | 'dimmer' | 'button';
        unit: string;
    }
> = {
    0: {name: 'packet_id', type: 'sensor', unit: ''},
    1: {name: 'battery', type: 'sensor', unit: '%'},
    2: {name: 'temperature', type: 'sensor', unit: '°C'},
    3: {name: 'humidity', type: 'sensor', unit: '%'},
    4: {name: 'pressure', type: 'sensor', unit: 'hPa'},
    5: {name: 'illuminance', type: 'sensor', unit: 'lux'},
    6: {name: 'mass_kg', type: 'sensor', unit: 'kg'},
    7: {name: 'mass_lb', type: 'sensor', unit: 'lb'},
    8: {name: 'dewpoint', type: 'sensor', unit: '°C'},
    9: {name: 'count', type: 'sensor', unit: ''},
    10: {name: 'energy', type: 'sensor', unit: 'kWh'},
    11: {name: 'power', type: 'sensor', unit: 'W'},
    12: {name: 'voltage', type: 'sensor', unit: 'V'},
    13: {name: 'pm2.5', type: 'sensor', unit: 'ug/m3'},
    14: {name: 'pm10', type: 'sensor', unit: 'ug/m3'},
    15: {name: 'generic_boolean', type: 'binary_sensor', unit: ''},
    16: {name: 'power_status', type: 'binary_sensor', unit: ''},
    17: {name: 'opening', type: 'binary_sensor', unit: ''},
    18: {name: 'co2', type: 'sensor', unit: 'ppm'},
    19: {name: 'tvoc', type: 'sensor', unit: 'ug/m3'},
    20: {name: 'moisture', type: 'sensor', unit: '%'},
    21: {name: 'battery_status', type: 'binary_sensor', unit: ''},
    22: {name: 'battery_charging', type: 'binary_sensor', unit: ''},
    23: {name: 'carbon_monoxide', type: 'binary_sensor', unit: ''},
    24: {name: 'cold', type: 'binary_sensor', unit: ''},
    25: {name: 'connectivity', type: 'binary_sensor', unit: ''},
    26: {name: 'door', type: 'binary_sensor', unit: ''},
    27: {name: 'garage_door', type: 'binary_sensor', unit: ''},
    28: {name: 'gas', type: 'binary_sensor', unit: ''},
    29: {name: 'heat', type: 'binary_sensor', unit: ''},
    30: {name: 'light', type: 'binary_sensor', unit: ''},
    31: {name: 'lock', type: 'binary_sensor', unit: ''},
    32: {name: 'moisture', type: 'binary_sensor', unit: ''},
    33: {name: 'motion', type: 'binary_sensor', unit: ''},
    34: {name: 'moving', type: 'binary_sensor', unit: ''},
    35: {name: 'occupancy', type: 'binary_sensor', unit: ''},
    36: {name: 'plug', type: 'binary_sensor', unit: ''},
    37: {name: 'presence', type: 'binary_sensor', unit: ''},
    38: {name: 'problem', type: 'binary_sensor', unit: ''},
    39: {name: 'running', type: 'binary_sensor', unit: ''},
    40: {name: 'safety', type: 'binary_sensor', unit: ''},
    41: {name: 'smoke', type: 'binary_sensor', unit: ''},
    42: {name: 'sound', type: 'binary_sensor', unit: ''},
    43: {name: 'tamper', type: 'binary_sensor', unit: ''},
    44: {name: 'vibration', type: 'binary_sensor', unit: ''},
    45: {name: 'window', type: 'binary_sensor', unit: ''},
    46: {name: 'humidity', type: 'sensor', unit: '%'},
    47: {name: 'moisture', type: 'sensor', unit: '%'},
    58: {name: 'button', type: 'button', unit: ''},
    60: {name: 'dimmer', type: 'dimmer', unit: ''},
    61: {name: 'count', type: 'sensor', unit: ''},
    62: {name: 'count', type: 'sensor', unit: ''},
    63: {name: 'rotation', type: 'sensor', unit: '°'},
    64: {name: 'distance_mm', type: 'sensor', unit: 'mm'},
    65: {name: 'distance_m', type: 'sensor', unit: 'm'},
    66: {name: 'duration', type: 'sensor', unit: 's'},
    67: {name: 'current', type: 'sensor', unit: 'A'},
    68: {name: 'speed', type: 'sensor', unit: 'm/s'},
    69: {name: 'temperature', type: 'sensor', unit: '° C'},
    70: {name: 'uv_index', type: 'sensor', unit: ''},
    71: {name: 'volume', type: 'sensor', unit: 'L'},
    72: {name: 'volume', type: 'sensor', unit: 'mL'},
    73: {name: 'volume_flow_rate', type: 'sensor', unit: 'm3/hr'},
    74: {name: 'voltage', type: 'sensor', unit: 'V'},
    75: {name: 'gas', type: 'sensor', unit: 'm3'},
    76: {name: 'gas', type: 'sensor', unit: 'm3'},
    77: {name: 'energy', type: 'sensor', unit: 'kWh'},
    78: {name: 'volume', type: 'sensor', unit: 'L'},
    79: {name: 'water', type: 'sensor', unit: 'L'},
    80: {name: 'timestamp', type: 'sensor', unit: ''},
    81: {name: 'acceleration', type: 'sensor', unit: 'm/s2'},
    82: {name: 'gyroscope', type: 'sensor', unit: '°/s'},
    // BTHome v2 extended IDs (0x53-0x64)
    83: {name: 'text', type: 'sensor', unit: ''},
    84: {name: 'raw', type: 'sensor', unit: ''},
    85: {name: 'volume_storage', type: 'sensor', unit: 'L'},
    86: {name: 'conductivity', type: 'sensor', unit: 'µS/cm'},
    87: {name: 'temperature', type: 'sensor', unit: '°C'},
    88: {name: 'temperature', type: 'sensor', unit: '°C'},
    89: {name: 'count', type: 'sensor', unit: ''},
    90: {name: 'count', type: 'sensor', unit: ''},
    91: {name: 'count', type: 'sensor', unit: ''},
    92: {name: 'power', type: 'sensor', unit: 'W'},
    93: {name: 'current', type: 'sensor', unit: 'A'},
    // Shelly BLU Weather Station + Remote
    94: {name: 'direction', type: 'sensor', unit: '°'},
    95: {name: 'precipitation', type: 'sensor', unit: 'mm'},
    96: {name: 'channel', type: 'sensor', unit: ''},
    // BTHome v2 extended (0x61-0x64)
    97: {name: 'rotational_speed', type: 'sensor', unit: 'rpm'},
    98: {name: 'speed', type: 'sensor', unit: 'm/s'},
    99: {name: 'acceleration', type: 'sensor', unit: 'm/s2'},
    100: {name: 'light_level', type: 'sensor', unit: ''},
    // BTHome device info (0xF0-0xF2) — broadcast by all BLU devices
    240: {name: 'device_type_id', type: 'sensor', unit: ''},
    241: {name: 'firmware_version', type: 'sensor', unit: ''},
    242: {name: 'firmware_version', type: 'sensor', unit: ''}
};

// Door-like objects share open/closed semantics (state projection + kind).
const BTHOME_DOOR_LIKE_OBJ_NAMES = new Set([
    'opening',
    'door',
    'window',
    'garage_door'
]);

export function isBTHomeDoorLikeObjectName(objName?: string): boolean {
    return !!objName && BTHOME_DOOR_LIKE_OBJ_NAMES.has(objName);
}

export function isBTHomeDoorLikeObjectId(objId: number): boolean {
    return isBTHomeDoorLikeObjectName(bthomeObjectInfos[objId]?.name);
}

/** Every obj_id whose catalog name matches one of `names`. Derives the id
 *  groupings used for BTHome kind detection from the single obj_id->name source
 *  of truth, so a new obj_id added to bthomeObjectInfos with a known name is
 *  recognized automatically instead of needing a parallel hardcoded id list. */
export function objIdsByName(...names: string[]): Set<number> {
    const wanted = new Set(names);
    const ids = new Set<number>();
    for (const [id, info] of Object.entries(bthomeObjectInfos)) {
        if (wanted.has(info.name)) {
            ids.add(Number(id));
        }
    }
    return ids;
}

export type BTHomeBinaryStateWords = {on: string; off: string};

/** Display words for binary sensor states, keyed by objName.
 *  Polarity follows the BTHome v2 spec (e.g. battery_status 1 = Low). */
const BTHOME_BINARY_STATE_WORDS: Record<string, BTHomeBinaryStateWords> = {
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

export function getBTHomeBinaryStateWords(
    objName?: string
): BTHomeBinaryStateWords | undefined {
    if (!objName) return undefined;
    return BTHOME_BINARY_STATE_WORDS[objName];
}

export function isBTHomeControlObjectId(objId: number): boolean {
    const info = bthomeObjectInfos[objId];
    return info?.type === 'button' || info?.type === 'dimmer';
}

export function isBTHomeDeviceLevelObjectId(objId: number): boolean {
    return isBTHomeControlObjectId(objId) || objId === 96;
}

export type BTHomeControlKind = 'button' | 'dimmer';

/**
 * Returns the control kind for a BTHome obj_id, or undefined if the object
 * is not a control. Used to classify controls without frontend hardcoding
 * BTHOME_BUTTON_OBJ_ID / BTHOME_DIMMER_OBJ_ID constants.
 */
export function getBTHomeControlKind(
    objId: number
): BTHomeControlKind | undefined {
    const info = bthomeObjectInfos[objId];
    if (info?.type === 'button') return 'button';
    if (info?.type === 'dimmer') return 'dimmer';
    return undefined;
}

export function formatBTHomeControlLabel(objId: number, idx: number): string {
    const displayIndex = idx + 1;
    const kind = getBTHomeControlKind(objId);

    if (kind === 'dimmer') return `Dimmer ${displayIndex}`;
    if (kind === 'button') return `Button ${displayIndex}`;
    return `Control ${displayIndex}`;
}

type BLUDeviceInfo = {
    productName: string;
    /** Numeric model_id from shelly_mfdata 0x0B block. Undefined = not in official docs. */
    modelId?: number;
    /** True for remotes/buttons that support BTHomeControl learning. */
    isRemote?: boolean;
    /** Guaranteed report cadence in seconds (beacon-off / normal mode). The
     *  device can't broadcast this, so it lives here. Omitted = use the 6h
     *  universal keepalive. Source: docs-ble per-device pages. */
    reportCadenceSec?: number;
    /** No cadence is safe for a stopped-reporting alert. */
    noHeartbeat?: boolean;
};

/** Every battery BLU device emits an identification packet at power-on and
 *  every 6h (docs-ble/common.md) — the floor for any model without a tighter
 *  documented cadence. */
export const BLU_UNIVERSAL_KEEPALIVE_SEC = 6 * 60 * 60;
export const BLU_TRV_MODEL_ID = 'SBTR-001AEU';

/**
 * Single source of truth for all Shelly BLU devices.
 * Key: stable model string. Value: device info.
 * All lookups are derived from this record — add a device here and everything updates.
 * Sources: the BLU common model table and per-device documentation pages.
 */
export const BLU_DEVICES: Record<string, BLUDeviceInfo> = {
    // BLU (BLE-only). Event devices fall back to the 6h keepalive.
    'SBBT-002C': {
        productName: 'Shelly BLU Button1',
        modelId: 1,
        isRemote: true,
        reportCadenceSec: BLU_UNIVERSAL_KEEPALIVE_SEC
    },
    'SBDW-002C': {
        productName: 'Shelly BLU Door/Window',
        modelId: 2,
        reportCadenceSec: BLU_UNIVERSAL_KEEPALIVE_SEC
    },
    'SBHT-003C': {
        productName: 'Shelly BLU H&T',
        modelId: 3,
        reportCadenceSec: 60 // beacon always on
    },
    'SBMO-003Z': {
        productName: 'Shelly BLU Motion',
        modelId: 5,
        reportCadenceSec: BLU_UNIVERSAL_KEEPALIVE_SEC
    },
    'SBBT-004CEU': {
        productName: 'Shelly BLU Wall Switch 4',
        modelId: 6,
        isRemote: true,
        reportCadenceSec: BLU_UNIVERSAL_KEEPALIVE_SEC
    },
    'SBBT-004CUS': {
        productName: 'Shelly BLU RC Button 4',
        modelId: 7,
        isRemote: true,
        reportCadenceSec: BLU_UNIVERSAL_KEEPALIVE_SEC
    },
    // BLU ZB (BLE + Zigbee)
    'SBBT-102C': {
        productName: 'Shelly BLU Button Tough 1 ZB',
        modelId: 23,
        isRemote: true,
        reportCadenceSec: 900 // normal-mode beacon (15 min)
    },
    'SBBT-104CUS': {
        productName: 'Shelly BLU RC Button 4 ZB',
        modelId: 22,
        isRemote: true,
        reportCadenceSec: 900
    },
    'SBBT-104CEU': {
        productName: 'Shelly BLU Wall Switch 4 ZB',
        modelId: 21,
        isRemote: true,
        reportCadenceSec: 900
    },
    'SBHT-103C': {
        productName: 'Shelly BLU H&T Display ZB',
        modelId: 12,
        reportCadenceSec: 60 // beacon always on
    },
    'SBHT-203C': {
        productName: 'Shelly BLU H&T ZB',
        modelId: 17,
        reportCadenceSec: 60 // beacon always on
    },
    'SBDW-103C': {
        productName: 'Shelly BLU Door/Window ZB',
        modelId: 20,
        reportCadenceSec: 3600 // beacon default off → 60-min Device-Id packet
    },
    'SBMO-103Z': {
        productName: 'Shelly BLU Motion ZB',
        modelId: 19,
        reportCadenceSec: 900 // normal-mode beacon
    },
    [BLU_TRV_MODEL_ID]: {
        productName: 'Shelly BLU TRV',
        modelId: 8,
        reportCadenceSec: 8 // beacon always on
    },
    'SBRC-005B': {
        productName: 'Shelly BLU Remote',
        modelId: 9,
        isRemote: true,
        noHeartbeat: true // transmits only on user interaction, no keepalive
    },
    'SBWS-90CM': {
        productName: 'Ecowitt WS90 Weather Station',
        modelId: 11,
        reportCadenceSec: 9 // periodic 8.8s
    },
    'SBDI-003E': {
        productName: 'Shelly BLU Distance',
        modelId: 4,
        reportCadenceSec: 300 // maximum configured measurement interval
    }
};

interface BluDevicePresentation {
    productName: string;
    imageModel: string;
}

const BLU_PRESENTATIONS: Readonly<Record<string, BluDevicePresentation>> = {
    'SBBT-002C:SBBT-002C-T-Ivr': {
        productName: 'Shelly BLU Button Tough 1',
        imageModel: 'SBBT-002C-T-Ivr'
    }
};

/** A physical presentation may share its protocol identity with another BLU
 *  product. Only known catalog pairs may select different display metadata. */
export function resolveBluPresentation(
    modelId: string | null | undefined,
    requestedImageModel: string | null | undefined
): BluDevicePresentation | undefined {
    if (!modelId || !requestedImageModel) return undefined;
    return BLU_PRESENTATIONS[`${modelId}:${requestedImageModel}`];
}

export function resolveBluPresentationImageModel(
    modelId: string | null | undefined,
    requestedImageModel: string | null | undefined
): string | undefined {
    return resolveBluPresentation(modelId, requestedImageModel)?.imageModel;
}

/**
 * Per-model BTHome sensor kind overrides — for a model whose repeated use of
 * one obj_id needs positional disambiguation, or whose generic obj_id meaning
 * is wrong for that specific model. Keyed by the same model string as
 * BLU_DEVICES so device knowledge stays in one file. `idx` is the sensor's
 * position among repeats of the same obj_id in the device's fixed packet
 * layout (BTHome.AddSensor's idx, carried on the bthomesensor:N config) —
 * omitted means the override applies regardless of idx (single-occurrence
 * obj_id). `excludeFromEnergy` keeps a reading that BTHOME_ENERGY_SPEC would
 * otherwise classify as electrical (bthomeSpec.ts) out of the energy
 * pipeline for this model.
 */
export interface BluSensorOverrideRule {
    model: string;
    objId: number;
    idx?: number;
    kind: string;
    excludeFromEnergy?: boolean;
}

const BLU_SENSOR_OVERRIDES: readonly BluSensorOverrideRule[] = [
    // WS90 sends both wind speed and gust speed as obj 0x44 ('speed'),
    // disambiguated only by position in the packet: idx 0 = speed, idx 1 =
    // gust (docs-ble/Devices/BLU_ZB/EcowittWS90WeatherStation.md, Packet
    // Type 1, entries 3 and 4).
    {model: 'SBWS-90CM', objId: 68, idx: 0, kind: 'wind_speed'},
    {model: 'SBWS-90CM', objId: 68, idx: 1, kind: 'wind_gust'},
    // WS90 reuses the generic moisture Wet/Dry object (0x20) to report
    // raining/not-raining (same doc, Packet Type 1 entry 2: "rain status").
    {model: 'SBWS-90CM', objId: 32, kind: 'rain'},
    // WS90's own capacitor/solar charge (device health), riding the generic
    // voltage object (0x0C) that bthomeSpec.ts otherwise treats as mains
    // voltage for every other BTHome device — exclude it from the energy
    // pipeline for this model only (same doc, Packet Type 2 entry 4).
    {
        model: 'SBWS-90CM',
        objId: 12,
        kind: 'capacitor_voltage',
        excludeFromEnergy: true
    },
    // BLU TRV sends temperature (0x45) three times per packet, in this
    // fixed order (docs-ble/Devices/BLU_ZB/BluTRV.mdx BTHome table): target,
    // current, external.
    {model: 'SBTR-001AEU', objId: 69, idx: 0, kind: 'target_temperature'},
    {model: 'SBTR-001AEU', objId: 69, idx: 1, kind: 'current_temperature'},
    {model: 'SBTR-001AEU', objId: 69, idx: 2, kind: 'external_temperature'}
];

/** Resolve the model-specific kind override for a BTHome sensor reading, or
 *  null when none applies (caller falls back to the generic obj_id kind). */
export function resolveBluSensorOverride(
    model: string | undefined,
    objId: number,
    idx: number | undefined
): BluSensorOverrideRule | null {
    if (!model) return null;
    return (
        BLU_SENSOR_OVERRIDES.find(
            (rule) =>
                rule.model === model &&
                rule.objId === objId &&
                (rule.idx === undefined || rule.idx === idx)
        ) ?? null
    );
}

/** Seconds of silence below which a healthy BLU device of this model would
 *  false-fire a deadman alert, or null if it must not get a heartbeat at all.
 *  Keyed by the device-reported model string; unknown models fall back to the
 *  6h universal keepalive. */
export function bluHeartbeatFloorSec(modelString: string): number | null {
    const info = BLU_DEVICES[modelString];
    if (info?.noHeartbeat) return null;
    return info?.reportCadenceSec ?? BLU_UNIVERSAL_KEEPALIVE_SEC;
}

// A healthy BLU device can drop a few lossy BLE adverts, so it is only judged
// silent after this many missed reports.
export const BLU_MISSED_REPORTS_TOLERANCE = 3;

// The miss tolerance absorbs lossy adverts on fast beacons, but a multi-hour
// keepalive shouldn't wait 3 whole intervals. Cap the grace past one interval.
const BLU_SILENCE_GRACE_CAP_SEC = 60 * 60;

/** Silence (ms) before a BLU device of this model is judged offline: its report
 *  cadence plus a miss-tolerance grace, capped so slow keepalive devices don't
 *  wait multiple intervals. null when the model has no reliable cadence (it
 *  reports only on interaction), so silence alone never marks it offline. */
export function bluSilenceThresholdMs(
    modelString: string | null
): number | null {
    if (!modelString) return null;
    const floorSec = bluHeartbeatFloorSec(modelString);
    if (floorSec === null) return null;
    const silenceSec = Math.min(
        floorSec * BLU_MISSED_REPORTS_TOLERANCE,
        floorSec + BLU_SILENCE_GRACE_CAP_SEC
    );
    return silenceSec * 1000;
}

/** True when a BLU device of this model has been silent past its threshold.
 *  Single home for the check — the device list, snapshot, and relationship
 *  facts all call this so they can't drift. null-cadence models are never
 *  stale on silence alone (they ride their gateway). */
export function isBluTransportStale(
    lastSeenAt: Date | string | null | undefined,
    modelId: string | null | undefined
): boolean {
    const thresholdMs = bluSilenceThresholdMs(modelId ?? null);
    if (thresholdMs === null) return false;
    if (!lastSeenAt) return true;
    const t = new Date(lastSeenAt).getTime();
    if (!Number.isFinite(t)) return true;
    return Date.now() - t > thresholdMs;
}

// Internal reverse lookup: numeric model_id → stable model string
const _modelIdToModelString: Record<number, string> = Object.fromEntries(
    Object.entries(BLU_DEVICES)
        .filter(([, v]) => v.modelId !== undefined)
        .map(([k, v]) => [v.modelId!, k])
);

/** Resolve numeric model_id (from shelly_mfdata 0x0B block) to stable model string. */
export function resolveModelString(modelId: number): string | undefined {
    return _modelIdToModelString[modelId];
}

export function resolveModelNumericId(
    modelString: string | undefined
): number | undefined {
    if (!modelString) return undefined;
    return BLU_DEVICES[modelString]?.modelId;
}

export function resolveBluDeviceInfo(
    modelString: string | undefined,
    modelNumericId?: number,
    requestedImageModel?: string
): {
    modelId?: string;
    modelNumericId?: number;
    productName: string;
    isRemote: boolean;
} {
    const normalizedModelId =
        (modelString && BLU_DEVICES[modelString] ? modelString : undefined) ??
        (typeof modelNumericId === 'number'
            ? resolveModelString(modelNumericId)
            : undefined);
    const resolvedNumericId =
        typeof modelNumericId === 'number'
            ? modelNumericId
            : resolveModelNumericId(normalizedModelId);
    const productName =
        resolveBluPresentation(normalizedModelId, requestedImageModel)
            ?.productName ??
        resolveBluDeviceName(normalizedModelId, resolvedNumericId);
    const isRemote = normalizedModelId
        ? (BLU_DEVICES[normalizedModelId]?.isRemote ?? false)
        : false;

    return {
        modelId: normalizedModelId,
        modelNumericId: resolvedNumericId,
        productName,
        isRemote
    };
}

export function formatBTHomeEventName(value: string): string {
    return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatBTHomeChannelLabel(channel: number): string {
    if (!Number.isFinite(channel)) {
        return 'Channel';
    }

    return `Channel ${Math.trunc(channel) + 1}`;
}

export function getBTHomeEventSourceLabel(options: {
    event?: string | null;
    idx?: number | null;
    controls?: Array<{objId: number; idx: number; label?: string}>;
    fallback?: string;
}): string {
    const {event, idx, controls, fallback = 'Last Event'} = options;

    if (typeof idx === 'number' && idx >= 0 && controls?.length) {
        const control = controls.find((entry) => entry.idx === idx);
        if (control) {
            return (
                control.label ?? formatBTHomeControlLabel(control.objId, idx)
            );
        }
    }

    if (typeof event === 'string' && event.startsWith('rotate_')) {
        return formatBTHomeControlLabel(60, idx ?? 0);
    }

    if (typeof idx === 'number' && idx >= 0) {
        return formatBTHomeControlLabel(58, idx);
    }

    return fallback;
}

export function formatBTHomeEventSummary(
    event: string,
    idx?: number | null,
    controls?: Array<{objId: number; idx: number; label?: string}>,
    channel?: number | null
): string {
    const formattedEvent = formatBTHomeEventName(event);
    const sourceLabel = getBTHomeEventSourceLabel({event, idx, controls});
    const eventSummary =
        sourceLabel === 'Last Event'
            ? formattedEvent
            : `${sourceLabel}: ${formattedEvent}`;

    return typeof channel === 'number' && channel >= 0
        ? `${eventSummary} · ${formatBTHomeChannelLabel(channel)}`
        : eventSummary;
}

const BTHOME_RESERVED_ID_MIN = 200;
const BTHOME_RESERVED_ID_MAX = 299;
const BTHOME_DYNAMIC_COMPONENT_PREFIXES = [
    'bthomedevice:',
    'bthomesensor:',
    'bthomecontrol:',
    'blutrv:'
] as const;

export type BTHomeConfiguredSensor = {
    key: string;
    id: number;
    config: Record<string, any>;
};

export type BTHomeSensorSample = {
    value: any;
    lastUpdatedTs: number | null;
};

export type BTHomeSensorSampleEntry = {
    addr: string;
    objId: number;
    idx: number;
    value: any;
    lastUpdatedTs: number | null;
};

export type BTHomeKnownObjectRole =
    | 'telemetry'
    | 'event_control'
    | 'device_state'
    | 'device_meta'
    | 'unknown';

export type BTHomeKnownObjectDisplayMode =
    | 'sensor_row'
    | 'control'
    | 'device_state'
    | 'meta'
    | 'unknown';

type BTHomeResolvedObjectInfo = {
    objName: string;
    rawType: string;
    unit: string;
    label: string;
};

const BTHOME_META_OBJECT_IDS = new Set([0, 240, 241, 242]);

function normalizeBTHomeObjectKey(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function resolveBTHomeKnownObjectInfo(
    objId: number,
    dynamicInfo?: Record<string, any>
): BTHomeResolvedObjectInfo {
    const staticInfo = bthomeObjectInfos[objId];
    const objName =
        (typeof dynamicInfo?.obj_name === 'string' &&
        dynamicInfo.obj_name.trim()
            ? dynamicInfo.obj_name.trim()
            : undefined) ??
        staticInfo?.name ??
        `object_${objId}`;
    const rawType =
        (typeof dynamicInfo?.type === 'string' && dynamicInfo.type.trim()
            ? dynamicInfo.type.trim()
            : undefined) ??
        staticInfo?.type ??
        'sensor';
    const unit =
        typeof dynamicInfo?.unit === 'string'
            ? dynamicInfo.unit
            : (staticInfo?.unit ?? '');

    return {
        objName,
        rawType,
        unit,
        label: formatBTHomeEventName(objName)
    };
}

export function classifyBTHomeKnownObject(options: {
    objId: number;
    objName: string;
    rawType: string;
}): {
    role: BTHomeKnownObjectRole;
    addable: boolean;
    displayMode: BTHomeKnownObjectDisplayMode;
} {
    const {objId} = options;
    const rawType = options.rawType.trim().toLowerCase();
    const objectKey = normalizeBTHomeObjectKey(options.objName);

    if (BTHOME_META_OBJECT_IDS.has(objId) || objectKey === 'packet_id') {
        return {
            role: 'device_meta',
            addable: false,
            displayMode: 'meta'
        };
    }

    if (objId === 96 || objectKey === 'channel') {
        return {
            role: 'device_state',
            addable: false,
            displayMode: 'device_state'
        };
    }

    if (
        isBTHomeControlObjectId(objId) ||
        rawType === 'button' ||
        rawType === 'dimmer'
    ) {
        return {
            role: 'event_control',
            addable: false,
            displayMode: 'control'
        };
    }

    if (rawType === 'sensor' || rawType === 'binary_sensor' || rawType) {
        return {
            role: 'telemetry',
            addable: true,
            displayMode: 'sensor_row'
        };
    }

    return {
        role: 'unknown',
        addable: false,
        displayMode: 'unknown'
    };
}

export function normalizeBTHomeComponentConfig(key: string, config: any): any {
    if (
        !key.startsWith('bthomesensor:') ||
        !config ||
        typeof config !== 'object'
    ) {
        return config;
    }

    const idx =
        typeof config.idx === 'number'
            ? config.idx
            : typeof config.obj_idx === 'number'
              ? config.obj_idx
              : undefined;

    if (typeof idx !== 'number' || config.idx === idx) {
        return config;
    }

    return {
        ...config,
        idx
    };
}

export function buildBTHomeSensorSampleKey(
    addr: string,
    objId: number,
    idx: number
): string {
    return `${addr}:${objId}:${idx}`;
}

export function rememberBTHomeSensorSample(
    samples: Map<string, BTHomeSensorSample>,
    sample: BTHomeSensorSampleEntry
): boolean {
    const {addr, objId, idx, value, lastUpdatedTs} = sample;
    if (!addr || !Number.isFinite(objId) || !Number.isFinite(idx)) {
        return false;
    }
    if (value === undefined) {
        return false;
    }

    samples.set(buildBTHomeSensorSampleKey(addr, objId, idx), {
        value,
        lastUpdatedTs: typeof lastUpdatedTs === 'number' ? lastUpdatedTs : null
    });
    return true;
}

export function collectBTHomeKnownObjectSamples(
    addr: string | undefined,
    objects: Array<Record<string, any>>
): BTHomeSensorSampleEntry[] {
    if (!addr) return [];

    return objects
        .filter(
            (obj) => typeof obj?.obj_id === 'number' && obj.value !== undefined
        )
        .map((obj) => ({
            addr,
            objId: obj.obj_id,
            idx: typeof obj?.idx === 'number' ? obj.idx : 0,
            value: obj.value,
            lastUpdatedTs:
                typeof obj?.last_updated_ts === 'number'
                    ? obj.last_updated_ts
                    : null
        }));
}

export function resolveBTHomeSensorSample(options: {
    samples: ReadonlyMap<string, BTHomeSensorSample>;
    addr: string;
    objId: number;
    idx: number;
    parentStatus?: Record<string, any> | null;
}): BTHomeSensorSample | null {
    const direct = options.samples.get(
        buildBTHomeSensorSampleKey(options.addr, options.objId, options.idx)
    );
    if (direct) return direct;

    if (
        options.objId === 1 &&
        typeof options.parentStatus?.battery === 'number'
    ) {
        return {
            value: options.parentStatus.battery,
            lastUpdatedTs:
                typeof options.parentStatus?.last_updated_ts === 'number'
                    ? options.parentStatus.last_updated_ts
                    : null
        };
    }

    return null;
}

export function normalizeBTHomeComponentConfigs(
    configs: Record<string, any>
): Record<string, any> {
    let changed = false;
    const next: Record<string, any> = {};

    for (const [key, value] of Object.entries(configs)) {
        const normalized = normalizeBTHomeComponentConfig(key, value);
        next[key] = normalized;
        if (normalized !== value) {
            changed = true;
        }
    }

    return changed ? next : configs;
}

export function collectUsedBTHomeDynamicIds(
    configs: Record<string, any>
): number[] {
    return Object.keys(configs)
        .filter((key) =>
            BTHOME_DYNAMIC_COMPONENT_PREFIXES.some((prefix) =>
                key.startsWith(prefix)
            )
        )
        .map((key) => Number.parseInt(key.split(':')[1] ?? '', 10))
        .filter(
            (id) =>
                Number.isFinite(id) &&
                id >= BTHOME_RESERVED_ID_MIN &&
                id <= BTHOME_RESERVED_ID_MAX
        )
        .sort((a, b) => a - b);
}

export function pickFreeReservedBTHomeId(
    configs: Record<string, any>
): number | null {
    const usedIds = new Set(collectUsedBTHomeDynamicIds(configs));

    for (let id = BTHOME_RESERVED_ID_MIN; id <= BTHOME_RESERVED_ID_MAX; id++) {
        if (!usedIds.has(id)) {
            return id;
        }
    }

    return null;
}

export function pickBTHomeSensorComponentId(
    configs: Record<string, any>,
    preferredId: number
): number | null {
    const usedIds = new Set(collectUsedBTHomeDynamicIds(configs));
    if (!configs[`bthomesensor:${preferredId}`] && !usedIds.has(preferredId)) {
        return preferredId;
    }

    for (let id = BTHOME_RESERVED_ID_MIN; id <= BTHOME_RESERVED_ID_MAX; id++) {
        if (!usedIds.has(id)) {
            return id;
        }
    }

    return null;
}

export function findConfiguredBTHomeSensor(
    configs: Record<string, any>,
    addr: string,
    objId: number,
    idx: number
): BTHomeConfiguredSensor | null {
    for (const [key, value] of Object.entries(configs)) {
        if (!key.startsWith('bthomesensor:')) continue;
        const config = normalizeBTHomeComponentConfig(key, value);
        if (config?.addr !== addr) continue;
        if (config?.obj_id !== objId) continue;
        if (config?.idx !== idx) continue;

        return {
            key,
            id:
                typeof config.id === 'number'
                    ? config.id
                    : Number.parseInt(key.split(':')[1] ?? '', 10),
            config
        };
    }

    return null;
}

export function mapBTHomeKnownObjects(
    configs: Record<string, any>,
    addr: string | undefined,
    objects: Array<Record<string, any>>,
    objectInfosById: Record<number, Record<string, any>> = {}
): Array<Record<string, any>> {
    return objects
        .filter((obj) => typeof obj?.obj_id === 'number')
        .map((obj) => {
            const idx = typeof obj?.idx === 'number' ? obj.idx : 0;
            const configured =
                addr && typeof obj.obj_id === 'number'
                    ? findConfiguredBTHomeSensor(configs, addr, obj.obj_id, idx)
                    : null;
            const component = obj.component ?? configured?.key ?? null;
            const info = resolveBTHomeKnownObjectInfo(
                obj.obj_id,
                objectInfosById[obj.obj_id]
            );
            const semantics = classifyBTHomeKnownObject({
                objId: obj.obj_id,
                objName: info.objName,
                rawType: info.rawType
            });

            return {
                ...obj,
                idx,
                component,
                obj_name: info.objName,
                type: info.rawType,
                unit: info.unit,
                label: info.label,
                role: semantics.role,
                addable: semantics.addable,
                displayMode: semantics.displayMode,
                deviceLevel: semantics.addable === false
            };
        });
}

export function mapBTHomeKnownSensorObjects(
    configs: Record<string, any>,
    addr: string | undefined,
    objects: Array<Record<string, any>>,
    objectInfosById: Record<number, Record<string, any>> = {}
): Array<Record<string, any>> {
    return mapBTHomeKnownObjects(
        configs,
        addr,
        objects,
        objectInfosById
    ).filter((obj) => obj.addable === true || obj.component);
}

/** Resolve model string or numeric model_id to human-readable product name. */
export function resolveBluDeviceName(
    modelOrType: string | undefined,
    modelId?: number
): string {
    if (modelOrType && BLU_DEVICES[modelOrType])
        return BLU_DEVICES[modelOrType].productName;
    if (typeof modelId === 'number') {
        const ms = _modelIdToModelString[modelId];
        if (ms) return BLU_DEVICES[ms].productName;
    }
    if (modelOrType) return modelOrType;
    return 'BLE Device';
}
