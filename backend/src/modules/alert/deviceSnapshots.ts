import {bthomeObjectInfos} from '../../config/BTHomeData';
import type AbstractDevice from '../../model/AbstractDevice';
import type {BluetoothDeviceDto} from '../../types/api/virtualdevice';
import * as DeviceCollector from '../DeviceCollector';
import * as PostgresProvider from '../PostgresProvider';
import {listBluetoothDevicesByExternalIds} from '../virtualDevice/bluetoothRepository';
import {
    bluetoothDeviceDisplayName,
    virtualDeviceToListJSON
} from '../virtualDevice/deviceListEntry';
import {
    bluetoothDeviceSnapshot,
    bluetoothPrimaryGatewaySnapshot
} from '../virtualDevice/deviceListIntegration';
import {
    buildVirtualDeviceReadModels,
    mergeReadModelIntoRow,
    type SourceSnapshot,
    type VirtualDeviceEntity
} from '../virtualDevice/readModel';
import {listVirtualDevices} from '../virtualDevice/repository';
import {BLUETOOTH_KIND} from './types';

export interface StoredDeviceSnapshotRow {
    id: number;
    external_id: string;
    jdoc: Record<string, unknown> | null;
    /** device.list.kind: physical | virtual | bluetooth | ... */
    kind?: string;
    projected_entities?: VirtualDeviceEntity[];
    /** A promoted BLU row: the gateway components its readings come from. */
    promoted_from?: {gatewayExternalId: string; componentKeys: string[]};
}

/**
 * Authoritative current-state snapshots used by initial evaluation and preview.
 * Custom-device rows are projected through the same read model as Device.List.
 */
export async function storedDeviceSnapshots(
    organizationId: string,
    externalIds?: readonly string[]
): Promise<StoredDeviceSnapshotRow[]> {
    const stored = await PostgresProvider.queryRows<StoredDeviceSnapshotRow>(
        `SELECT id, external_id, jdoc, kind
           FROM device.list
          WHERE organization_id = $1
            AND external_id IS NOT NULL
            AND deleted_at IS NULL
            AND ($2::varchar[] IS NULL OR external_id = ANY($2::varchar[]))`,
        [organizationId, externalIds ?? null]
    );
    const rows = await withBluetoothSnapshots(organizationId, stored);
    if (!rows.some((row) => row.external_id.startsWith('vdev_'))) return rows;
    const virtual = await listVirtualDevices(organizationId, {limit: 0});
    if (virtual.items.length === 0) return rows;
    const snapshots = new Map<string, SourceSnapshot>();
    for (const row of rows) {
        const jdoc = recordObject(row.jdoc);
        const status = recordObject(jdoc?.status);
        snapshots.set(row.external_id, {
            presence:
                jdoc?.presence === 'pending'
                    ? 'pending'
                    : jdoc?.presence === 'offline'
                      ? 'offline'
                      : status && Object.keys(status).length > 0
                        ? 'online'
                        : 'offline',
            status
        });
    }
    const models = await buildVirtualDeviceReadModels(
        {organizationId, devices: virtual.items},
        {
            queryRows: PostgresProvider.queryRows,
            getSourceSnapshot: (externalId) => snapshots.get(externalId) ?? null
        }
    );
    const virtualById = new Map(virtual.items.map((d) => [d.externalId, d]));
    return rows.map((row) => {
        const device = virtualById.get(row.external_id);
        const model = models.get(row.external_id);
        if (!device || !model) return row;
        const base = virtualDeviceToListJSON(device, new Set(['status']));
        const merged = mergeReadModelIntoRow(base, model);
        return {
            ...row,
            jdoc: merged as unknown as Record<string, unknown>,
            projected_entities: model.entityDetails
        };
    });
}

// A promoted BLU device has no connection of its own: its readings are the
// gateway's projection, judged the way the device list judges them. The row
// gets that projection as its snapshot so every evaluator sees the BLU device
// itself, and remembers which gateway components it took over.
async function withBluetoothSnapshots(
    organizationId: string,
    rows: StoredDeviceSnapshotRow[]
): Promise<StoredDeviceSnapshotRow[]> {
    const ids = rows
        .filter((row) => row.kind === BLUETOOTH_KIND)
        .map((row) => row.external_id);
    if (ids.length === 0) return rows;
    const devices = new Map(
        (await listBluetoothDevicesByExternalIds(organizationId, ids)).map(
            (device) => [device.externalId, device]
        )
    );
    return rows.map((row) => {
        const device = devices.get(row.external_id);
        if (!device) return row;
        const transport = device.primaryTransport;
        const gatewayExternalId =
            transport?.enabled && transport.mode === 'bthome_gateway'
                ? transport.shellyDeviceExternalId
                : null;
        // Disabled routes cannot supply alert readings or take ownership from a gateway.
        const snapshot = bluetoothDeviceSnapshot({
            device,
            gateway: gatewayExternalId
                ? bluetoothPrimaryGatewaySnapshot(DeviceCollector, device)
                : null
        });
        const componentKeys = device.components
            .filter((c) => c.role !== 'identity')
            .map((c) => c.componentKey);
        return {
            ...row,
            jdoc: bluetoothDeviceJdoc(device, snapshot),
            ...(gatewayExternalId
                ? {promoted_from: {gatewayExternalId, componentKeys}}
                : {})
        };
    });
}

