import * as DeviceCollector from '../../modules/DeviceCollector';
import {resolveScopeShellyIDs} from '../../modules/scopeResolver';
import {listBluetoothDevices} from '../../modules/virtualDevice/bluetoothRepository';
import {createDeviceCollectorSnapshotFetcher} from '../../modules/virtualDevice/deviceListIntegration';
import {
    buildVirtualDeviceReadModels,
    defaultReadModelDeps
} from '../../modules/virtualDevice/readModel';
import {listVirtualDevices} from '../../modules/virtualDevice/repository';
import type {
    ParkingOccupancySource,
    ParkingSafetySource
} from '../../types/api/operations';
import type {ParkingSourceSnapshot} from './parkingOccupancyVerdict';

type ParkingPolicySource = ParkingOccupancySource | ParkingSafetySource;

interface ParkingRoleReading {
    value: unknown;
    sourceDeviceId: string;
    reportedAt: number | null;
}

export interface ParkingRoleSourceDeps {
    resolveLocationDeviceIds(
        organizationId: string,
        locationId: number
    ): Promise<readonly string[]>;
    loadRoleReadings(
        organizationId: string,
        customDeviceIds: readonly string[]
    ): Promise<ReadonlyMap<string, ReadonlyMap<string, ParkingRoleReading>>>;
}

export interface ParkingRoleSourceResolution {
    snapshots: ParkingSourceSnapshot[];
    resolvedSourceIds: ReadonlySet<string>;
}

const defaultDeps: ParkingRoleSourceDeps = {
    resolveLocationDeviceIds: (organizationId, locationId) =>
        resolveScopeShellyIDs(organizationId, 'location', locationId),
    loadRoleReadings
};

export async function resolveParkingRoleSources(
    organizationId: string,
    locationId: number,
    sources: readonly ParkingPolicySource[],
    deps: ParkingRoleSourceDeps = defaultDeps
): Promise<ParkingRoleSourceResolution> {
    if (sources.length === 0) {
        return {snapshots: [], resolvedSourceIds: new Set()};
    }
    const locationDeviceIds = await deps.resolveLocationDeviceIds(
        organizationId,
        locationId
    );
    const locationDevices = new Set(locationDeviceIds);
    const customDeviceIds = [
        ...new Set(
            sources
                .map((source) => source.customDeviceId)
                .filter((deviceId) => locationDevices.has(deviceId))
        )
    ];
    if (customDeviceIds.length === 0) {
        return {snapshots: [], resolvedSourceIds: new Set()};
    }
    const readings = await deps.loadRoleReadings(
        organizationId,
        customDeviceIds
    );
    const snapshots: ParkingSourceSnapshot[] = [];
    const resolvedSourceIds = new Set<string>();

    for (const source of sources) {
        if (!locationDevices.has(source.customDeviceId)) continue;
        const reading = readings
            .get(source.customDeviceId)
            ?.get(source.roleKey);
        if (!reading || !locationDevices.has(reading.sourceDeviceId)) continue;
        resolvedSourceIds.add(source.id);
        snapshots.push({
            source: {
                customDeviceId: source.customDeviceId,
                roleKey: source.roleKey
            },
            value: reading.value,
            reportedAt: reading.reportedAt
        });
    }
    return {snapshots, resolvedSourceIds};
}

async function loadRoleReadings(
    organizationId: string,
    customDeviceIds: readonly string[]
): Promise<ReadonlyMap<string, ReadonlyMap<string, ParkingRoleReading>>> {
    const requested = new Set(customDeviceIds);
    const virtualPage = await listVirtualDevices(organizationId, {limit: 0});
    const devices = virtualPage.items.filter((device) =>
        requested.has(device.externalId)
    );
    if (devices.length === 0) return new Map();

    const bluetoothPage = await listBluetoothDevices(organizationId, {
        limit: 0
    });
    const bluetooth = new Map(
        bluetoothPage.items.map((device) => [device.externalId, device])
    );
    const models = await buildVirtualDeviceReadModels(
        {organizationId, devices},
        {
            ...defaultReadModelDeps,
            getSourceSnapshot: createDeviceCollectorSnapshotFetcher(
                DeviceCollector,
                (externalId) => bluetooth.get(externalId)
            )
        }
    );
    const readings = new Map<string, Map<string, ParkingRoleReading>>();
    for (const device of devices) {
        const model = models.get(device.externalId);
        if (!model) continue;
        const roles = new Map<string, ParkingRoleReading>();
        for (const metric of model.metricRoles ?? []) {
            const source = model.statusRoles[metric.roleKey]?.source;
            if (!source) continue;
            roles.set(metric.roleKey, {
                value: metric.value,
                sourceDeviceId: source.deviceExternalId,
                reportedAt: sourceObservedAt(source.deviceExternalId, bluetooth)
            });
        }
        readings.set(device.externalId, roles);
    }
    return readings;
}

function sourceObservedAt(
    sourceDeviceId: string,
    bluetooth: ReadonlyMap<
        string,
        {primaryTransport?: {lastSeenAt?: string | null} | null}
    >
): number | null {
    const physical = DeviceCollector.getDevice(sourceDeviceId);
    if (physical && Number.isFinite(physical.lastReportTs)) {
        return physical.lastReportTs;
    }
    const value = bluetooth.get(sourceDeviceId)?.primaryTransport?.lastSeenAt;
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}
