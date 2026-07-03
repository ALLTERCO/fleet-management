import {tuning} from '../../config/tuning';
import type {DeviceInfoEnrichment, SanitizedStatusShape} from './types';

const COMPONENT_KEY_RE = /^[a-z_]+:\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

function getRecord(
    source: Record<string, unknown> | undefined,
    key: string
): Record<string, unknown> | undefined {
    if (!source) return undefined;
    try {
        const value = source[key];
        return isRecord(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function getString(
    source: Record<string, unknown> | undefined,
    key: string
): string | undefined {
    if (!source) return undefined;
    try {
        const value = source[key];
        if (typeof value !== 'string') return undefined;
        return value.slice(0, tuning.waitingRoom.sanitizeMaxStringLen);
    } catch {
        return undefined;
    }
}

function getNumber(
    source: Record<string, unknown> | undefined,
    key: string
): number | undefined {
    if (!source) return undefined;
    try {
        const value = source[key];
        return typeof value === 'number' && Number.isFinite(value)
            ? value
            : undefined;
    } catch {
        return undefined;
    }
}

function getBoolean(
    source: Record<string, unknown> | undefined,
    key: string
): boolean | undefined {
    if (!source) return undefined;
    try {
        const value = source[key];
        return typeof value === 'boolean' ? value : undefined;
    } catch {
        return undefined;
    }
}

function assignIfDefined<T extends object, K extends keyof T>(
    target: T,
    key: K,
    value: T[K] | undefined
) {
    if (value !== undefined) target[key] = value;
}

function sanitizeComponents(
    raw: Record<string, unknown>,
    target: SanitizedStatusShape
) {
    let kept = 0;
    for (const key of Object.keys(raw)) {
        if (!COMPONENT_KEY_RE.test(key)) continue;
        target[key] = {};
        kept++;
        if (kept >= tuning.waitingRoom.sanitizeMaxComponentKeys) break;
    }
}

export function sanitizeStatus(raw: unknown): SanitizedStatusShape {
    if (!isRecord(raw)) return {};

    const status: SanitizedStatusShape = {};

    const wifi = getRecord(raw, 'wifi');
    if (wifi) {
        const sanitizedWifi: NonNullable<SanitizedStatusShape['wifi']> = {};
        assignIfDefined(sanitizedWifi, 'sta_ip', getString(wifi, 'sta_ip'));
        assignIfDefined(sanitizedWifi, 'ssid', getString(wifi, 'ssid'));
        assignIfDefined(sanitizedWifi, 'rssi', getNumber(wifi, 'rssi'));
        if (Object.keys(sanitizedWifi).length > 0) status.wifi = sanitizedWifi;
    }

    const eth = getRecord(raw, 'eth');
    if (eth) {
        const sanitizedEth: NonNullable<SanitizedStatusShape['eth']> = {};
        assignIfDefined(sanitizedEth, 'ip', getString(eth, 'ip'));
        if (Object.keys(sanitizedEth).length > 0) status.eth = sanitizedEth;
    }

    const sys = getRecord(raw, 'sys');
    if (sys) {
        const sanitizedSys: NonNullable<SanitizedStatusShape['sys']> = {};
        assignIfDefined(sanitizedSys, 'mac', getString(sys, 'mac'));
        assignIfDefined(sanitizedSys, 'fw_id', getString(sys, 'fw_id'));
        assignIfDefined(sanitizedSys, 'ver', getString(sys, 'ver'));
        assignIfDefined(sanitizedSys, 'gen', getNumber(sys, 'gen'));
        assignIfDefined(sanitizedSys, 'app', getString(sys, 'app'));
        assignIfDefined(sanitizedSys, 'uptime', getNumber(sys, 'uptime'));
        assignIfDefined(sanitizedSys, 'unixtime', getNumber(sys, 'unixtime'));
        // Battery/sleeping devices report their wake interval here. Kept so the
        // card can flag a sleeper and the entry TTL can outlive the sleep cycle.
        assignIfDefined(
            sanitizedSys,
            'wakeup_period',
            getNumber(sys, 'wakeup_period')
        );

        const sysDevice = getRecord(sys, 'device');
        if (sysDevice) {
            const device: NonNullable<
                NonNullable<SanitizedStatusShape['sys']>['device']
            > = {};
            assignIfDefined(device, 'name', getString(sysDevice, 'name'));
            assignIfDefined(device, 'profile', getString(sysDevice, 'profile'));
            assignIfDefined(device, 'model', getString(sysDevice, 'model'));
            if (Object.keys(device).length > 0) sanitizedSys.device = device;
        }

        const stable = getRecord(getRecord(sys, 'available_updates'), 'stable');
        const stableVersion = getString(stable, 'version');
        if (stableVersion !== undefined) {
            sanitizedSys.available_updates = {
                stable: {version: stableVersion}
            };
        }

        if (Object.keys(sanitizedSys).length > 0) status.sys = sanitizedSys;
    }

    const cloudConnected = getBoolean(getRecord(raw, 'cloud'), 'connected');
    if (cloudConnected !== undefined) {
        status.cloud = {connected: cloudConnected};
    }

    const mqttConnected = getBoolean(getRecord(raw, 'mqtt'), 'connected');
    if (mqttConnected !== undefined) {
        status.mqtt = {connected: mqttConnected};
    }

    const bleEnabled = getBoolean(getRecord(raw, 'ble'), 'enabled');
    if (bleEnabled !== undefined) {
        status.ble = {enabled: bleEnabled};
    }

    assignIfDefined(status, 'auth_en', getBoolean(raw, 'auth_en'));
    sanitizeComponents(raw, status);

    return status;
}

export function sanitizePendingPayload(jdoc: unknown): {
    shellyID?: string;
    status: SanitizedStatusShape;
} {
    if (!isRecord(jdoc)) return {status: {}};

    const pending: {shellyID?: string; status: SanitizedStatusShape} = {
        status: sanitizeStatus(getRecord(jdoc, 'status') ?? {})
    };
    const shellyID = getString(jdoc, 'shellyID');
    if (shellyID !== undefined) pending.shellyID = shellyID;
    return pending;
}

// Pull every jwt.xt1.svc<N>.type pair into a {index → type} map.
// Walking all svc* keys (not just svc0) future-proofs for multi-service XT1.
function extractXt1Services(
    jwt: Record<string, unknown> | undefined
): Record<string, string> | undefined {
    const xt1 = getRecord(jwt, 'xt1');
    if (!xt1) return undefined;
    const services: Record<string, string> = {};
    for (const key of Object.keys(xt1)) {
        const match = /^svc(\d+)$/.exec(key);
        if (!match) continue;
        const type = getString(getRecord(xt1, key), 'type');
        if (type !== undefined) services[match[1]] = type;
    }
    return Object.keys(services).length > 0 ? services : undefined;
}

export function sanitizeDeviceInfo(raw: unknown): DeviceInfoEnrichment {
    if (!isRecord(raw)) return {};
    const result: DeviceInfoEnrichment = {};
    assignIfDefined(result, 'fw_id', getString(raw, 'fw_id'));
    assignIfDefined(result, 'ver', getString(raw, 'ver'));
    assignIfDefined(result, 'gen', getNumber(raw, 'gen'));
    assignIfDefined(result, 'app', getString(raw, 'app'));
    assignIfDefined(result, 'name', getString(raw, 'name'));
    assignIfDefined(result, 'profile', getString(raw, 'profile'));
    assignIfDefined(result, 'model', getString(raw, 'model'));

    const jwt = getRecord(raw, 'jwt');
    assignIfDefined(result, 'productName', getString(jwt, 'n'));

    const xt1Services = extractXt1Services(jwt);
    if (xt1Services !== undefined) {
        result.xt1Services = xt1Services;
        // Shortcut to the lowest-index service so single-service readers
        // (current waiting-room card) don't have to walk the map.
        const lowestKey = Object.keys(xt1Services).sort(
            (a, b) => Number(a) - Number(b)
        )[0];
        result.xt1SvcType = xt1Services[lowestKey];
    }
    return result;
}

export function mergeDeviceInfo(
    status: SanitizedStatusShape,
    info: DeviceInfoEnrichment
): SanitizedStatusShape {
    if (Object.keys(info).length === 0) return status;

    const merged: SanitizedStatusShape = {...status};
    const sys: NonNullable<SanitizedStatusShape['sys']> = {
        ...(merged.sys ?? {})
    };

    if (info.fw_id !== undefined) sys.fw_id = info.fw_id;
    if (info.ver !== undefined) sys.ver = info.ver;
    if (info.gen !== undefined) sys.gen = info.gen;
    if (info.app !== undefined) sys.app = info.app;

    if (
        info.name !== undefined ||
        info.profile !== undefined ||
        info.model !== undefined ||
        info.productName !== undefined ||
        info.xt1Services !== undefined ||
        info.xt1SvcType !== undefined
    ) {
        const device = {...(sys.device ?? {})};
        if (info.name !== undefined) device.name = info.name;
        if (info.profile !== undefined) device.profile = info.profile;
        if (info.model !== undefined) device.model = info.model;
        if (info.productName !== undefined)
            device.productName = info.productName;
        if (info.xt1Services !== undefined)
            device.xt1Services = info.xt1Services;
        if (info.xt1SvcType !== undefined) device.xt1SvcType = info.xt1SvcType;
        sys.device = device;
    }

    merged.sys = sys;
    return merged;
}
