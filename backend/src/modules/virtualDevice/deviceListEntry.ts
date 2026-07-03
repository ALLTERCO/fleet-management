import {bthomeObjectInfos, isBluTransportStale} from '../../config/BTHomeData';
import type {ShellyDeviceExternal} from '../../types';
import type {
    BluetoothDeviceDto,
    VirtualDeviceDto
} from '../../types/api/virtualdevice';

export function virtualDeviceToListJSON(
    device: VirtualDeviceDto,
    details?: Set<string>
): ShellyDeviceExternal {
    return {
        shellyID: device.externalId,
        id: device.deviceListId,
        source: 'virtual',
        info: {
            id: device.deviceListId,
            name: device.name,
            app: 'Virtual Device',
            model: device.typeKey,
            kind: device.kind,
            typeKey: device.typeKey,
            categoryKey: device.categoryKey,
            imageAssetId: device.imageAssetId
        },
        groupIds: device.groupIds,
        locationId: device.locationId,
        tagIds: device.tagIds,
        status: virtualDeviceStatus(device, details),
        presence: device.enabled ? 'online' : 'offline',
        settings: virtualDeviceSettings(device, details),
        entities: [],
        capabilities: {},
        methods: [],
        meta: {
            virtualDevice: {
                kind: device.kind,
                typeKey: device.typeKey,
                categoryKey: device.categoryKey,
                profileId: device.profileId,
                visual: device.visual,
                revision: device.revision
            }
        }
    };
}

export function virtualDeviceToFullJSON(
    device: VirtualDeviceDto
): ShellyDeviceExternal {
    return virtualDeviceToListJSON(device, fullDeviceDetailSet());
}

export function bluetoothDeviceToListJSON(
    device: BluetoothDeviceDto,
    details?: Set<string>,
    gatewayPresence?: string | null,
    projectedStatus: Record<string, unknown> = {}
): ShellyDeviceExternal {
    const health = bluetoothTransportHealth(device, gatewayPresence);
    const displayName = bluetoothDeviceDisplayName(device);
    return {
        shellyID: device.externalId,
        id: device.deviceListId,
        source: 'bluetooth',
        info: {
            id: device.deviceListId,
            name: displayName,
            app: 'Bluetooth Device',
            model: device.modelId ?? device.capability,
            kind: 'bluetooth',
            stableId: device.stableId,
            bleAddress: device.bleAddress,
            capability: device.capability,
            imageAssetId: device.imageAssetId
        },
        groupIds: [],
        locationId: null,
        tagIds: [],
        status: bluetoothDeviceStatus(device, details, health, projectedStatus),
        presence: health.status === 'online' ? 'online' : 'offline',
        settings: bluetoothDeviceSettings(device, details),
        entities: bluetoothDeviceEntityIds(device, health),
        capabilities: {},
        methods: [],
        meta: {
            bluetoothDevice: {
                stableId: device.stableId,
                bleAddress: device.bleAddress,
                capability: device.capability,
                keyRefSet: device.keyRefSet,
                components: device.components,
                visual: device.visual
            }
        }
    };
}

export function bluetoothDeviceToFullJSON(
    device: BluetoothDeviceDto,
    gatewayPresence?: string | null,
    projectedStatus: Record<string, unknown> = {}
): ShellyDeviceExternal {
    return bluetoothDeviceToListJSON(
        device,
        fullDeviceDetailSet(),
        gatewayPresence,
        projectedStatus
    );
}

export function virtualDeviceMatchesFilter(
    device: VirtualDeviceDto,
    key: string,
    value: string | number | boolean
): boolean {
    switch (key) {
        case 'shellyID':
            return device.externalId === value;
        case 'id':
            return device.deviceListId === value;
        case 'source':
            return value === 'virtual';
        case 'presence':
            return (device.enabled ? 'online' : 'offline') === value;
        default:
            return false;
    }
}

export function extractedSourceHostExternalId(
    device: VirtualDeviceDto
): string | null {
    if (device.kind !== 'extracted') return null;
    const extraction = recordValue(device.metadata.extraction);
    const hostExternalId = extraction?.sourceHostExternalId;
    return typeof hostExternalId === 'string' && hostExternalId
        ? hostExternalId
        : null;
}

