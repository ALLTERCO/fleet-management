import {DEVICE_SOURCE_VALUES, type DeviceSource} from '@api/deviceSource';
import {deriveDomainCapabilities} from './device-capabilities';
import {resolveHostDeviceLogo} from './device-logo';
import type {DeviceControlCapabilities, HostDevice} from './types';

function logoField(rawDevice: unknown): {logo?: HostDevice['logo']} {
    const logo = resolveHostDeviceLogo(rawDevice);
    return logo ? {logo} : {};
}

/** Omits the key entirely when absent, so "unknown" never reads as a value. */
function optionalField<T>(key: string, value: T | undefined) {
    return value === undefined ? {} : {[key]: value};
}

function stringArray(value: unknown): string[] | undefined {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
}

function firstGroupId(device: Record<string, unknown>): number | null {
    const groupIds = device.groupIds;
    return Array.isArray(groupIds) && typeof groupIds[0] === 'number'
        ? groupIds[0]
        : null;
}

function numericArray(value: unknown): number[] | undefined {
    return Array.isArray(value)
        ? value.filter((item): item is number => typeof item === 'number')
        : undefined;
}

function stringField(source: Record<string, unknown>, key: string): string {
    const value = source[key];
    return typeof value === 'string' ? value : '';
}

function requiredPositiveIntegerField(
    source: Record<string, unknown>,
    key: string
): number {
    const value = source[key];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    throw new TypeError(`device.${key} must be a positive integer`);
}

function controlCapabilities(
    device: Record<string, unknown>
): DeviceControlCapabilities {
    const status = asRecord(device.status);
    const result: DeviceControlCapabilities = {};
    const kinds = {
        switch: 'relay',
        light: 'light',
        cover: 'cover',
        thermostat: 'thermostat'
    } as const;
    for (const key of Object.keys(status)) {
        const match = key.match(/^(switch|light|cover|thermostat):(\d+)$/);
        if (!match) continue;
        const kind = kinds[match[1] as keyof typeof kinds];
        (result[kind] ??= []).push(Number(match[2]));
    }
    return result;
}

/** Live events carry a boolean and nothing else, so this is what they get. */
export function presenceFields(
    online: boolean
): Pick<HostDevice, 'online' | 'presence'> {
    return {online, presence: online ? 'online' : 'offline'};
}

/** device.list reports presence itself, and it has three states. `pending`
 *  means still being admitted; it used to be flattened to `offline`, which
 *  reads as dead. Older payloads carry only `online`. */
function reportedPresenceFields(
    device: Record<string, unknown>
): Pick<HostDevice, 'online' | 'presence'> {
    if (device.presence === 'pending')
        return {online: false, presence: 'pending'};
    if (device.presence === 'online') return presenceFields(true);
    if (device.presence === 'offline') return presenceFields(false);
    return presenceFields(device.online === true);
}

/** device.list carries the last report under `meta`. A payload without one
 * yields no field at all, because an invented age is worse than no age. */
function lastReportFields(
    device: Record<string, unknown>
): Pick<HostDevice, 'lastReportTs'> {
    const lastReportTs = asRecord(device.meta).lastReportTs;
    return typeof lastReportTs === 'number' ? {lastReportTs} : {};
}

function numberAt(source: Record<string, unknown>, key: string) {
    const value = source[key];
    return typeof value === 'number' ? value : undefined;
}

function booleanAt(source: Record<string, unknown>, key: string) {
    const value = source[key];
    return typeof value === 'boolean' ? value : undefined;
}

/** A value the backend never emits is not a source. Casting one would put
 *  the old 'websocket' lie back, typed, where nothing could catch it. */
function deviceSourceOf(value: unknown): DeviceSource | undefined {
    return DEVICE_SOURCE_VALUES.includes(value as DeviceSource)
        ? (value as DeviceSource)
        : undefined;
}

/** The backend's capability object, or nothing. Typing a stray value as a
 *  contract is how a template ends up trusting a shape nobody sent. */
function supportsField(value: unknown): Pick<HostDevice, 'supports'> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? {supports: value as HostDevice['supports']}
        : {};
}

function stringAt(source: Record<string, unknown>, key: string) {
    const value = source[key];
    return typeof value === 'string' ? value : undefined;
}

/** Three device families report battery under three different keys. Fleet
 *  Manager reads all three; so does this, rather than covering one family. */
function batteryField(
    status: Record<string, unknown>
): Pick<HostDevice, 'battery'> {
    const power = asRecord(status.devicepower ?? status['devicepower:0']);
    const percent =
        numberAt(asRecord(power.battery), 'percent') ??
        numberAt(asRecord(status.bluetoothdevice), 'battery');
    const external = booleanAt(asRecord(power.external), 'present');
    if (percent === undefined && external === undefined) return {};
    return {
        battery: {
            ...optionalField('percent', percent),
            ...optionalField('external', external)
        }
    };
}

