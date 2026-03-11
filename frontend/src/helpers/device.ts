import type {shelly_device_t} from '@/types';

export function getLogo(device?: shelly_device_t | undefined) {
    const deviceInfo = device?.info;
    if (deviceInfo == undefined || deviceInfo.model == undefined) {
        return '/shelly_logo_black.jpg';
    }

    // Check for Cury device (shellyID starts with "cury-" or app is "Cury")
    if (device?.shellyID?.startsWith('cury-') || deviceInfo.app === 'Cury') {
        return '/images/devices/cury.png';
    }

    const jwt = deviceInfo.jwt;
    if (jwt != null) {
        const svcType = jwt?.xt1?.svc0?.type;
        if (typeof svcType === 'string') {
            return getLogoFromModel(svcType);
        }
    }

    return getLogoFromModel(deviceInfo.model);
}

export function getLogoFromModel(model?: string) {
    if (!model || model === 'S3MX-0A') {
        return '/shelly_logo_black.jpg';
    }

    if (
        model.charAt(2) == 'S' &&
        model.charAt(3) == 'W' &&
        model.charAt(5) != '0'
    ) {
        const temp = model.split('');
        temp[5] = '0';
        model = temp.join('');
    }
    return `/images/devices/${model}.png`;
}

/**
 * Best-effort logo from shellyID prefix (e.g. "shelly2pmg4-98a31671fa04").
 * Maps common prefixes to a representative model image.
 * Falls back to the generic Shelly logo for unknown prefixes.
 */
const SHELLY_ID_PREFIX_TO_MODEL: Readonly<Record<string, string>> = {
    // Gen 2 Plus
    'shellyplus1': 'SPSW-101PE16EU',
    'shellyplus1pm': 'SPSW-001PE16EU',
    'shellyplus2pm': 'SPSW-202PE16EU',
    'shellyplusht': 'SBHT-003C',
    'shellyplusplugs': 'SNPL-00110EU',
    'shellyplusplugus': 'SNPL-00116US',
    'shellyplusplugit': 'SNPL-00116IT',
    'shellypluspluguk': 'SNPL-00112UK',
    'shellyplusuni': 'SNSW-001X16EU',
    'shellyplusdimmer010v': 'SNDM-00100WW',
    'shellyplusi4': 'SNSN-0024X',
    'shellyplussmoke': 'SNSN-0031Z',
    'shellyplusrgbwpm': 'SNDC-0D4P10WW',
    // Gen 2 Pro
    'shellypro1': 'SPSW-101PE16EU',
    'shellypro1pm': 'SPSW-001PE16EU',
    'shellypro2': 'SPSW-102PE16EU',
    'shellypro2pm': 'SPSW-202PE16EU',
    'shellypro3': 'SPSW-102PE16EU',
    'shellypro4pm': 'SPSW-004PE16EU',
    'shellypro3em': 'SPEM-003CEBEU',
    'shellyproem50': 'SPEM-002CEBEU50',
    'shellyprodm1pm': 'SPDM-001PE01EU',
    'shellyprodm2pm': 'SPDM-002PE01EU',
    // Gen 3
    'shelly1g3': 'S3SW-001X8EU',
    'shelly1pmg3': 'S3SW-001P8EU',
    'shelly2pmg3': 'S3SW-002P16EU',
    'shellypmminig3': 'S3PM-001PCEU16',
    'shellyplugsg3': 'S3PL-00112EU',
    'shellyhtg3': 'S3SN-0024X',
    'shellyi4g3': 'S3SN-0D24X',
    'shelly0110dimg3': 'S3DM-0010WW',
    'shellyemg3': 'S3EM-002CXCEU',
    'shellyblug3': 'S3BL-C010007AEU',
    'shellyxtrg3': 'S3XT-0S',
    // Gen 4
    'shelly1g4': 'S4SW-001X8EU',
    'shelly1pmg4': 'S4SW-001P8EU',
    'shelly2pmg4': 'S4SW-002P16EU',
    'shellyplugsg4': 'S4PL-00416EU',
    // BLU
    'sbbt': 'SBBT-002C',
    'sbdw': 'SBDW-002C',
    'sbmo': 'SBMO-003Z',
    // Cury
    'cury': 'cury',
};

