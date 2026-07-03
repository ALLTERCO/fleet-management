import type {ShellyDeviceExternal} from '../../types';
import type {
    BluetoothDeviceDto,
    VirtualDeviceDto,
    VirtualDeviceKind
} from '../../types/api/virtualdevice';
import * as DeviceCollector from '../DeviceCollector';
import {listDeviceKinds} from '../device/deviceKindRepository';
import {getBluetoothDevice} from '../virtualDevice/bluetoothRepository';
import {getVirtualDevice} from '../virtualDevice/repository';
import {bluetoothLabel} from './bluetoothFacts';
import {
    bluetoothDeviceRelatesToCenter,
    loadBluetoothDevices,
    loadVirtualBindingRows,
    loadVirtualDevices,
    needsVirtualRelationships,
    presenceStatus,
    queryBluetoothTransportRelationshipRows,
    relatedConnectorExternalIds
} from './deviceLoadingCore';
import {
    loadIncludedRelatedConnectorDevices as loadIncludedRelatedConnectorDeviceFacts,
    loadStoredConnectorCenterDevice as loadStoredConnectorCenterDeviceFact
} from './relationshipConnectorRepository';
import {
    deviceLabel,
    filterAccessibleExternalIds,
    requireOrganization
} from './relationshipShared';
import type {
    OrganizationRelationshipLoadInput,
    RelationshipLoadInput
} from './relationshipTypes';
import type {RelationshipDeviceFact} from './types';

export async function loadCenterDevice(
    input: RelationshipLoadInput
): Promise<RelationshipDeviceFact | null> {
    const liveDevice = DeviceCollector.getDevice(input.centerExternalId);
    if (liveDevice) return liveDeviceToFact(liveDevice.toJSON());
    if (!input.organizationId) return null;
    return await loadStoredCenterDevice(requireOrganization(input));
}

