// DeviceCollector ↔ read-model wiring, extracted so it stays unit-testable.

import {bthomeObjectInfos, isBluTransportStale} from '../../config/BTHomeData';
import type AbstractDevice from '../../model/AbstractDevice';
import type {ShellyDeviceExternal} from '../../types';
import type {
    BluetoothDeviceDto,
    VirtualDeviceDto
} from '../../types/api/virtualdevice';
import {
    applyExtractedSourceHealth,
    bluetoothDeviceToListJSON,
    extractedSourceHostExternalId,
    virtualDeviceToListJSON
} from './deviceListEntry';
import {
    mergeReadModelIntoRow,
    type SourceSnapshot,
    type VirtualDeviceReadModel
} from './readModel';

export interface DeviceCollectorLike {
    getDevice(externalId: string): AbstractDevice | undefined;
}

export type BluetoothSnapshotLookup = (
    externalId: string
) => BluetoothDeviceDto | null | undefined;

// Falls back to BLU lookup for `blu_*` sources so roles report transport
// presence instead of missing_source. null only when both lookups miss.
export function createDeviceCollectorSnapshotFetcher(
    collector: DeviceCollectorLike,
    bluetoothLookup?: BluetoothSnapshotLookup
): (externalId: string) => SourceSnapshot | null {
    return (externalId) => {
        const device = collector.getDevice(externalId);
        if (device) {
            const json = device.toJSON();
            return {
                presence: json.presence,
                status: (json.status as Record<string, unknown>) ?? null
            };
        }
        const blu = bluetoothLookup?.(externalId);
        if (blu) {
            const gateway = bluetoothPrimaryGatewaySnapshot(collector, blu);
            return bluetoothDeviceSnapshot({device: blu, gateway});
        }
        return null;
    };
}

export function bluetoothDeviceSnapshot(input: {
    device: BluetoothDeviceDto;
    gateway?: SourceSnapshot | null;
}): SourceSnapshot {
    const {gateway = null} = input;
    const device = enrichBluetoothDeviceWithGatewayStatus(
        input.device,
        gateway
    );
    const transport = device.primaryTransport ?? null;
    const gatewayOffline = gateway != null && gateway.presence !== 'online';
    const fresh =
        !gatewayOffline &&
        transport?.enabled &&
        !isBluTransportStale(transport.lastSeenAt, device.modelId);
    return {
        presence: fresh ? 'online' : 'offline',
        status: projectBluetoothComponentStatus({device, gateway})
    };
}

// Single builder for a promoted BLU device's list row: resolves its gateway
// once, freshens last-seen from gateway status, and makes presence ride it.
export function bluetoothEntryToListJSON(
    collector: DeviceCollectorLike,
    device: BluetoothDeviceDto,
    detailSet?: Set<string>
): ShellyDeviceExternal {
    const gateway = bluetoothPrimaryGatewaySnapshot(collector, device);
    return bluetoothDeviceToListJSON(
        enrichBluetoothDeviceWithGatewayStatus(device, gateway),
        detailSet,
        gateway?.presence ?? null,
        projectBluetoothComponentStatus({device, gateway})
    );
}

export function enrichBluetoothDeviceWithGatewayStatus(
    device: BluetoothDeviceDto,
    gateway?: SourceSnapshot | null
): BluetoothDeviceDto {
    const transport = device.primaryTransport ?? null;
    if (!transport || !gateway?.status) return device;
    const observed = latestBluetoothSourceObservation(device, gateway.status);
    if (!observed) return device;
    const transportSeen = millisFromTimestamp(transport.lastSeenAt);
    if (transportSeen !== null && transportSeen >= observed.seenAtMs) {
        return device;
    }
    return {
        ...device,
        primaryTransport: {
            ...transport,
            lastSeenAt: new Date(observed.seenAtMs).toISOString(),
            lastRssi: observed.rssi ?? transport.lastRssi
        }
    };
}

export function bluetoothPrimaryGatewaySnapshot(
    collector: DeviceCollectorLike,
    device: BluetoothDeviceDto
): SourceSnapshot | null {
    const externalId = device.primaryTransport?.shellyDeviceExternalId;
    if (!externalId) return null;
    const gateway = collector.getDevice(externalId);
    if (!gateway) return null;
    const json = gateway.toJSON();
    return {
        presence: json.presence,
        status: (json.status as Record<string, unknown>) ?? null
    };
}

export function projectBluetoothComponentStatus(input: {
    device: BluetoothDeviceDto;
    gateway: SourceSnapshot | null;
}): Record<string, unknown> {
    const source = input.gateway?.status;
    if (!source) return {};
    const out: Record<string, unknown> = {};
    for (const component of input.device.components) {
        if (component.role === 'identity') continue;
        const value = source[component.componentKey];
        if (value !== undefined) {
            out[component.componentKey] = withFriendlyBluetoothState(
                component.objectId,
                value
            );
        }
    }
    return out;
}

function withFriendlyBluetoothState(
    objectId: number | null,
    value: unknown
): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.value !== 'boolean') return value;
    const name =
        objectId != null
            ? bthomeObjectInfos[objectId]?.name?.toLowerCase()
            : undefined;
    if (name !== 'opening' && name !== 'door' && name !== 'window') {
        return value;
    }
    return {
        ...record,
        state: record.value ? 'open' : 'closed'
    };
}

function latestBluetoothSourceObservation(
    device: BluetoothDeviceDto,
    status: Record<string, unknown>
): {seenAtMs: number; rssi: number | null} | null {
    let latest: {seenAtMs: number; rssi: number | null} | null = null;
    for (const component of device.components) {
        const value = asRecord(status[component.componentKey]);
        if (!value) continue;
        const seenAtMs = statusSeenAtMs(value);
        if (seenAtMs === null) continue;
        if (!latest || seenAtMs > latest.seenAtMs) {
            latest = {seenAtMs, rssi: numberField(value, 'rssi')};
        }
    }
    return latest;
}

function statusSeenAtMs(status: Record<string, unknown>): number | null {
    return (
        millisFromTimestamp(status.last_updated_ts) ??
        millisFromTimestamp(status.last_update_ts) ??
        millisFromTimestamp(status.lastSeenAt) ??
        millisFromTimestamp(status.last_seen_at)
    );
}

function millisFromTimestamp(value: unknown): number | null {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return Number.isFinite(millis) ? millis : null;
}

function numberField(
    record: Record<string, unknown>,
    field: string
): number | null {
    const value = record[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

export interface SerializeVirtualDeviceEntryInput {
    device: VirtualDeviceDto;
    detailSet?: Set<string>;
    readModel?: VirtualDeviceReadModel;
    hostPresence: 'online' | 'offline' | 'pending' | null;
}

// hostPresence is passed in (not looked up) to keep this pure + testable.
export function serializeVirtualDeviceEntry(
    input: SerializeVirtualDeviceEntryInput
): ShellyDeviceExternal {
    const row = virtualDeviceToListJSON(input.device, input.detailSet);
    const enriched = input.readModel
        ? mergeReadModelIntoRow(row, input.readModel)
        : row;
    const hostExternalId = extractedSourceHostExternalId(input.device);
    if (!hostExternalId) return enriched;
    return applyExtractedSourceHealth(enriched, input.hostPresence);
}