export function getLogoFromShellyID(shellyID: string): string {
    const prefix = shellyID.split('-')[0].toLowerCase();
    const model = SHELLY_ID_PREFIX_TO_MODEL[prefix];
    if (model) return `/images/devices/${model}.png`;
    return '/shelly_logo.png';
}

const ENTITY_ICON_MAP: Readonly<Record<string, string>> = {
    input: 'fas fa-arrow-right',
    temperature: 'fas fa-thermometer-half',
    bthomesensor: 'fas fa-thermometer-half',
    light: 'fas fa-lightbulb',
    cct: 'fas fa-lightbulb',
    rgb: 'fas fa-palette',
    rgbw: 'fas fa-palette',
    rgbcct: 'fas fa-palette',
    cover: 'fas fa-window-maximize',
    em: 'fas fa-bolt',
    em1: 'fas fa-bolt',
    pm1: 'fas fa-bolt',
    number: 'fas fa-vr-cardboard',
    text: 'fas fa-vr-cardboard',
    enum: 'fas fa-vr-cardboard',
    bool: 'fas fa-vr-cardboard',
    group: 'fas fa-vr-cardboard',
    button: 'fas fa-vr-cardboard',
    cury: 'fas fa-spray-can',
    humidity: 'fas fa-droplet',
    voltmeter: 'fas fa-gauge'
};

export function getPredefinedImageForEntity(entity?: string) {
    if (!entity) return '/shelly_logo_black.jpg';
    return ENTITY_ICON_MAP[entity] ?? 'fas fa-power-off';
}

export function getDeviceName(info?: any, shellyID?: string) {
    return info?.name || info?.jwt?.n || info?.id || shellyID;
}

export function getAppName(info?: any) {
    return info?.jwt?.p || info?.app || 'Shelly Smart Device';
}

export const BATTERY_POWERED_DEVICES_APPS = ['HTG3', 'PlusSmoke', 'FloodSensorG4'];

export function isDiscovered(shellyID?: string) {
    return shellyID && shellyID.endsWith('.local');
}

/**
 * Get the level indicator for a device (battery %, vial level %, etc.)
 * For Cury devices: returns the minimum vial level of left/right slots (or the only valid one)
 * For battery-powered devices: returns battery percentage
 * Rule for Cury: We use the minimum of left/right vial levels because when either
 * vial runs out, the device functionality is impacted. This provides a "worst case"
 * view that helps users know when they need to refill.
 */
export function getLevelIndicator(device?: shelly_device_t): {
    value: number | null;
    type: 'battery' | 'vial' | null;
} {
    if (!device?.status) return {value: null, type: null};

    // Check for Cury device (scent diffuser)
    const curyStatus = device.status['cury:0'];
    if (curyStatus?.slots) {
        const leftSlot = curyStatus.slots?.left;
        const rightSlot = curyStatus.slots?.right;

        // Check if vial is actually inserted (serial is not all zeros)
        const leftHasVial =
            leftSlot?.vial?.serial &&
            leftSlot.vial.serial !== '0000000000000000';
        const rightHasVial =
            rightSlot?.vial?.serial &&
            rightSlot.vial.serial !== '0000000000000000';

        // Get valid levels (exclude -1 which means "still reading")
        const levels: number[] = [];
        if (
            leftHasVial &&
            typeof leftSlot.vial.level === 'number' &&
            leftSlot.vial.level >= 0
        ) {
            levels.push(leftSlot.vial.level);
        }
        if (
            rightHasVial &&
            typeof rightSlot.vial.level === 'number' &&
            rightSlot.vial.level >= 0
        ) {
            levels.push(rightSlot.vial.level);
        }

        if (levels.length > 0) {
            // Return minimum level - when either vial is low, user should be notified
            return {value: Math.min(...levels), type: 'vial'};
        }
    }

    // Check for battery-powered devices
    if (BATTERY_POWERED_DEVICES_APPS.includes(device.info?.app)) {
        const deviceBattery =
            device.status?.devicepower?.battery?.percent ??
            device.status?.['devicepower:0']?.battery?.percent;
        if (typeof deviceBattery === 'number') {
            return {value: deviceBattery, type: 'battery'};
        }
    }

    return {value: null, type: null};
}

export function parseFwVersion(ver: string): number[] {
    const match = ver.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0];
    return [
        Number.parseInt(match[1]),
        Number.parseInt(match[2]),
        Number.parseInt(match[3])
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