async function loadStoredCenterDevice(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipDeviceFact | null> {
    const virtualDevice = await getVirtualDevice(
        input.organizationId,
        input.centerExternalId
    );
    if (virtualDevice) return virtualDeviceToFact(virtualDevice);
    const bluetoothDevice = await getBluetoothDevice(
        input.organizationId,
        input.centerExternalId
    );
    if (bluetoothDevice) return bluetoothDeviceToFact(bluetoothDevice);
    return await loadStoredConnectorCenterDeviceFact({
        organizationId: input.organizationId,
        centerExternalId: input.centerExternalId
    });
}

export async function loadRelatedDevices(
    input: RelationshipLoadInput
): Promise<RelationshipDeviceFact[]> {
    if (!input.organizationId) return [];
    const [
        virtualDevices,
        bluetoothDevices,
        bluetoothGateways,
        connectorDevices
    ] = await Promise.all([
        loadIncludedRelatedVirtualDevices(input),
        loadIncludedRelatedBluetoothDevices(input),
        loadIncludedRelatedBluetoothGatewayDevices(input),
        loadIncludedRelatedConnectorDevices(input)
    ]);
    return [
        ...virtualDevices,
        ...bluetoothDevices,
        ...bluetoothGateways,
        ...connectorDevices
    ];
}

async function loadIncludedRelatedVirtualDevices(
    input: RelationshipLoadInput
): Promise<RelationshipDeviceFact[]> {
    if (!needsVirtualRelationships(input.includes)) return [];
    return await loadVirtualDevicesRelatedToCenter(requireOrganization(input));
}

async function loadVirtualDevicesRelatedToCenter(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipDeviceFact[]> {
    const rows = await loadVirtualBindingRows(input);
    const externalIds = new Set<string>();
    for (const row of rows) {
        externalIds.add(row.virtual_external_id);
        externalIds.add(row.source_external_id);
    }
    externalIds.delete(input.centerExternalId);
    const visibleIds = await filterAccessibleExternalIds(input, externalIds);
    const devices = await loadVirtualDevices(input);
    return devices
        .filter((device) => visibleIds.has(device.externalId))
        .map(virtualDeviceToFact);
}

async function loadIncludedRelatedConnectorDevices(
    input: RelationshipLoadInput
): Promise<RelationshipDeviceFact[]> {
    return await loadIncludedRelatedConnectorDeviceFacts({
        relationship: input,
        relatedExternalIds: () =>
            relatedConnectorExternalIds(requireOrganization(input))
    });
}

async function loadIncludedRelatedBluetoothDevices(
    input: RelationshipLoadInput
): Promise<RelationshipDeviceFact[]> {
    if (!input.includes.has('bluetooth')) return [];
    return await loadBluetoothDevicesRelatedToCenter(
        requireOrganization(input)
    );
}

async function loadBluetoothDevicesRelatedToCenter(
    input: OrganizationRelationshipLoadInput
): Promise<RelationshipDeviceFact[]> {
    const devices = await loadBluetoothDevices(input);
    const relatedDevices = devices.filter((device) =>
        bluetoothDeviceRelatesToCenter({input, device})
    );
    const visibleIds = await filterAccessibleExternalIds(
        input,
        relatedDevices.map((device) => device.externalId)
    );
    return relatedDevices
        .filter((device) => visibleIds.has(device.externalId))
        .map(bluetoothDeviceToFact);
}

async function loadIncludedRelatedBluetoothGatewayDevices(
    input: RelationshipLoadInput
): Promise<RelationshipDeviceFact[]> {
    if (!input.includes.has('bluetooth') || !input.organizationId) return [];
    const scopedInput = requireOrganization(input);
    const gatewayIds = await relatedBluetoothGatewayExternalIds(scopedInput);
    const visibleIds = await filterAccessibleExternalIds(
        scopedInput,
        gatewayIds
    );
    return [...visibleIds]
        .map((externalId) => DeviceCollector.getDevice(externalId)?.toJSON())
        .filter((device): device is ShellyDeviceExternal => !!device)
        .map(liveDeviceToFact);
}

async function relatedBluetoothGatewayExternalIds(
    input: OrganizationRelationshipLoadInput
): Promise<Set<string>> {
    const devices = await loadBluetoothDevices(input);
    const relatedDevices = devices.filter((device) =>
        bluetoothDeviceRelatesToCenter({input, device})
    );
    const rows = await queryBluetoothTransportRelationshipRows({
        organizationId: input.organizationId,
        externalIds: relatedDevices.map((device) => device.externalId)
    });
    return new Set(
        rows
            .map((row) => row.shelly_device_external_id)
            .filter((id): id is string => typeof id === 'string')
            .filter((id) => id !== input.centerExternalId)
    );
}

function liveDeviceToFact(row: ShellyDeviceExternal): RelationshipDeviceFact {
    return {
        externalId: row.shellyID,
        label: deviceLabel(row),
        nodeType: 'device.physical',
        status: presenceStatus(row.presence),
        meta: {source: row.source ?? null}
    };
}

export async function loadDeviceKindMetadata(
    input: RelationshipLoadInput,
    devices: readonly RelationshipDeviceFact[]
): Promise<RelationshipDeviceFact[]> {
    if (!input.organizationId) return [...devices];
    const deviceKinds = await listDeviceKinds(
        physicalDeviceExternalIds(devices),
        input.organizationId
    );
    if (deviceKinds.size === 0) return [...devices];
    return devices.map((device) =>
        deviceFactWithDeviceKind({device, deviceKinds})
    );
}

function physicalDeviceExternalIds(
    devices: readonly RelationshipDeviceFact[]
): string[] {
    return devices
        .filter((device) => device.nodeType === 'device.physical')
        .map((device) => device.externalId);
}

function deviceFactWithDeviceKind(input: {
    device: RelationshipDeviceFact;
    deviceKinds: ReadonlyMap<string, string>;
}): RelationshipDeviceFact {
    const deviceKind = input.deviceKinds.get(input.device.externalId);
    if (!deviceKind) return input.device;
    return {
        ...input.device,
        kind: deviceKind
    };
}

function virtualDeviceToFact(device: VirtualDeviceDto): RelationshipDeviceFact {
    return {
        externalId: device.externalId,
        label: device.name,
        nodeType: virtualNodeType(device.kind),
        status: device.enabled ? 'healthy' : 'disabled',
        kind: device.kind,
        imageAssetId: device.imageAssetId,
        meta: {
            typeKey: device.typeKey,
            categoryKey: device.categoryKey,
            revision: device.revision
        }
    };
}

function bluetoothDeviceToFact(
    device: BluetoothDeviceDto
): RelationshipDeviceFact {
    return {
        externalId: device.externalId,
        label: bluetoothLabel(device),
        nodeType: 'device.bluetooth',
        status: bluetoothStatus(device),
        kind: 'bluetooth',
        imageAssetId: device.imageAssetId ?? null,
        meta: {
            capability: device.capability,
            modelId: device.modelId,
            keyRefSet: device.keyRefSet
        }
    };
}

function virtualNodeType(
    kind: VirtualDeviceKind
): RelationshipDeviceFact['nodeType'] {
    const nodeTypes = {
        composed: 'device.virtual',
        extracted: 'device.extracted',
        connector: 'device.connector'
    } as const;
    return nodeTypes[kind];
}

function bluetoothStatus(
    device: BluetoothDeviceDto
): RelationshipDeviceFact['status'] {
    if (!device.primaryTransport) return 'warning';
    if (!device.primaryTransport.enabled) return 'disabled';
    return device.primaryTransport.shellyDeviceExternalId ? 'healthy' : 'stale';
}