export function applyExtractedSourceHealth(
    row: ShellyDeviceExternal,
    sourcePresence: string | null
): ShellyDeviceExternal {
    const health = sourcePresence === 'online' ? 'online' : 'degraded';
    return {
        ...row,
        presence: health === 'online' ? row.presence : 'offline',
        status: {
            ...row.status,
            virtualdevice: {
                ...(recordValue(row.status.virtualdevice) ?? {}),
                sourceHealth: health,
                sourcePresence
            }
        }
    };
}

export function bluetoothDeviceMatchesFilter(
    device: BluetoothDeviceDto,
    key: string,
    value: string | number | boolean
): boolean {
    switch (key) {
        case 'shellyID':
            return device.externalId === value;
        case 'id':
            return device.deviceListId === value;
        case 'source':
            return value === 'bluetooth';
        default:
            return false;
    }
}

function virtualDeviceStatus(
    device: VirtualDeviceDto,
    details?: Set<string>
): Record<string, unknown> {
    const status = {
        sys: {available_updates: []},
        virtualdevice: {
            enabled: device.enabled,
            revision: device.revision,
            kind: device.kind,
            typeKey: device.typeKey
        }
    };
    if (details?.has('status')) return status;
    return {
        sys: status.sys,
        virtualdevice: status.virtualdevice
    };
}

function virtualDeviceSettings(
    device: VirtualDeviceDto,
    details?: Set<string>
): Record<string, unknown> {
    const settings = {
        virtualdevice: {
            name: device.name,
            kind: device.kind,
            typeKey: device.typeKey,
            categoryKey: device.categoryKey,
            profileId: device.profileId,
            visual: device.visual,
            metadata: device.metadata
        }
    };
    if (details?.has('settings')) return settings;
    return {
        virtualdevice: {
            name: device.name,
            kind: device.kind,
            typeKey: device.typeKey,
            categoryKey: device.categoryKey,
            visual: device.visual
        }
    };
}

function fullDeviceDetailSet(): Set<string> {
    return new Set(['settings', 'status']);
}

function bluetoothDeviceStatus(
    device: BluetoothDeviceDto,
    details: Set<string> | undefined,
    health: BluetoothTransportHealth,
    projectedStatus: Record<string, unknown>
): Record<string, unknown> {
    const status = {
        sys: {available_updates: []},
        bluetoothdevice: {
            stableId: device.stableId,
            bleAddress: device.bleAddress,
            capability: device.capability,
            keyRefSet: device.keyRefSet,
            componentCount: device.components.length,
            transportHealth: health
        }
    };
    if (details?.has('status')) return {...status, ...projectedStatus};
    return {
        sys: status.sys,
        bluetoothdevice: status.bluetoothdevice,
        ...projectedStatus
    };
}

interface BluetoothTransportHealth {
    status: 'online' | 'degraded' | 'offline';
    primaryTransportId: string | null;
    primaryMode: string | null;
    lastSeenAt: string | null;
    lastRssi: number | null;
    reasons: string[];
}

function bluetoothTransportHealth(
    device: BluetoothDeviceDto,
    gatewayPresence?: string | null
): BluetoothTransportHealth {
    const transport = device.primaryTransport ?? null;
    const reasons: string[] = [];
    if (!transport) {
        return {
            status: 'degraded',
            primaryTransportId: null,
            primaryMode: null,
            lastSeenAt: null,
            lastRssi: null,
            reasons: ['no primary transport']
        };
    }
    // A BLU child rides its gateway: no gateway, no device.
    if (gatewayPresence != null && gatewayPresence !== 'online') {
        return {
            status: 'offline',
            primaryTransportId: transport.id,
            primaryMode: transport.mode,
            lastSeenAt: transport.lastSeenAt,
            lastRssi: transport.lastRssi,
            reasons: ['gateway offline']
        };
    }
    if (!transport.enabled) reasons.push('primary transport disabled');
    if (device.capability === 'controllable' && !device.keyRefSet) {
        reasons.push('encryption key required but missing');
    }
    const stale = isBluTransportStale(transport.lastSeenAt, device.modelId);
    if (stale) reasons.push('primary transport not seen recently');
    const offline = stale || !transport.enabled;
    const status = offline
        ? 'offline'
        : reasons.length > 0
          ? 'degraded'
          : 'online';
    return {
        status,
        primaryTransportId: transport.id,
        primaryMode: transport.mode,
        lastSeenAt: transport.lastSeenAt,
        lastRssi: transport.lastRssi,
        reasons
    };
}

