/** fleet.* — live metric + capability reads across group / location / tag / fleet. */

import {requireScopeRead} from '../../modules/authz/evaluator/scopeRead';
import * as DeviceCollector from '../../modules/DeviceCollector';
import {resolveScopeShellyIDs} from '../../modules/scopeResolver';
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
import type CommandSender from '../CommandSender';
import Component from './Component';
import {
    computeFleetCapabilities,
    computeFleetMetrics
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
        const devices = await this.#loadScopeDevices(orgId, p.scope);
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
        const devices = await this.#loadScopeDevices(orgId, p.scope);
        return computeFleetCapabilities(
            readScopeKind(p.scope),
            readScopeId(p.scope),
            devices,
            devices.length
        );
    }

    async #loadScopeDevices(orgId: string, scope: DashboardScope | undefined) {
        try {
            const shellyIDs = await resolveScopeShellyIDs(
                orgId,
                readScopeKind(scope),
                readScopeId(scope)
            );
            return shellyIDs
                .map((s) => DeviceCollector.getDevice(s))
                .filter((d): d is NonNullable<typeof d> => d != null);
        } catch (err) {
            throw RpcError.Domain('ValidationFailed', {
                message: `Failed to resolve scope: ${(err as Error).message}`
            });
        }
    }
}
