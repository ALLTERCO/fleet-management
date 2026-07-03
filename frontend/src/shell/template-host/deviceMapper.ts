import {deriveDomainCapabilities} from './deviceCapabilities';
import type {HostDevice} from './types';

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

export function toHostDevice(rawDevice: unknown): HostDevice {
    const device = asRecord(rawDevice);
    const info = asRecord(device.info);
    const shellyID = stringField(device, 'shellyID');
    const online = device.online === true;
    return {
        shellyID,
        id: shellyID,
        groupId: firstGroupId(device),
        name: stringField(info, 'name') || stringField(device, 'name'),
        type: stringField(info, 'model') || stringField(info, 'app'),
        online,
        presence: online ? 'online' : 'offline',
        groupIds: numericArray(device.groupIds),
        locationId:
            typeof device.locationId === 'number' ? device.locationId : null,
        tagIds: numericArray(device.tagIds),
        capabilities: deriveDomainCapabilities(device),
        status: asRecord(device.status),
        settings: asRecord(device.settings),
        raw: rawDevice
    };
}
