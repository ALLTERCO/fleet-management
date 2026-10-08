/** fleet.* — live metric + capability reads across group / location / tag / fleet. */

import {requireScopeRead} from '../../modules/authz/evaluator/scopeRead';
import * as DeviceCollector from '../../modules/DeviceCollector';
import {resolveScopeShellyIDs} from '../../modules/scopeResolver';
import {listBluetoothDevices} from '../../modules/virtualDevice/bluetoothRepository';
import {createDeviceCollectorSnapshotFetcher} from '../../modules/virtualDevice/deviceListIntegration';
import {
    buildVirtualDeviceReadModels,
    defaultReadModelDeps,
    type VirtualDeviceReadModel
} from '../../modules/virtualDevice/readModel';
import {listVirtualDevices} from '../../modules/virtualDevice/repository';
import {filterReadableVirtualDeviceIds} from '../../modules/virtualDevice/sourceAccessPolicy';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    type DashboardScope,
    FLEET_DESCRIBE,
    FLEET_METRICS_PARAMS,
    scopeId as readScopeId,
    scopeKind as readScopeKind
} from '../../types/api/fleet';
import type {
    BluetoothDeviceDto,
    VirtualDeviceDto
} from '../../types/api/virtualdevice';
import type CommandSender from '../CommandSender';
import Component from './Component';
import {
    computeFleetCapabilities,
    computeFleetMetrics,
    type FleetMetricDeviceSource,
    type ProjectedFleetDevice
} from './fleetLiveMetrics';

interface FleetMetricsParams {
    organizationId?: string;
    scope?: DashboardScope;
}

export default class FleetComponent extends Component {
    static get describe(): DescribeOutput {
        return FLEET_DESCRIBE;
    }

    constructor() {
        super('fleet', {viewer_visible: true});
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.Expose('GetMetrics')
    @Component.NoAudit
    @Component.CrudPermission('dashboards', 'read')
    async getMetrics(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<FleetMetricsParams>(
            params,
            FLEET_METRICS_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        await requireScopeRead(sender, p.scope, orgId, {
            resolve: resolveScopeShellyIDs,
            requireFullAccess: true
        });
        const devices = await this.#loadScopeDevices(orgId, p.scope, sender);
        return computeFleetMetrics(
            readScopeKind(p.scope),
            readScopeId(p.scope),
            devices
        );
    }

    @Component.Expose('GetCapabilities')
    @Component.NoAudit
    @Component.CrudPermission('dashboards', 'read')
    async getCapabilities(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<FleetMetricsParams>(
            params,
            FLEET_METRICS_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        await requireScopeRead(sender, p.scope, orgId, {
            resolve: resolveScopeShellyIDs,
            requireFullAccess: true
        });
        const devices = await this.#loadScopeDevices(orgId, p.scope, sender);
        return computeFleetCapabilities(
            readScopeKind(p.scope),
            readScopeId(p.scope),
            devices,
            devices.length
        );
    }

    async #loadScopeDevices(
        orgId: string,
        scope: DashboardScope | undefined,
        sender: CommandSender
    ) {
        try {
            const shellyIDs = await resolveScopeShellyIDs(
                orgId,
                readScopeKind(scope),
                readScopeId(scope)
            );
            const scopeIds = new Set(shellyIDs);
            const virtualPage = await listVirtualDevices(orgId, {limit: 0});
            const virtualCandidates = virtualPage.items.filter((device) =>
                scopeIds.has(device.externalId)
            );
            const readableVirtualIds = await filterReadableVirtualDeviceIds(
                orgId,
                sender,
                virtualCandidates.map((device) => device.externalId)
            );
            const virtualDevices = virtualCandidates.filter((device) =>
                readableVirtualIds.has(device.externalId)
            );
            const bluetooth =
                virtualDevices.length === 0
                    ? new Map<string, BluetoothDeviceDto>()
                    : await loadBluetoothByExternalId(orgId);
            const readModels = await buildVirtualDeviceReadModels(
                {organizationId: orgId, devices: virtualDevices},
                {
                    ...defaultReadModelDeps,
                    getSourceSnapshot: createDeviceCollectorSnapshotFetcher(
                        DeviceCollector,
                        (externalId) => bluetooth.get(externalId)
                    )
                }
            );
            return composeFleetScopeDevices(
                shellyIDs,
                (externalId) => DeviceCollector.getDevice(externalId),
                virtualDevices,
                readModels
            );
        } catch (err) {
            throw RpcError.Domain('ValidationFailed', {
                message: `Failed to resolve scope: ${(err as Error).message}`
            });
        }
    }
}

export function composeFleetScopeDevices(
    scopeExternalIds: readonly string[],
    getPhysicalDevice: (
        externalId: string
    ) => FleetMetricDeviceSource | undefined,
    virtualDevices: readonly VirtualDeviceDto[],
    readModels: ReadonlyMap<string, VirtualDeviceReadModel>
): FleetMetricDeviceSource[] {
    const boundPhysicalSources = new Set(
        [...readModels.values()].flatMap((model) =>
            Object.values(model.statusRoles).map(
                (role) => role.source.deviceExternalId
            )
        )
    );
    const physical = scopeExternalIds
        .filter((externalId) => !boundPhysicalSources.has(externalId))
        .map((externalId) => getPhysicalDevice(externalId))
        .filter((device): device is FleetMetricDeviceSource => Boolean(device));
    const projected = virtualDevices.map((device) =>
        projectVirtualFleetDevice(
            device.deviceListId,
            device.externalId,
            device.name,
            readModels.get(device.externalId)
        )
    );
    return [...physical, ...projected];
}

async function loadBluetoothByExternalId(
    organizationId: string
): Promise<Map<string, BluetoothDeviceDto>> {
    const page = await listBluetoothDevices(organizationId, {limit: 0});
    return new Map(page.items.map((device) => [device.externalId, device]));
}

export function projectVirtualFleetDevice(
    deviceListId: number,
    externalId: string,
    name: string,
    model: VirtualDeviceReadModel | undefined
): ProjectedFleetDevice {
    return {
        id: deviceListId,
        shellyID: externalId,
        info: {name},
        online: model?.presence === 'online',
        status: {},
        virtualMetricRoles: model?.metricRoles ?? [],
        entities: (model?.entityDetails ?? []).map((entity) => ({
            type: entity.type
        }))
    };
}
