// Pure derived view of "what the device is and what it can do" — no IO.

import type {DeviceCapabilities} from '../types';
import type {DeviceInfo} from './deviceInfo';

// Only meaningful when device.list.kind === 'physical'.
// shelly_powered intentionally absent — no runtime signal to detect it
// today; add union + classifier branch together when one exists.
// xt1.service: null (not 'unknown') when app has no +<service> suffix.
export type DeviceTribe =
    | {kind: 'shelly_native'; app: string; gen: number}
    | {kind: 'xmod'; jti: string}
    | {kind: 'xt1'; jti: string; service: string | null};

// Presence of `addon` IS the boolean — null when no addon. Single SoT.
export interface DeviceProfileFlags {
    isBattery: boolean;
    isBluGateway: boolean;
    hasMediaUi: boolean;
    hasBluTrv: boolean;
    addon: {type: string} | null;
    hostsServiceUnit: boolean;
    hostsVirtualComponents: boolean;
    supportsZigbee: boolean;
    supportsMatter: boolean;
}

export interface DeviceProfile {
    tribe: DeviceTribe;
    componentTypes: ReadonlySet<string>;
    rpcCapabilities: DeviceCapabilities;
    flags: DeviceProfileFlags;
    builtAtMs: number;
}

interface DeriveFlagsInput {
    componentTypes: ReadonlySet<string>;
    config: Record<string, unknown>;
    capabilities: DeviceCapabilities;
}

interface BuildProfileInput {
    info: DeviceInfo;
    status: Record<string, unknown>;
    config: Record<string, unknown>;
    capabilities: DeviceCapabilities;
    nowMs: number;
}

export function classify(info: DeviceInfo): DeviceTribe {
    if (hasJwt(info, 'XT1')) {
        const serviceSuffix = info.app?.split('+')[1];
        return {
            kind: 'xt1',
            jti: info.jti as string,
            service:
                serviceSuffix && serviceSuffix.length > 0 ? serviceSuffix : null
        };
    }
    if (hasJwt(info, 'XMOD')) {
        return {kind: 'xmod', jti: info.jti as string};
    }
    return {
        kind: 'shelly_native',
        app: info.app ?? 'unknown',
        gen: typeof info.gen === 'number' ? info.gen : 0
    };
}

function hasJwt(info: DeviceInfo, aud: string): boolean {
    return typeof info.jti === 'string' && info.jwt?.aud === aud;
}

export function extractComponentTypes(
    status: Record<string, unknown>
): Set<string> {
    const types = new Set<string>();
    for (const key in status) {
        if (!isComponentValue(status[key])) continue;
        types.add(typeOfKey(key));
    }
    return types;
}

function isComponentValue(v: unknown): boolean {
    return typeof v === 'object' && v !== null;
}

function typeOfKey(key: string): string {
    const colonAt = key.indexOf(':');
    return colonAt === -1 ? key : key.slice(0, colonAt);
}

export function deriveFlags(input: DeriveFlagsInput): DeviceProfileFlags {
    const {componentTypes: c, config, capabilities: caps} = input;
    const addonType = readAddonType(config);
    return {
        isBattery: c.has('devicepower'),
        isBluGateway: c.has('bthome'),
        hasMediaUi: c.has('media') || c.has('ui'),
        hasBluTrv: c.has('blutrv'),
        addon: addonType !== undefined ? {type: addonType} : null,
        hostsServiceUnit: !!caps.service,
        hostsVirtualComponents: !!caps.virtualComponents,
        supportsZigbee: c.has('zigbee'),
        supportsMatter: c.has('matter') || !!caps.matter
    };
}

function readAddonType(config: Record<string, unknown>): string | undefined {
    const sys = config.sys as {device?: {addon_type?: unknown}} | undefined;
    const v = sys?.device?.addon_type;
    return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function buildProfile(input: BuildProfileInput): DeviceProfile {
    const componentTypes = extractComponentTypes(input.status);
    return {
        tribe: classify(input.info),
        componentTypes,
        rpcCapabilities: input.capabilities,
        flags: deriveFlags({
            componentTypes,
            config: input.config,
            capabilities: input.capabilities
        }),
        builtAtMs: input.nowMs
    };
}