function bluetoothDeviceEntityIds(
    device: BluetoothDeviceDto,
    health: BluetoothTransportHealth
): string[] {
    const transportCanWrite = device.primaryTransport?.canWrite === true;
    return device.components
        .filter((c) => c.role !== 'identity')
        .filter((c) =>
            c.role === 'writable_control'
                ? c.canWrite && transportCanWrite && health.status === 'online'
                : true
        )
        .map((c) => {
            const componentType = c.componentKey.split(':')[0] ?? 'component';
            return `${device.externalId}_${c.componentKey}:${componentType}`;
        });
}

// Inverse of the id built above: blu_<mac>_<componentKey>:<type>. Kept next to
// the producer so both stay in sync. null = not a promoted-BLU entity id.
const BLU_ENTITY_ID_RE =
    /^(blu_[0-9a-f]+)_((bthomedevice|bthomesensor|bthomecontrol|blutrv):\d+):([a-z]+)$/;

export function parseBluetoothEntityId(
    id: string
): {externalId: string; componentKey: string; type: string} | null {
    const m = BLU_ENTITY_ID_RE.exec(id);
    if (!m) return null;
    return {externalId: m[1], componentKey: m[2], type: m[4]};
}

// Compose an Entity.Get response for one of a promoted BLU device's own
// components. null when the id doesn't belong to this device or names the
// identity component (which is device metadata, not an entity).
export function bluetoothEntityGetResponse(
    entityId: string,
    device: BluetoothDeviceDto,
    online: boolean
): {
    id: string;
    name: string;
    type: string;
    source: string;
    online: boolean;
    properties: Record<string, unknown>;
} | null {
    const parsed = parseBluetoothEntityId(entityId);
    if (!parsed) return null;
    const component = device.components.find(
        (c) => c.componentKey === parsed.componentKey
    );
    if (!component || component.role === 'identity') return null;
    const numericId = Number(parsed.componentKey.split(':')[1]);
    const properties: Record<string, unknown> = {
        id: Number.isFinite(numericId) ? numericId : parsed.componentKey,
        addr: device.bleAddress
    };
    let objName = '';
    if (parsed.type === 'bthomesensor' && component.objectId != null) {
        const info = bthomeObjectInfos[component.objectId] ?? {};
        objName = info.name ?? '';
        properties.unit = info.unit ?? '';
        properties.sensorType = info.type ?? '';
        properties.objName = objName;
    }
    return {
        id: entityId,
        name:
            component.name ??
            bluComponentDisplayName(objName, parsed, numericId),
        type: parsed.type,
        source: parsed.externalId,
        online,
        properties
    };
}

// Status for one promoted-BLU component, pulled from the gateway-projected
// status the snapshot builds. {} when the id isn't this device's or has no value.
export function bluetoothEntityStatusFrom(
    entityId: string,
    projectedStatus: Record<string, unknown>
): Record<string, unknown> {
    const parsed = parseBluetoothEntityId(entityId);
    if (!parsed) return {};
    const value = projectedStatus[parsed.componentKey];
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

// Fall back to the sensor's object name (Battery, Window, …) when the component
// carries no user name, so the entity reads sensibly instead of "bthomesensor 204".
function bluComponentDisplayName(
    objName: string,
    parsed: {type: string},
    numericId: number
): string {
    if (objName) {
        return (
            objName.charAt(0).toUpperCase() +
            objName.slice(1).replace(/_/g, ' ')
        );
    }
    return `${parsed.type} ${numericId}`;
}

function bluetoothDeviceSettings(
    device: BluetoothDeviceDto,
    details?: Set<string>
): Record<string, unknown> {
    const displayName = bluetoothDeviceDisplayName(device);
    const settings = {
        bluetoothdevice: {
            name: displayName,
            stableId: device.stableId,
            bleAddress: device.bleAddress,
            productName: device.productName,
            modelId: device.modelId,
            capability: device.capability,
            components: device.components
        }
    };
    if (details?.has('settings')) return settings;
    return {
        bluetoothdevice: {
            name: displayName,
            stableId: device.stableId,
            bleAddress: device.bleAddress,
            capability: device.capability,
            keyRefSet: device.keyRefSet
        }
    };
}

function bluetoothDeviceDisplayName(device: BluetoothDeviceDto): string {
    const identityName = device.components
        .find((component) => component.role === 'identity')
        ?.name?.trim();
    return (
        identityName ||
        device.productName ||
        device.bleAddress ||
        device.externalId
    );
}

function recordValue(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}