/** What a promoted BLU device is, as far as alerts need to know. */
export type BluetoothAlertSource = Pick<
    BluetoothDeviceDto,
    | 'deviceListId'
    | 'externalId'
    | 'components'
    | 'modelId'
    | 'productName'
    | 'bleAddress'
>;

// Same view as the sweep and initial evaluation, so a live reading is judged alike.
export function bluetoothAlertDevice(
    source: BluetoothAlertSource,
    snapshot: SourceSnapshot
): AbstractDevice {
    return deviceSnapshotFromStoredRow({
        id: source.deviceListId,
        external_id: source.externalId,
        kind: BLUETOOTH_KIND,
        jdoc: bluetoothDeviceJdoc(source, snapshot)
    });
}

/** Gateway component keys each promoted BLU row took over, by gateway. */
export function promotedComponentsByGateway(
    rows: readonly StoredDeviceSnapshotRow[]
): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const row of rows) {
        if (!row.promoted_from) continue;
        const keys =
            out.get(row.promoted_from.gatewayExternalId) ?? new Set<string>();
        for (const key of row.promoted_from.componentKeys) keys.add(key);
        out.set(row.promoted_from.gatewayExternalId, keys);
    }
    return out;
}

function bluetoothDeviceJdoc(
    source: BluetoothAlertSource,
    snapshot: SourceSnapshot
): Record<string, unknown> {
    return {
        status: snapshot.status ?? {},
        presence: snapshot.presence,
        // The name the device list shows, so an alert never falls
        // back to the internal blu_ id the operator never sees.
        info: {name: bluetoothDeviceDisplayName(source)},
        profile: {
            flags: {isBattery: hasBatteryReading(snapshot.status)}
        },
        entities: bluetoothEntityDescriptors(source)
    };
}

// The entity view of a BLU device: one bthomesensor entity per reading, with
// the BTHome object name so object-aware rules can tell what it measures.
function bluetoothEntityDescriptors(
    device: BluetoothAlertSource
): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const component of device.components) {
        if (component.role === 'identity') continue;
        const [type, rawId] = component.componentKey.split(':');
        const id = Number(rawId);
        if (!type || !Number.isFinite(id)) continue;
        const info =
            component.objectId == null
                ? undefined
                : bthomeObjectInfos[component.objectId];
        out.push({
            id: `${device.externalId}_${component.componentKey}:${type}`,
            type,
            name: component.name ?? info?.name ?? component.componentKey,
            source: device.externalId,
            properties: {
                id,
                objName: info?.name,
                sensorType: info?.type,
                bleModelId: device.modelId ?? undefined,
                bleProductName: device.productName ?? undefined
            }
        });
    }
    return out;
}

function hasBatteryReading(status: Record<string, unknown> | null): boolean {
    const identity = status?.bluetoothdevice;
    return (
        !!identity &&
        typeof identity === 'object' &&
        'battery' in (identity as Record<string, unknown>)
    );
}

export function deviceSnapshotFromStoredRow(
    row: StoredDeviceSnapshotRow
): AbstractDevice {
    const jdoc = recordObject(row.jdoc) ?? {};
    return {
        ...jdoc,
        id: row.id,
        shellyID: row.external_id,
        kind: row.kind,
        status: recordObject(jdoc.status) ?? {},
        info: recordObject(jdoc.info) ?? {},
        entities:
            row.projected_entities ??
            (Array.isArray(jdoc.entities)
                ? jdoc.entities.filter(isEntityDescriptor)
                : []),
        profile: recordObject(jdoc.profile) ?? {flags: {isBattery: false}},
        presence: jdoc.presence === 'online' ? 'online' : 'offline',
        online: jdoc.presence === 'online'
    } as unknown as AbstractDevice;
}

function isEntityDescriptor(value: unknown): value is Record<string, unknown> {
    return recordObject(value) !== null;
}

function recordObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}