function signalField(
    status: Record<string, unknown>
): Pick<HostDevice, 'signal'> {
    const wifi = asRecord(status.wifi);
    const bluetooth = asRecord(status.bluetoothdevice);
    const transport = asRecord(bluetooth.transportHealth);
    const rssi =
        numberAt(wifi, 'rssi') ??
        numberAt(bluetooth, 'rssi') ??
        numberAt(transport, 'lastRssi');
    const ssid = stringAt(wifi, 'ssid');
    if (rssi === undefined && ssid === undefined) return {};
    return {
        signal: {...optionalField('rssi', rssi), ...optionalField('ssid', ssid)}
    };
}

/** Absent means never checked. Present with no channel means checked and up
 *  to date. Fleet Manager tracks stable and beta separately, so a bare
 *  boolean here would throw away the half a template needs to label it. */
function firmwareUpdateField(
    status: Record<string, unknown>
): Pick<HostDevice, 'firmwareUpdate'> {
    const updates = asRecord(status.sys).available_updates;
    if (updates === undefined || updates === null) return {};
    const available = asRecord(updates);
    return {
        firmwareUpdate: {
            ...optionalField(
                'stable',
                stringAt(asRecord(available.stable), 'version')
            ),
            ...optionalField(
                'beta',
                stringAt(asRecord(available.beta), 'version')
            )
        }
    };
}

export function mergeHostDeviceStatusPatch(
    current: Record<string, unknown>,
    patch: Record<string, unknown>
): Record<string, unknown> {
    const merged = {...current};
    for (const [key, value] of Object.entries(patch)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
            continue;
        const previous = merged[key];
        merged[key] =
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            previous &&
            typeof previous === 'object' &&
            !Array.isArray(previous)
                ? mergeHostDeviceStatusPatch(asRecord(previous), asRecord(value))
                : value;
    }
    return merged;
}

/** Applies one partial event and refreshes every status-derived Host field. */
export function patchHostDeviceStatus(
    device: HostDevice,
    patch: Record<string, unknown>
): HostDevice {
    const status = mergeHostDeviceStatusPatch(asRecord(device.status), patch);
    const raw = asRecord(device.raw);
    const source = {
        ...raw,
        status,
        settings: device.settings ?? raw.settings
    };
    const {
        battery: _battery,
        capabilities: _capabilities,
        controlCapabilities: _controlCapabilities,
        firmwareUpdate: _firmwareUpdate,
        signal: _signal,
        ...stable
    } = device;
    return {
        ...stable,
        capabilities: deriveDomainCapabilities(source),
        ...batteryField(status),
        ...signalField(status),
        ...firmwareUpdateField(status),
        controlCapabilities: controlCapabilities(source),
        status,
        ...(device.raw && typeof device.raw === 'object'
            ? {raw: {...raw, status}}
            : {})
    };
}

export function toHostDevice(rawDevice: unknown): HostDevice {
    const device = asRecord(rawDevice);
    const info = asRecord(device.info);
    const shellyID = stringField(device, 'shellyID');
    const status = asRecord(device.status);
    return {
        shellyID,
        id: requiredPositiveIntegerField(device, 'id'),
        groupId: firstGroupId(device),
        name: stringField(info, 'name') || stringField(device, 'name'),
        type: stringField(info, 'model') || stringField(info, 'app'),
        ...optionalField('model', stringAt(info, 'model')),
        // The runtime owns image logic and installs the rule; templates render
        // the descriptor as-is. Omitted entirely when no rule is installed.
        ...logoField(rawDevice),
        ...reportedPresenceFields(device),
        groupIds: numericArray(device.groupIds),
        locationId:
            typeof device.locationId === 'number' ? device.locationId : null,
        tagIds: numericArray(device.tagIds),
        ...optionalField(
            'kind',
            typeof device.kind === 'string' || device.kind === null
                ? device.kind
                : undefined
        ),
        capabilities: deriveDomainCapabilities(device),
        // The backend's own list, under its own name. `capabilities` above is
        // a different question and must not stand in for this one.
        ...supportsField(device.capabilities),
        ...batteryField(status),
        ...signalField(status),
        ...firmwareUpdateField(status),
        controlCapabilities: controlCapabilities(device),
        ...lastReportFields(device),
        // Passed through, not interpreted. `raw` already carried these, but a
        // named field is a contract and `raw` is not — the moment a template
        // reads raw.methods the backend can never change that shape.
        // stringField returns '' for a missing value, which is a fact nobody
        // sent. Only a real string is passed on.
        ...optionalField('source', deviceSourceOf(device.source)),
        ...optionalField('methods', stringArray(device.methods)),
        ...optionalField('entities', stringArray(device.entities)),
        ...optionalField(
            'lastSeenSleepingMs',
            typeof device.lastSeenSleepingMs === 'number'
                ? device.lastSeenSleepingMs
                : undefined
        ),
        ...optionalField('derivedProfile', device.derivedProfile),
        status,
        settings: asRecord(device.settings),
        raw: rawDevice
    };
}
