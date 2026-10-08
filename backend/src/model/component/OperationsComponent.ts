import {requireTenantWideComponentPermission} from '../../modules/authz/evaluator';
import {readableResourceAllowlistsAsync} from '../../modules/authz/evaluator/readableResourceAllowlists';
import * as DeviceCollector from '../../modules/DeviceCollector';
import {
    listOperationCounterCatalog,
    queryDeviceEvents
} from '../../modules/deviceEvents/queryDeviceEvents';
import * as EventDistributor from '../../modules/EventDistributor';
import type {EnergyDomain, EnergyTag} from '../../modules/energyClassifier';
import {getOrganizationProfile} from '../../modules/organizationModel';
import * as postgres from '../../modules/PostgresProvider';
import {defaultEnergyRepository} from '../../modules/repositories/EnergyRepository';
import {
    defaultItaliaPoolRegisterRepository,
    type ItaliaPoolRegisterRow
} from '../../modules/repositories/ItaliaPoolRegisterRepository';
import {listLogicalMeters} from '../../modules/repositories/LogicalMeterRepository';
import {
    defaultSensorRepository,
    type SensorNumericRow
} from '../../modules/repositories/SensorRepository';
import {
    resolveLocationShellyIDs,
    resolveScopeShellyIDs
} from '../../modules/scopeResolver';
import {loadActiveVirtualDeviceBindings} from '../../modules/virtualDevice/bindingReadRepository';
import {listVirtualDevices} from '../../modules/virtualDevice/repository';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {EnergyLogicalMeter} from '../../types/api/energy';
import {
    type ColdChainRecordPolicy,
    type ColdChainRecordVerdict,
    type IrrigationPolicy,
    type IrrigationSkipSource,
    type IrrigationVerdict,
    type ItaliaBreakerTripPolicy,
    type ItaliaHotWaterPolicy,
    type ItaliaPoolChemistryPolicy,
    type ItaliaPoolRegisterEntryId,
    type ItaliaPoolRegisterStoredEntry,
    type ItaliaPoolRegisterVerdict,
    type ItaliaPoolRegisterWrite,
    type ItaliaSitePowerPolicy,
    OPERATIONAL_POLICY_MAX_SOURCES,
    OPERATIONS_DELETE_ITALIA_POOL_REGISTER_ENTRY_PARAMS,
    OPERATIONS_DELETE_POLICY_PARAMS,
    OPERATIONS_DESCRIBE,
    OPERATIONS_GET_COLD_CHAIN_RECORD_VERDICT_PARAMS,
    OPERATIONS_GET_IRRIGATION_VERDICT_PARAMS,
    OPERATIONS_GET_ITALIA_BREAKER_TRIP_VERDICT_PARAMS,
    OPERATIONS_GET_ITALIA_HOT_WATER_VERDICT_PARAMS,
    OPERATIONS_GET_ITALIA_NIGHT_FLOW_VERDICTS_PARAMS,
    OPERATIONS_GET_ITALIA_PITCH_VERDICT_PARAMS,
    OPERATIONS_GET_ITALIA_POOL_REGISTER_PARAMS,
    OPERATIONS_GET_ITALIA_REOPENING_FLUSH_VERDICT_PARAMS,
    OPERATIONS_GET_ITALIA_SITE_POWER_VERDICT_PARAMS,
    OPERATIONS_GET_PARKING_OPERATIONAL_VERDICT_PARAMS,
    OPERATIONS_GET_POLICIES_PARAMS,
    OPERATIONS_GET_POLICY_REGISTRY_PARAMS,
    OPERATIONS_GET_POLICY_SELECTOR_CATALOG_PARAMS,
    OPERATIONS_GET_PV_HEALTH_VERDICT_PARAMS,
    OPERATIONS_GET_REFRIGERATION_PEER_HEALTH_PARAMS,
    OPERATIONS_SET_COLD_CHAIN_RECORD_POLICY_PARAMS,
    OPERATIONS_SET_IRRIGATION_POLICY_PARAMS,
    OPERATIONS_SET_ITALIA_BREAKER_TRIP_POLICY_PARAMS,
    OPERATIONS_SET_ITALIA_HOT_WATER_POLICY_PARAMS,
    OPERATIONS_SET_ITALIA_NIGHT_FLOW_POLICY_PARAMS,
    OPERATIONS_SET_ITALIA_PITCH_POLICY_PARAMS,
    OPERATIONS_SET_ITALIA_POOL_CHEMISTRY_POLICY_PARAMS,
    OPERATIONS_SET_ITALIA_POOL_REGISTER_ENTRY_PARAMS,
    OPERATIONS_SET_ITALIA_SITE_POWER_POLICY_PARAMS,
    OPERATIONS_SET_PARKING_OPERATIONAL_POLICY_PARAMS,
    OPERATIONS_SET_POLICY_PARAMS,
    OPERATIONS_SET_PV_HEALTH_POLICY_PARAMS,
    OPERATIONS_SET_REFRIGERATION_PEER_POLICY_PARAMS,
    type OperationalCustomDeviceRoleChoice,
    type OperationalPhysicalSourceChoice,
    type OperationalPolicies,
    type OperationalPolicyFamily,
    type OperationalPolicyRegistry,
    type OperationalPolicySelectorBinding,
    type OperationalPolicySelectorCatalog,
    type OperationalPolicySelectorCatalogParams,
    type OperationalSource,
    type ParkingOperationalPolicy,
    type ParkingOperationalVerdict,
    type PvHealthPolicy,
    type PvHealthVerdict,
    type RefrigerationPeerHealth,
    type RefrigerationPeerPolicy
} from '../../types/api/operations';
import type CommandSender from '../CommandSender';
import {
    evaluateItaliaHotWaterVerdict,
    evaluateItaliaReopeningFlushVerdict,
    type ItaliaHotWaterReading,
    type ItaliaHotWaterVerdict,
    type ItaliaReopeningFlushVerdict
} from '../energy/italiaHotWaterVerdict';
import {
    evaluateItaliaNightFlowVerdicts,
    type ItaliaNightFlowPolicy,
    type ItaliaNightFlowReading,
    type ItaliaNightFlowVerdict,
    sustainedMinimumM3h
} from '../energy/italiaNightFlowVerdict';
import {
    evaluateItaliaPitchVerdict,
    type ItaliaPitchPolicy,
    type ItaliaPitchVerdict
} from '../energy/italiaPitchVerdict';
import {
    type DeviceLive,
    type MeterDeviceChannels,
    meterLiveWatts
} from '../energy/liveMeterPower';
import {devicePowerChannels} from '../energy/livePowerChannels';
import {
    deviceMeasurementPoints,
    mergeMeasurementPoints
} from '../energy/measurementPoints';
import {
    type ColdChainRecordReading,
    evaluateColdChainRecord
} from '../operations/coldChainRecordVerdict';
import {latestScheduledOccurrence} from '../operations/evaluatorBlocks';
import {
    evaluateItaliaBreakerTrips,
    type ItaliaBreakerCounterReading,
    type ItaliaBreakerTripVerdict
} from '../operations/italiaBreakerTripVerdict';
import {
    evaluateItaliaPoolRegister,
    type ItaliaPoolRegisterReading
} from '../operations/italiaPoolRegisterVerdict';
import {
    evaluateItaliaSitePower,
    type ItaliaSitePowerReading,
    type ItaliaSitePowerVerdict
} from '../operations/italiaSitePowerVerdict';
import {
    irrigationVerdict,
    type OperationalVerdictPolicies,
    pvHealthVerdict
} from '../operations/operationalVerdicts';
import {
    operationalPolicyRegistry,
    operationSelectorBindings,
    policyIdField
} from '../operations/operationRegistry';
import {parkingOccupancyVerdict} from '../operations/parkingOccupancyVerdict';
import {resolveParkingRoleSources} from '../operations/parkingRoleSources';
import {
    evaluateRefrigerationPeerEnergy,
    type RefrigerationPeerEnergySample
} from '../operations/refrigerationPeerEnergy';
import {dateInZone} from '../report/localTimeInZone';
import {localMidnightToUtc} from '../report/reportPeriod';
import Component from './Component';

const METADATA_KEY = 'operationalVerdictPolicies';
const OPERATIONAL_QUERY_CHUNK_MS = 86_400_000;
const MAX_OPERATIONAL_ROWS_PER_CHUNK = OPERATIONAL_POLICY_MAX_SOURCES * 96;

interface CurrentSourceResolution {
    internalIdByDeviceId: ReadonlyMap<string, number>;
    deviceIds: ReadonlySet<string>;
}

export interface OperationCatalogDevice {
    id: number;
    shellyId: string;
}

/** Authorization boundary shared by all physical selector catalog branches. */
export async function filterAuthorizedOperationCatalogDevices(
    sender: Pick<CommandSender, 'filterAccessibleDevices'>,
    devices: readonly OperationCatalogDevice[]
): Promise<OperationCatalogDevice[]> {
    const accessible = await sender.filterAccessibleDevices(
        devices.map((device) => device.shellyId)
    );
    return devices.filter((device) => accessible.has(device.shellyId));
}

export function requireAuthorizedCatalogLocation(
    locationId: number | undefined,
    locations: readonly {id: number}[],
    sender: Pick<CommandSender, 'isAuthenticated'>
): number | undefined {
    if (locationId === undefined) return undefined;
    if (locations.some((location) => location.id === locationId)) {
        return locationId;
    }
    throw RpcError.PermissionDenied(sender.isAuthenticated());
}

export function operationDeviceLabel(
    shellyId: string,
    info: {name?: unknown} | undefined
): string {
    const name = typeof info?.name === 'string' ? info.name.trim() : '';
    return name.length > 0 ? `${name} (${shellyId})` : shellyId;
}

export function operationSourceLabel(
    deviceLabel: string,
    detail: string
): string {
    return `${deviceLabel} · ${detail}`;
}

type SitePowerMeterCandidate = Pick<
    EnergyLogicalMeter,
    'locationId' | 'utilityType' | 'aggregationMode' | 'points'
>;

export function eligibleSitePowerMeters<T extends SitePowerMeterCandidate>(
    meters: readonly T[],
    siteId: number,
    readableDeviceIds: ReadonlySet<number>
): T[] {
    return meters.filter(
        (meter) =>
            meter.locationId === siteId &&
            meter.utilityType === 'electric' &&
            meter.aggregationMode !== 'formula' &&
            meter.points.length > 0 &&
            meter.points.every((point) => readableDeviceIds.has(point.deviceId))
    );
}

export default class OperationsComponent extends Component {
    constructor() {
        super('operations', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return OPERATIONS_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('GetPolicies')
    @Component.CrudPermission('organizations', 'read')
    async getPolicies(
        params: unknown,
        sender: CommandSender
    ): Promise<OperationalPolicies> {
        const p = validateOrThrow<{organizationId?: string}>(
            params,
            OPERATIONS_GET_POLICIES_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        return visiblePolicies(orgId, sender, await policiesFor(orgId));
    }

    @Component.NoAudit
    @Component.Expose('GetPolicyRegistry')
    @Component.CrudPermission('organizations', 'read')
    getPolicyRegistry(
        params: unknown,
        sender: CommandSender
    ): OperationalPolicyRegistry {
        const p = validateOrThrow<{organizationId?: string}>(
            params,
            OPERATIONS_GET_POLICY_REGISTRY_PARAMS
        );
        requireOrganizationId(sender, p);
        return operationalPolicyRegistry();
    }

    @Component.NoAudit
    @Component.Expose('GetPolicySelectorCatalog')
    @Component.CrudPermission('organizations', 'read')
    async getPolicySelectorCatalog(
        params: unknown,
        sender: CommandSender
    ): Promise<OperationalPolicySelectorCatalog> {
        const p = validateOrThrow<OperationalPolicySelectorCatalogParams>(
            params,
            OPERATIONS_GET_POLICY_SELECTOR_CATALOG_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        return operationSelectorCatalog(orgId, sender, p);
    }

    @Component.NoAudit
    @Component.Expose('GetRefrigerationPeerHealth')
    @Component.CrudPermission('organizations', 'read')
    async getRefrigerationPeerHealth(
        params: unknown,
        sender: CommandSender
    ): Promise<RefrigerationPeerHealth> {
        const p = validateOrThrow<{
            organizationId?: string;
            policyId: string;
            from: string;
            to: string;
        }>(params, OPERATIONS_GET_REFRIGERATION_PEER_HEALTH_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const policy = (await policiesFor(orgId)).refrigeration.find(
            (item) => item.id === p.policyId
        );
        if (policy)
            await assertPolicyReadable(
                sender,
                policy.locationId,
                policy.sources.map((source) => source.deviceId)
            );
        const period = operationalPeriod(p.from, p.to);
        const current = policy
            ? await resolveCurrentSources(
                  orgId,
                  policy.sources.map((source) => source.deviceId),
                  policy.locationId
              )
            : emptySourceResolution();
        const currentPolicy = policy
            ? {
                  ...policy,
                  sources: policy.sources.filter((source) =>
                      current.deviceIds.has(source.deviceId)
                  )
              }
            : undefined;
        return {
            ...evaluateRefrigerationPeerEnergy(
                currentPolicy,
                period,
                currentPolicy
                    ? await refrigerationPeerEnergySamples(
                          currentPolicy,
                          current,
                          period
                      )
                    : []
            ),
            policyId: p.policyId
        };
    }

    @Component.NoAudit
    @Component.Expose('GetColdChainRecordVerdict')
    @Component.CrudPermission('organizations', 'read')
    async getColdChainRecordVerdict(
        params: unknown,
        sender: CommandSender
    ): Promise<ColdChainRecordVerdict> {
        const p = validateOrThrow<{
            organizationId?: string;
            policyId: string;
        }>(params, OPERATIONS_GET_COLD_CHAIN_RECORD_VERDICT_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        const policy = (await policiesFor(orgId)).coldChain.find(
            (item) => item.id === p.policyId
        );
        if (policy)
            await assertPolicyReadable(sender, policy.locationId, [
                ...new Set(policy.sources.map((source) => source.deviceId))
            ]);
        return coldChainRecordVerdict(orgId, p.policyId, policy);
    }

    @Component.NoAudit
    @Component.Expose('GetParkingOperationalVerdict')
    @Component.CrudPermission('organizations', 'read')
    async getParkingOperationalVerdict(
        params: unknown,
        sender: CommandSender
    ): Promise<ParkingOperationalVerdict> {
        const p = validateOrThrow<{
            organizationId?: string;
            locationId: number;
        }>(params, OPERATIONS_GET_PARKING_OPERATIONAL_VERDICT_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        await assertLocationReadable(sender, p.locationId);
        const policy = (await policiesFor(orgId)).parking.find(
            (item) => item.locationId === p.locationId
        );
        const allSources = policy
            ? [...policy.sources, ...(policy.safetySources ?? [])]
            : [];
        const resolution = policy
            ? await resolveParkingRoleSources(
                  orgId,
                  policy.locationId,
                  allSources
              )
            : {snapshots: []};
        return {
            ...parkingOccupancyVerdict(
                policy,
                resolution.snapshots,
                Date.now()
            ),
            policyId: policy?.id ?? String(p.locationId)
        };
    }

    @Component.NoAudit
    @Component.Expose('GetIrrigationVerdict')
    @Component.CrudPermission('organizations', 'read')
    async getIrrigationVerdict(
        params: unknown,
        sender: CommandSender
    ): Promise<IrrigationVerdict> {
        const p = validateOrThrow<{organizationId?: string; policyId: string}>(
            params,
            OPERATIONS_GET_IRRIGATION_VERDICT_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        const profile = await getOrganizationProfile(orgId);
        const policy = readPolicies(profile.metadata).irrigation.find(
            (item) => item.id === p.policyId
        );
        if (policy)
            await assertPolicyReadable(
                sender,
                policy.locationId,
                irrigationSourceIds(policy)
            );
        if (!policy)
            return {
                ...irrigationVerdict(
                    undefined,
                    profile.timezoneDefault,
                    unavailableIrrigationHistory(),
                    new Date()
                ),
                policyId: p.policyId
            };
        const current = await resolveCurrentSources(
            orgId,
            irrigationSourceIds(policy),
            policy.locationId
        );
        return {
            ...(await irrigationPolicyVerdict(
                orgId,
                policy,
                current,
                profile.timezoneDefault,
                new Date()
            )),
            policyId: p.policyId
        };
    }

    @Component.NoAudit
    @Component.Expose('GetPvHealthVerdict')
    @Component.CrudPermission('organizations', 'read')
    async getPvHealthVerdict(
        params: unknown,
        sender: CommandSender
    ): Promise<PvHealthVerdict> {
        const p = validateOrThrow<{organizationId?: string; policyId: string}>(
            params,
            OPERATIONS_GET_PV_HEALTH_VERDICT_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        const policy = (await policiesFor(orgId)).pv.find(
            (item) => item.id === p.policyId
        );
        if (policy)
            await assertPolicyReadable(
                sender,
                policy.locationId,
                policy.sources.map((source) => source.deviceId)
            );
        if (!policy)
            return {...pvHealthVerdict(undefined, []), policyId: p.policyId};
        const current = await resolveCurrentSources(
            orgId,
            policy.sources.map((source) => source.deviceId),
            policy.locationId
        );
        return {
            ...(await pvPolicyVerdict(policy, current, new Date())),
            policyId: p.policyId
        };
    }

    @Component.NoAudit
    @Component.Expose('GetItaliaHotWaterVerdict')
    @Component.CrudPermission('organizations', 'read')
    async getItaliaHotWaterVerdict(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaHotWaterVerdict> {
        const p = validateOrThrow<{organizationId?: string; siteId: number}>(
            params,
            OPERATIONS_GET_ITALIA_HOT_WATER_VERDICT_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        await assertLocationReadable(sender, p.siteId);
        const policy = (await policiesFor(orgId)).italiaHotWater.find(
            (item) => item.siteId === p.siteId
        );
        if (!policy)
            return {
                ...evaluateItaliaHotWaterVerdict(null, new Map(), {
                    from: new Date(0),
                    to: new Date(0)
                }),
                siteId: p.siteId
            };
        const now = new Date();
        const period = {
            from: localMidnightToUtc(
                dateInZone(now, policy.timeZone),
                policy.timeZone
            ),
            to: now
        };
        const current = await resolveCurrentSources(
            orgId,
            policy.blocks.map((block) => block.deviceId),
            policy.siteId
        );
        return evaluateItaliaHotWaterVerdict(
            policy,
            await italiaHotWaterReadings(orgId, policy, current, period),
            period
        );
    }

    @Component.NoAudit
    @Component.Expose('GetItaliaPoolRegister')
    @Component.CrudPermission('organizations', 'read')
    async getItaliaPoolRegister(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaPoolRegisterVerdict[]> {
        const p = validateOrThrow<{
            organizationId?: string;
            siteId: number;
            poolId: string;
            from: string;
            to: string;
        }>(params, OPERATIONS_GET_ITALIA_POOL_REGISTER_PARAMS);
        const dates = registerDates(p.from, p.to);
        const orgId = requireOrganizationId(sender, p);
        await assertLocationReadable(sender, p.siteId);
        const policy = (await policiesFor(orgId)).italiaPoolChemistry.find(
            (item) => item.poolId === p.poolId && item.siteId === p.siteId
        );
        if (!policy) {
            return dates.map((date) =>
                evaluateItaliaPoolRegister(null, date, [], {
                    poolId: p.poolId,
                    siteId: p.siteId
                })
            );
        }
        const current = await resolveCurrentSources(
            orgId,
            policy.sources.map((source) => source.deviceId),
            policy.siteId
        );
        const repository = await defaultItaliaPoolRegisterRepository();
        const entered = await repository.list({
            organizationId: orgId,
            siteId: p.siteId,
            poolId: p.poolId,
            from: p.from,
            to: p.to
        });
        const measured = await italiaPoolMeasuredReadings(
            orgId,
            policy,
            current,
            p.from,
            p.to
        );
        return dates.map((date) =>
            evaluateItaliaPoolRegister(
                policy,
                date,
                [
                    ...entered
                        .filter((row) => row.date === date)
                        .map(registerRowReading),
                    ...(measured.get(date) ?? [])
                ],
                {poolId: p.poolId, siteId: p.siteId}
            )
        );
    }

    @Component.NoAudit
    @Component.Expose('GetItaliaReopeningFlushVerdict')
    @Component.CrudPermission('organizations', 'read')
    async getItaliaReopeningFlushVerdict(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaReopeningFlushVerdict> {
        const p = validateOrThrow<{
            organizationId?: string;
            siteId: number;
            from: string;
            to: string;
        }>(params, OPERATIONS_GET_ITALIA_REOPENING_FLUSH_VERDICT_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        await assertLocationReadable(sender, p.siteId);
        const period = operationalPeriod(p.from, p.to);
        const policy = (await policiesFor(orgId)).italiaHotWater.find(
            (item) => item.siteId === p.siteId
        );
        if (!policy)
            return {
                ...evaluateItaliaReopeningFlushVerdict(
                    null,
                    new Map(),
                    period,
                    new Date()
                ),
                siteId: p.siteId
            };
        const current = await resolveCurrentSources(
            orgId,
            policy.blocks.map((block) => block.deviceId),
            policy.siteId
        );
        return evaluateItaliaReopeningFlushVerdict(
            policy,
            await italiaHotWaterReadings(orgId, policy, current, period),
            period,
            new Date()
        );
    }

    @Component.NoAudit
    @Component.Expose('GetItaliaNightFlowVerdicts')
    @Component.CrudPermission('organizations', 'read')
    async getItaliaNightFlowVerdicts(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaNightFlowVerdict[]> {
        const p = validateOrThrow<{organizationId?: string; siteId: number}>(
            params,
            OPERATIONS_GET_ITALIA_NIGHT_FLOW_VERDICTS_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        await assertLocationReadable(sender, p.siteId);
        const policy = (await policiesFor(orgId)).italiaNightFlow.find(
            (item) => item.siteId === p.siteId
        );
        if (!policy) return [];
        const current = await resolveCurrentSources(
            orgId,
            policy.zones.flatMap((zone) =>
                zone.sources.map((source) => source.deviceId)
            ),
            policy.siteId
        );
        return evaluateItaliaNightFlowVerdicts(
            policy,
            await nightFlowSamples(policy, current, new Date())
        );
    }

    @Component.NoAudit
    @Component.Expose('GetItaliaPitchVerdict')
    @Component.CrudPermission('organizations', 'read')
    async getItaliaPitchVerdict(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaPitchVerdict> {
        const p = validateOrThrow<{organizationId?: string; pitchId: number}>(
            params,
            OPERATIONS_GET_ITALIA_PITCH_VERDICT_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        const policy = (await policiesFor(orgId)).italiaPitch.find(
            (item) => item.pitchId === p.pitchId
        );
        if (!policy)
            return {
                ...evaluateItaliaPitchVerdict(null, [], new Date()),
                pitchId: p.pitchId
            };
        await assertPolicyReadable(sender, undefined, [policy.deviceId]);
        const current = await resolveCurrentSources(orgId, [policy.deviceId]);
        return evaluateItaliaPitchVerdict(
            policy,
            await italiaPitchReadings(policy, current, new Date()),
            new Date()
        );
    }

    @Component.NoAudit
    @Component.Expose('GetItaliaSitePowerVerdict')
    @Component.CrudPermission('organizations', 'read')
    async getItaliaSitePowerVerdict(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaSitePowerVerdict> {
        const p = validateOrThrow<{organizationId?: string; siteId: number}>(
            params,
            OPERATIONS_GET_ITALIA_SITE_POWER_VERDICT_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        const policy = (await policiesFor(orgId)).italiaSitePower.find(
            (item) => item.siteId === p.siteId
        );
        if (!policy)
            return {
                ...evaluateItaliaSitePower(undefined, undefined, new Date()),
                siteId: p.siteId
            };
        await assertLocationReadable(sender, policy.siteId);
        const now = new Date();
        return evaluateItaliaSitePower(
            policy,
            await italiaSitePowerReading(orgId, policy),
            now
        );
    }

    @Component.NoAudit
    @Component.Expose('GetItaliaBreakerTripVerdict')
    @Component.CrudPermission('organizations', 'read')
    async getItaliaBreakerTripVerdict(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaBreakerTripVerdict> {
        const p = validateOrThrow<{organizationId?: string; pitchId: number}>(
            params,
            OPERATIONS_GET_ITALIA_BREAKER_TRIP_VERDICT_PARAMS
        );
        const orgId = requireOrganizationId(sender, p);
        const policy = (await policiesFor(orgId)).italiaBreakerTrips.find(
            (item) => item.pitchId === p.pitchId
        );
        if (!policy)
            return {
                ...evaluateItaliaBreakerTrips(undefined, [], undefined),
                pitchId: p.pitchId
            };
        await assertLocationReadable(sender, policy.pitchId);
        const to = new Date();
        const from = new Date(
            to.getTime() - policy.windowDays * OPERATIONAL_QUERY_CHUNK_MS
        );
        return evaluateItaliaBreakerTrips(
            policy,
            await italiaBreakerCounterReadings(orgId, policy, {from, to}),
            {from, to}
        );
    }

    @Component.Expose('SetRefrigerationPeerPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setRefrigerationPeerPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<RefrigerationPeerPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: RefrigerationPeerPolicy;
        }>(params, OPERATIONS_SET_REFRIGERATION_PEER_POLICY_PARAMS);
        validateRefrigerationPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertSourcesOwned(orgId, p.policy.sources, p.policy.locationId);
        await savePolicy(orgId, 'refrigeration', 'id', p.policy.id, p.policy);
        return p.policy;
    }

    @Component.Expose('SetColdChainRecordPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setColdChainRecordPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<ColdChainRecordPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: ColdChainRecordPolicy;
        }>(params, OPERATIONS_SET_COLD_CHAIN_RECORD_POLICY_PARAMS);
        validateColdChainRecordPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertSourcesOwned(orgId, p.policy.sources, p.policy.locationId);
        await savePolicy(orgId, 'coldChain', 'id', p.policy.id, p.policy);
        return p.policy;
    }

    @Component.Expose('SetPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setPolicy(params: unknown, sender: CommandSender): Promise<unknown> {
        const p = validateOrThrow<{
            organizationId?: string;
            family: OperationalPolicyFamily;
            policy: unknown;
        }>(params, OPERATIONS_SET_POLICY_PARAMS);
        return this.dispatchPolicySetter(p, sender);
    }

    @Component.Expose('SetParkingOperationalPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setParkingOperationalPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<ParkingOperationalPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: ParkingOperationalPolicy;
        }>(params, OPERATIONS_SET_PARKING_OPERATIONAL_POLICY_PARAMS);
        validateParkingPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertParkingRolesOwned(
            orgId,
            [...p.policy.sources, ...(p.policy.safetySources ?? [])],
            p.policy.locationId
        );
        await savePolicy(
            orgId,
            'parking',
            'locationId',
            String(p.policy.locationId),
            p.policy
        );
        return p.policy;
    }

    @Component.Expose('SetIrrigationPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setIrrigationPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<IrrigationPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: IrrigationPolicy;
        }>(params, OPERATIONS_SET_IRRIGATION_POLICY_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertIrrigationSourcesOwned(orgId, p.policy);
        await savePolicy(orgId, 'irrigation', 'id', p.policy.id, p.policy);
        return p.policy;
    }

    @Component.Expose('SetPvHealthPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setPvHealthPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<PvHealthPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: PvHealthPolicy;
        }>(params, OPERATIONS_SET_PV_HEALTH_POLICY_PARAMS);
        validatePvPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertSourcesOwned(
            orgId,
            p.policy.sources.map((source) => ({
                deviceId: source.deviceId,
                channel: String(source.channel)
            })),
            p.policy.locationId
        );
        await savePolicy(orgId, 'pv', 'id', p.policy.id, p.policy);
        return p.policy;
    }

    @Component.Expose('SetItaliaHotWaterPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setItaliaHotWaterPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaHotWaterPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: ItaliaHotWaterPolicy;
        }>(params, OPERATIONS_SET_ITALIA_HOT_WATER_POLICY_PARAMS);
        validateItaliaHotWaterPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertSourcesOwned(orgId, p.policy.blocks, p.policy.siteId);
        await savePolicy(
            orgId,
            'italiaHotWater',
            'siteId',
            String(p.policy.siteId),
            p.policy
        );
        return p.policy;
    }

    @Component.Expose('SetItaliaPoolChemistryPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setItaliaPoolChemistryPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaPoolChemistryPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: ItaliaPoolChemistryPolicy;
        }>(params, OPERATIONS_SET_ITALIA_POOL_CHEMISTRY_POLICY_PARAMS);
        validateItaliaPoolChemistryPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertSourcesOwned(orgId, p.policy.sources, p.policy.siteId);
        const repository = await defaultItaliaPoolRegisterRepository();
        const saved = await repository.upsertPolicy({
            organizationId: orgId,
            policy: p.policy
        });
        if (!saved)
            throw RpcError.OperationFailed('operations save pool policy');
        EventDistributor.emitOrganizationProfileUpdated(orgId);
        return saved;
    }

    @Component.Expose('SetItaliaPoolRegisterEntry')
    @Component.CrudPermission(
        'locations',
        'update',
        (params) => params?.entry?.siteId
    )
    async setItaliaPoolRegisterEntry(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaPoolRegisterStoredEntry> {
        const p = validateOrThrow<{
            organizationId?: string;
            entry: ItaliaPoolRegisterWrite;
        }>(params, OPERATIONS_SET_ITALIA_POOL_REGISTER_ENTRY_PARAMS);
        validateItaliaPoolRegisterWrite(p.entry);
        const orgId = requireOrganizationId(sender, p);
        await assertLocationOwned(orgId, p.entry.siteId);
        await assertPoolPolicyMatches(orgId, p.entry.siteId, p.entry.poolId);
        const repository = await defaultItaliaPoolRegisterRepository();
        const stored = await repository.upsert({
            organizationId: orgId,
            siteId: p.entry.siteId,
            poolId: p.entry.poolId,
            date: p.entry.date,
            entry: p.entry.entry,
            value: p.entry.value,
            acceptedBy: sender.getUser()?.username ?? null
        });
        if (!stored)
            throw RpcError.OperationFailed(
                'operations save pool register entry'
            );
        return {
            poolId: stored.poolId,
            siteId: stored.siteId,
            date: stored.date,
            entry: stored.entry as ItaliaPoolRegisterEntryId,
            value: stored.value,
            source: 'entered',
            acceptedWrite: {
                at: stored.acceptedAt,
                username: stored.acceptedBy
            }
        };
    }

    @Component.Expose('DeleteItaliaPoolRegisterEntry')
    @Component.CrudPermission('locations', 'update', (params) => params?.siteId)
    async deleteItaliaPoolRegisterEntry(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: boolean}> {
        const p = validateOrThrow<{
            organizationId?: string;
            siteId: number;
            poolId: string;
            date: string;
            entry: ItaliaPoolRegisterEntryId;
        }>(params, OPERATIONS_DELETE_ITALIA_POOL_REGISTER_ENTRY_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        await assertLocationOwned(orgId, p.siteId);
        await assertPoolPolicyMatches(orgId, p.siteId, p.poolId);
        const repository = await defaultItaliaPoolRegisterRepository();
        return {
            deleted: await repository.delete({
                organizationId: orgId,
                siteId: p.siteId,
                poolId: p.poolId,
                date: p.date,
                entry: p.entry
            })
        };
    }

    @Component.Expose('SetItaliaNightFlowPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setItaliaNightFlowPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaNightFlowPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: ItaliaNightFlowPolicy;
        }>(params, OPERATIONS_SET_ITALIA_NIGHT_FLOW_POLICY_PARAMS);
        validateItaliaNightFlowPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertSourcesOwned(
            orgId,
            p.policy.zones.flatMap((zone) => zone.sources),
            p.policy.siteId
        );
        await savePolicy(
            orgId,
            'italiaNightFlow',
            'siteId',
            String(p.policy.siteId),
            p.policy
        );
        return p.policy;
    }

    @Component.Expose('SetItaliaPitchPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setItaliaPitchPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaPitchPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: ItaliaPitchPolicy;
        }>(params, OPERATIONS_SET_ITALIA_PITCH_POLICY_PARAMS);
        validateItaliaPitchPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertSourcesOwned(orgId, [{deviceId: p.policy.deviceId}]);
        await savePolicy(
            orgId,
            'italiaPitch',
            'pitchId',
            String(p.policy.pitchId),
            p.policy
        );
        return p.policy;
    }

    @Component.Expose('SetItaliaSitePowerPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setItaliaSitePowerPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaSitePowerPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: ItaliaSitePowerPolicy;
        }>(params, OPERATIONS_SET_ITALIA_SITE_POWER_POLICY_PARAMS);
        validateItaliaSitePowerPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertItaliaSitePowerSource(orgId, p.policy);
        await savePolicy(
            orgId,
            'italiaSitePower',
            'siteId',
            String(p.policy.siteId),
            p.policy
        );
        return p.policy;
    }

    @Component.Expose('SetItaliaBreakerTripPolicy')
    @Component.CrudPermission('organizations', 'update')
    async setItaliaBreakerTripPolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<ItaliaBreakerTripPolicy> {
        const p = validateOrThrow<{
            organizationId?: string;
            policy: ItaliaBreakerTripPolicy;
        }>(params, OPERATIONS_SET_ITALIA_BREAKER_TRIP_POLICY_PARAMS);
        validateItaliaBreakerTripPolicy(p.policy);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        await assertItaliaBreakerSource(orgId, p.policy);
        await savePolicy(
            orgId,
            'italiaBreakerTrips',
            'pitchId',
            String(p.policy.pitchId),
            p.policy
        );
        return p.policy;
    }

    @Component.Expose('DeletePolicy')
    @Component.CrudPermission('organizations', 'update')
    async deletePolicy(
        params: unknown,
        sender: CommandSender
    ): Promise<{deleted: boolean}> {
        const p = validateOrThrow<{
            organizationId?: string;
            family: OperationalPolicyFamily;
            policyId: string;
        }>(params, OPERATIONS_DELETE_POLICY_PARAMS);
        const orgId = requireOrganizationId(sender, p);
        await assertOrgWidePolicyWrite(sender);
        if (p.family === 'italiaPoolChemistry') {
            const repository = await defaultItaliaPoolRegisterRepository();
            const deleted = await repository.deletePolicy(orgId, p.policyId);
            if (deleted) EventDistributor.emitOrganizationProfileUpdated(orgId);
            return {deleted};
        }
        const deleted = await deleteStoredPolicy(
            orgId,
            p.family,
            policyIdField(p.family),
            p.policyId
        );
        if (deleted) EventDistributor.emitOrganizationProfileUpdated(orgId);
        return {deleted};
    }

    private dispatchPolicySetter(
        input: {
            organizationId?: string;
            family: OperationalPolicyFamily;
            policy: unknown;
        },
        sender: CommandSender
    ): Promise<unknown> {
        const params = {
            ...(input.organizationId === undefined
                ? {}
                : {organizationId: input.organizationId}),
            policy: input.policy
        };
        const handlers: Record<
            OperationalPolicyFamily,
            () => Promise<unknown>
        > = {
            refrigeration: () =>
                this.setRefrigerationPeerPolicy(params, sender),
            coldChain: () => this.setColdChainRecordPolicy(params, sender),
            parking: () => this.setParkingOperationalPolicy(params, sender),
            irrigation: () => this.setIrrigationPolicy(params, sender),
            pv: () => this.setPvHealthPolicy(params, sender),
            italiaPoolChemistry: () =>
                this.setItaliaPoolChemistryPolicy(params, sender),
            italiaHotWater: () => this.setItaliaHotWaterPolicy(params, sender),
            italiaNightFlow: () =>
                this.setItaliaNightFlowPolicy(params, sender),
            italiaPitch: () => this.setItaliaPitchPolicy(params, sender),
            italiaSitePower: () =>
                this.setItaliaSitePowerPolicy(params, sender),
            italiaBreakerTrips: () =>
                this.setItaliaBreakerTripPolicy(params, sender)
        };
        return handlers[input.family]();
    }
}

async function policiesFor(orgId: string): Promise<OperationalVerdictPolicies> {
    const policies = readPolicies(
        (await getOrganizationProfile(orgId)).metadata
    );
    const repository = await defaultItaliaPoolRegisterRepository();
    return {
        ...policies,
        italiaPoolChemistry: await repository.listPolicies(orgId)
    };
}

async function coldChainRecordVerdict(
    orgId: string,
    policyId: string,
    policy: ColdChainRecordPolicy | undefined
): Promise<ColdChainRecordVerdict> {
    if (!policy) {
        return {
            ...evaluateColdChainRecord(undefined, [], new Date()),
            policyId
        };
    }
    const now = new Date();
    const current = await resolveCurrentSources(
        orgId,
        policy.sources.map((source) => source.deviceId),
        policy.locationId
    );
    return evaluateColdChainRecord(
        policy,
        await coldChainRecordReadings(orgId, policy, current, now),
        now
    );
}

async function visiblePolicies(
    orgId: string,
    sender: CommandSender,
    policies: OperationalVerdictPolicies
): Promise<OperationalVerdictPolicies> {
    const readable = await readableResourceAllowlistsAsync(sender);
    const current = await currentPolicySources(orgId, policies);
    const readableLocationIds =
        readable.locations === null ? null : new Set(readable.locations);
    const readableDeviceIds =
        readable.devices === null ? null : new Set(readable.devices);
    const locationVisible = (locationId: number | undefined): boolean =>
        locationId !== undefined &&
        (readableLocationIds === null || readableLocationIds.has(locationId));
    const sourcesVisible = (deviceIds: readonly string[]): boolean =>
        readableDeviceIds === null ||
        deviceIds.every((deviceId) => readableDeviceIds.has(deviceId));
    return {
        refrigeration: policies.refrigeration.filter(
            (policy) =>
                current(policy.locationId, policy.sources) &&
                (policy.locationId !== undefined
                    ? locationVisible(policy.locationId)
                    : sourcesVisible(
                          policy.sources.map((source) => source.deviceId)
                      ))
        ),
        coldChain: policies.coldChain.filter(
            (policy) =>
                current(policy.locationId, policy.sources) &&
                locationVisible(policy.locationId)
        ),
        parking: policies.parking.filter(
            (policy) =>
                current(
                    policy.locationId,
                    [...policy.sources, ...(policy.safetySources ?? [])].map(
                        (source) => ({deviceId: source.customDeviceId})
                    )
                ) && locationVisible(policy.locationId)
        ),
        irrigation: policies.irrigation.filter(
            (policy) =>
                current(
                    policy.locationId,
                    irrigationSourceIds(policy).map((deviceId) => ({deviceId}))
                ) &&
                (policy.locationId !== undefined
                    ? locationVisible(policy.locationId)
                    : sourcesVisible(irrigationSourceIds(policy)))
        ),
        pv: policies.pv.filter(
            (policy) =>
                current(policy.locationId, policy.sources) &&
                (policy.locationId !== undefined
                    ? locationVisible(policy.locationId)
                    : sourcesVisible(
                          policy.sources.map((source) => source.deviceId)
                      ))
        ),
        italiaPoolChemistry: policies.italiaPoolChemistry.filter(
            (policy) =>
                current(policy.siteId, policy.sources) &&
                locationVisible(policy.siteId)
        ),
        italiaHotWater: policies.italiaHotWater.filter(
            (policy) =>
                current(policy.siteId, policy.blocks) &&
                locationVisible(policy.siteId)
        ),
        italiaNightFlow: policies.italiaNightFlow.filter(
            (policy) =>
                current(
                    policy.siteId,
                    policy.zones.flatMap((zone) => zone.sources)
                ) && locationVisible(policy.siteId)
        ),
        italiaPitch: policies.italiaPitch.filter(
            (policy) =>
                current(undefined, [{deviceId: policy.deviceId}]) &&
                sourcesVisible([policy.deviceId])
        ),
        italiaSitePower: policies.italiaSitePower.filter((policy) =>
            locationVisible(policy.siteId)
        ),
        italiaBreakerTrips: policies.italiaBreakerTrips.filter((policy) =>
            locationVisible(policy.pitchId)
        )
    };
}

async function currentPolicySources(
    orgId: string,
    policies: OperationalVerdictPolicies
): Promise<
    (
        locationId: number | undefined,
        sources: readonly {deviceId: string}[]
    ) => boolean
> {
    const fleet = new Set(await resolveScopeShellyIDs(orgId, 'fleet', null));
    const locationIds = [
        ...new Set([
            ...policies.refrigeration.flatMap((policy) =>
                policy.locationId === undefined ? [] : [policy.locationId]
            ),
            ...policies.coldChain.map((policy) => policy.locationId),
            ...policies.parking.map((policy) => policy.locationId),
            ...policies.irrigation.flatMap((policy) =>
                policy.locationId === undefined ? [] : [policy.locationId]
            ),
            ...policies.pv.flatMap((policy) =>
                policy.locationId === undefined ? [] : [policy.locationId]
            ),
            ...policies.italiaPoolChemistry.map((policy) => policy.siteId),
            ...policies.italiaHotWater.map((policy) => policy.siteId),
            ...policies.italiaNightFlow.map((policy) => policy.siteId),
            ...policies.italiaSitePower.map((policy) => policy.siteId),
            ...policies.italiaBreakerTrips.map((policy) => policy.pitchId)
        ])
    ];
    const byLocation = await resolveLocationShellyIDs(orgId, locationIds);
    const locationSets = new Map(
        [...byLocation].map(([locationId, deviceIds]) => [
            locationId,
            new Set(deviceIds)
        ])
    );
    return (locationId, sources) => {
        const current =
            locationId === undefined
                ? fleet
                : (locationSets.get(locationId) ?? new Set<string>());
        return sources.every((source) => current.has(source.deviceId));
    };
}

async function assertOrgWidePolicyWrite(sender: CommandSender): Promise<void> {
    await requireTenantWideComponentPermission(
        sender,
        'organizations',
        'update'
    );
}

async function assertLocationReadable(
    sender: CommandSender,
    locationId: number
): Promise<void> {
    const allowed = await sender.evaluateComponentPermissionAsync({
        component: 'locations',
        operation: 'read',
        itemId: locationId
    });
    if (!allowed) throw RpcError.PermissionDenied(sender.isAuthenticated());
}

async function assertPolicyReadable(
    sender: CommandSender,
    locationId: number | undefined,
    deviceIds: readonly string[]
): Promise<void> {
    if (locationId !== undefined) {
        await assertLocationReadable(sender, locationId);
        return;
    }
    const decisions = await Promise.all(
        deviceIds.map((deviceId) =>
            sender.evaluateComponentPermissionAsync({
                component: 'devices',
                operation: 'read',
                itemId: deviceId
            })
        )
    );
    if (decisions.every(Boolean)) return;
    throw RpcError.PermissionDenied(sender.isAuthenticated());
}

async function resolveCurrentSources(
    orgId: string,
    sourceDeviceIds: readonly string[],
    locationId?: number
): Promise<CurrentSourceResolution> {
    const uniqueDeviceIds = new Set(sourceDeviceIds);
    if (uniqueDeviceIds.size === 0) return emptySourceResolution();
    const result = await postgres.callMethod('device.fn_resolve_scope', {
        p_org_id: orgId,
        p_scope_kind: locationId === undefined ? 'fleet' : 'location',
        p_scope_id: locationId ?? null
    });
    const internalIdByDeviceId = new Map<string, number>();
    for (const row of (result?.rows ?? []) as Array<{
        dev_id?: unknown;
        shelly_id?: unknown;
    }>) {
        if (
            typeof row.dev_id === 'number' &&
            typeof row.shelly_id === 'string' &&
            uniqueDeviceIds.has(row.shelly_id)
        ) {
            internalIdByDeviceId.set(row.shelly_id, row.dev_id);
        }
    }
    return {
        internalIdByDeviceId,
        deviceIds: new Set(internalIdByDeviceId.keys())
    };
}

function emptySourceResolution(): CurrentSourceResolution {
    return {internalIdByDeviceId: new Map(), deviceIds: new Set()};
}

async function savePolicy(
    orgId: string,
    family: keyof OperationalVerdictPolicies,
    idField: 'id' | 'locationId' | 'siteId' | 'pitchId',
    policyId: string,
    policy: object
): Promise<void> {
    const result = await postgres.callMethod(
        'organization.fn_operational_policy_upsert',
        {
            p_organization_id: orgId,
            p_family: family,
            p_id_field: idField,
            p_policy_id: policyId,
            p_policy: policy
        }
    );
    if (!result?.rows?.length) {
        throw RpcError.OperationFailed('operations save policy');
    }
    EventDistributor.emitOrganizationProfileUpdated(orgId);
}

async function deleteStoredPolicy(
    orgId: string,
    family: OperationalPolicyFamily,
    idField: 'id' | 'locationId' | 'siteId' | 'pitchId',
    policyId: string
): Promise<boolean> {
    const result = await postgres.callMethod(
        'organization.fn_operational_policy_delete',
        {
            p_organization_id: orgId,
            p_family: family,
            p_id_field: idField,
            p_policy_id: policyId
        }
    );
    return result?.rows?.[0]?.fn_operational_policy_delete === true;
}

function operationalPeriod(
    fromValue: string,
    toValue: string
): {from: Date; to: Date} {
    const from = new Date(fromValue);
    const to = new Date(toValue);
    const durationMs = to.getTime() - from.getTime();
    if (
        !Number.isFinite(from.getTime()) ||
        !Number.isFinite(to.getTime()) ||
        durationMs <= 0 ||
        durationMs > 366 * 86_400_000
    ) {
        throw RpcError.InvalidParams(
            'operations period must be positive and at most 366 days'
        );
    }
    return {from, to};
}

async function refrigerationPeerEnergySamples(
    policy: RefrigerationPeerPolicy,
    current: CurrentSourceResolution,
    period: {from: Date; to: Date}
): Promise<RefrigerationPeerEnergySample[]> {
    const sourceByKey = new Map(
        policy.sources.map((source) => [
            energySourceKey(source.deviceId, source.channel, source.tag),
            source
        ])
    );
    const aggregates = new Map<
        string,
        {energyWh: number; lastBucketAt: Date | null}
    >();
    const repo = await defaultEnergyRepository();
    const internalIds = [...current.internalIdByDeviceId.values()];
    const deviceIdByInternalId = invertDeviceIds(current.internalIdByDeviceId);
    for (const chunk of timeChunks(period.from, period.to)) {
        const rows = await repo.queryEnergy15minByChannel({
            internalIds,
            from: chunk.from,
            to: chunk.to,
            tags: [...new Set(policy.sources.map((source) => source.tag))]
        });
        assertOperationalRowsBounded(rows.length);
        for (const row of rows) {
            const deviceId = deviceIdByInternalId.get(row.device);
            if (!deviceId) continue;
            const source = sourceByKey.get(
                energySourceKey(deviceId, row.channel, row.tag)
            );
            if (!source) continue;
            const aggregate = aggregates.get(source.id) ?? {
                energyWh: 0,
                lastBucketAt: null
            };
            aggregate.energyWh += row.energy_wh;
            const bucket = new Date(row.bucket);
            if (
                Number.isFinite(bucket.getTime()) &&
                (aggregate.lastBucketAt === null ||
                    bucket > aggregate.lastBucketAt)
            ) {
                aggregate.lastBucketAt = bucket;
            }
            aggregates.set(source.id, aggregate);
        }
    }
    return policy.sources.map((source) => {
        const aggregate = aggregates.get(source.id);
        return {
            sourceId: source.id,
            energyKwh: aggregate ? aggregate.energyWh / 1000 : null,
            lastBucketAt: aggregate?.lastBucketAt ?? null
        };
    });
}

function invertDeviceIds(
    internalIdByDeviceId: ReadonlyMap<string, number>
): ReadonlyMap<number, string> {
    return new Map(
        [...internalIdByDeviceId].map(([deviceId, internalId]) => [
            internalId,
            deviceId
        ])
    );
}

function energySourceKey(
    deviceId: string,
    channel: number,
    tag: string
): string {
    return `${deviceId}\u0000${channel}\u0000${tag}`;
}

function timeChunks(from: Date, to: Date): Array<{from: Date; to: Date}> {
    const chunks: Array<{from: Date; to: Date}> = [];
    for (
        let start = from.getTime();
        start < to.getTime();
        start += OPERATIONAL_QUERY_CHUNK_MS
    ) {
        chunks.push({
            from: new Date(start),
            to: new Date(
                Math.min(start + OPERATIONAL_QUERY_CHUNK_MS, to.getTime())
            )
        });
    }
    return chunks;
}

function assertOperationalRowsBounded(rowCount: number): void {
    if (rowCount <= MAX_OPERATIONAL_ROWS_PER_CHUNK) return;
    throw RpcError.OperationFailed('operations history row limit');
}

async function italiaHotWaterReadings(
    orgId: string,
    policy: ItaliaHotWaterPolicy,
    current: CurrentSourceResolution,
    period: {from: Date; to: Date}
): Promise<ReadonlyMap<string, readonly ItaliaHotWaterReading[]>> {
    const groups = new Map<
        string,
        {
            kind: string;
            source: string;
            blocks: ItaliaHotWaterPolicy['blocks'][number][];
        }
    >();
    for (const block of policy.blocks) {
        const key = `${block.kind}\u0000${block.source}`;
        const group = groups.get(key) ?? {
            kind: block.kind,
            source: block.source,
            blocks: []
        };
        group.blocks.push(block);
        groups.set(key, group);
    }
    const repo = await defaultSensorRepository();
    const readings = new Map<string, ItaliaHotWaterReading[]>();
    for (const group of groups.values()) {
        const blockBySource = new Map<string, string>();
        const internalIds: number[] = [];
        for (const block of group.blocks) {
            const internalId = current.internalIdByDeviceId.get(block.deviceId);
            if (internalId === undefined) continue;
            internalIds.push(internalId);
            blockBySource.set(
                sensorSourceKey(internalId, block.source, block.channel),
                block.blockId
            );
        }
        for (const chunk of timeChunks(period.from, period.to)) {
            const rows = await repo.queryNumeric({
                organizationId: orgId,
                internalIds: [...new Set(internalIds)],
                kind: group.kind,
                source: group.source,
                from: chunk.from,
                to: chunk.to,
                bucket: '15 minutes'
            });
            assertOperationalRowsBounded(rows.length);
            for (const row of rows) {
                if (row.channel === null) continue;
                const blockId = blockBySource.get(
                    sensorSourceKey(row.device_id, row.source, row.channel)
                );
                const valueC = Number(row.avg_value);
                const minimumC = Number(row.min_value);
                const observedAt = new Date(row.bucket);
                if (
                    blockId === undefined ||
                    !Number.isFinite(valueC) ||
                    !Number.isFinite(minimumC) ||
                    !Number.isFinite(observedAt.getTime())
                )
                    continue;
                const blockReadings = readings.get(blockId) ?? [];
                blockReadings.push({
                    observedAt: observedAt.toISOString(),
                    valueC,
                    minimumC
                });
                readings.set(blockId, blockReadings);
            }
        }
    }
    return readings;
}

async function coldChainRecordReadings(
    orgId: string,
    policy: ColdChainRecordPolicy,
    current: CurrentSourceResolution,
    now: Date
): Promise<ColdChainRecordReading[]> {
    const groups = new Map<
        string,
        {
            kind: string;
            source: string;
            sources: ColdChainRecordPolicy['sources'];
        }
    >();
    for (const source of policy.sources) {
        const key = `${source.kind}\u0000${source.source}`;
        const group = groups.get(key) ?? {
            kind: source.kind,
            source: source.source,
            sources: []
        };
        group.sources.push(source);
        groups.set(key, group);
    }
    const today = localDateString(now, policy.timeZone);
    const from = localMidnightToUtc(
        dateParts(shiftDate(today, -1)),
        policy.timeZone
    );
    const repo = await defaultSensorRepository();
    const readings: ColdChainRecordReading[] = [];
    for (const group of groups.values()) {
        const sourceByKey = new Map<string, string>();
        const internalIds: number[] = [];
        for (const source of group.sources) {
            const internalId = current.internalIdByDeviceId.get(
                source.deviceId
            );
            if (internalId === undefined) continue;
            internalIds.push(internalId);
            sourceByKey.set(
                sensorSourceKey(internalId, source.source, source.channel),
                source.id
            );
        }
        for (const chunk of timeChunks(from, now)) {
            const rows = await repo.queryNumeric({
                organizationId: orgId,
                internalIds: [...new Set(internalIds)],
                kind: group.kind,
                source: group.source,
                from: chunk.from,
                to: chunk.to,
                bucket: '15 minutes',
                limit: MAX_OPERATIONAL_ROWS_PER_CHUNK + 1,
                offset: 0
            });
            assertOperationalRowsBounded(rows.length);
            for (const row of rows) {
                if (row.channel === null) continue;
                const sourceId = sourceByKey.get(
                    sensorSourceKey(row.device_id, row.source, row.channel)
                );
                const temperatureC = Number(row.avg_value);
                const observedAt = new Date(row.bucket);
                if (
                    sourceId === undefined ||
                    !Number.isFinite(temperatureC) ||
                    !Number.isFinite(observedAt.getTime())
                )
                    continue;
                readings.push({sourceId, observedAt, temperatureC});
            }
        }
    }
    return readings;
}

async function italiaPoolMeasuredReadings(
    orgId: string,
    policy: ItaliaPoolChemistryPolicy,
    current: CurrentSourceResolution,
    fromDate: string,
    toDate: string
): Promise<ReadonlyMap<string, readonly ItaliaPoolRegisterReading[]>> {
    const groups = new Map<
        string,
        {
            kind: string;
            source: string;
            sources: ItaliaPoolChemistryPolicy['sources'][number][];
        }
    >();
    for (const source of policy.sources) {
        const key = `${source.kind}\u0000${source.source}`;
        const group = groups.get(key) ?? {
            kind: source.kind,
            source: source.source,
            sources: []
        };
        group.sources.push(source);
        groups.set(key, group);
    }
    const period = {
        from: localMidnightToUtc(dateParts(fromDate), policy.timeZone),
        to: localMidnightToUtc(dateParts(shiftDate(toDate, 1)), policy.timeZone)
    };
    const repository = await defaultSensorRepository();
    const readings = new Map<string, ItaliaPoolRegisterReading[]>();
    for (const group of groups.values()) {
        const sourceByKey = new Map<
            string,
            ItaliaPoolChemistryPolicy['sources'][number]
        >();
        const internalIds: number[] = [];
        for (const source of group.sources) {
            const internalId = current.internalIdByDeviceId.get(
                source.deviceId
            );
            if (internalId === undefined) continue;
            internalIds.push(internalId);
            sourceByKey.set(
                sensorSourceKey(internalId, source.source, source.channel),
                source
            );
        }
        for (const chunk of timeChunks(period.from, period.to)) {
            const rows = await repository.queryNumeric({
                organizationId: orgId,
                internalIds: [...new Set(internalIds)],
                kind: group.kind,
                source: group.source,
                from: chunk.from,
                to: chunk.to,
                bucket: '1 day'
            });
            assertOperationalRowsBounded(rows.length);
            for (const row of rows) {
                if (row.channel === null) continue;
                const source = sourceByKey.get(
                    sensorSourceKey(row.device_id, row.source, row.channel)
                );
                // A make-up meter is an odometer, so its daily average was never reported by the device.
                const value = Number(
                    source?.entry === 'makeUpWaterMeter'
                        ? row.max_value
                        : row.avg_value
                );
                const observedAt = new Date(row.bucket);
                if (
                    !source ||
                    !Number.isFinite(value) ||
                    !Number.isFinite(observedAt.getTime())
                ) {
                    continue;
                }
                const date = localDateString(observedAt, policy.timeZone);
                const day = readings.get(date) ?? [];
                day.push({
                    entry: source.entry,
                    value,
                    source: 'measured',
                    acceptedAt: null,
                    acceptedBy: null
                });
                readings.set(date, day);
            }
        }
    }
    return readings;
}

function registerRowReading(
    row: ItaliaPoolRegisterRow
): ItaliaPoolRegisterReading {
    return {
        entry: row.entry as ItaliaPoolRegisterEntryId,
        value: row.value,
        source: 'entered',
        acceptedAt: row.acceptedAt,
        acceptedBy: row.acceptedBy
    };
}

function registerDates(from: string, to: string): string[] {
    if (!calendarDate(from) || !calendarDate(to) || from > to) {
        throw RpcError.InvalidParams('invalid Italia pool register date range');
    }
    const dates: string[] = [];
    for (let date = from; date <= to; date = shiftDate(date, 1)) {
        dates.push(date);
        if (dates.length > 366) {
            throw RpcError.InvalidParams(
                'Italia pool register range cannot exceed 366 days'
            );
        }
    }
    return dates;
}

function calendarDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
    );
}

function shiftDate(value: string, days: number): string {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
}

function dateParts(value: string): {year: number; month: number; day: number} {
    const [year, month, day] = value.split('-').map(Number);
    return {year, month, day};
}

function localDateString(value: Date, timeZone: string): string {
    const local = dateInZone(value, timeZone);
    return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

function sensorSourceKey(
    internalId: number,
    source: string,
    channel: number
): string {
    return `${internalId}\u0000${source}\u0000${channel}`;
}

async function assertSourcesOwned(
    orgId: string,
    sources: readonly {deviceId: string}[],
    locationId?: number
): Promise<void> {
    if (locationId !== undefined) await assertLocationOwned(orgId, locationId);
    const owned = new Set(
        await resolveScopeShellyIDs(
            orgId,
            locationId === undefined ? 'fleet' : 'location',
            locationId ?? null
        )
    );
    if (sources.some((source) => !owned.has(source.deviceId))) {
        throw RpcError.InvalidParams(
            locationId === undefined
                ? 'policy source device is outside the organization'
                : 'policy source device is outside the configured location'
        );
    }
}

async function assertLocationOwned(
    orgId: string,
    locationId: number
): Promise<void> {
    const result = await postgres.callMethod('organization.fn_location_get', {
        p_organization_id: orgId,
        p_id: locationId,
        p_include_summary: false
    });
    if (!result?.rows?.length)
        throw RpcError.InvalidParams(
            'policy location is outside the organization'
        );
}

async function assertItaliaSitePowerSource(
    orgId: string,
    policy: ItaliaSitePowerPolicy
): Promise<void> {
    await assertLocationOwned(orgId, policy.siteId);
    const meter = (await listLogicalMeters(orgId)).find(
        (item) => item.id === policy.meterId
    );
    if (
        !meter ||
        meter.locationId !== policy.siteId ||
        meter.utilityType !== 'electric' ||
        meter.aggregationMode === 'formula' ||
        meter.points.length === 0
    ) {
        throw RpcError.InvalidParams(
            'site-power source must be a physical electric logical meter assigned to the configured site'
        );
    }
}

async function assertItaliaBreakerSource(
    orgId: string,
    policy: ItaliaBreakerTripPolicy
): Promise<void> {
    await assertLocationOwned(orgId, policy.pitchId);
    if (
        !(await logicalDeviceShellyId(
            orgId,
            policy.pitchId,
            policy.logicalDeviceId
        ))
    ) {
        throw RpcError.InvalidParams(
            'breaker source device is outside the configured pitch'
        );
    }
}

async function assertPoolPolicyMatches(
    orgId: string,
    siteId: number,
    poolId: string
): Promise<void> {
    const policy = (await policiesFor(orgId)).italiaPoolChemistry.find(
        (item) => item.poolId === poolId && item.siteId === siteId
    );
    if (!policy) {
        throw RpcError.InvalidParams(
            'Italia pool register entry requires a matching Fleet policy'
        );
    }
}

function validateItaliaPoolChemistryPolicy(
    policy: ItaliaPoolChemistryPolicy
): void {
    const bandEntries = policy.bands.map((band) => band.entry);
    const sourceEntries = policy.sources.map((source) => source.entry);
    const validBands = policy.bands.every(
        (band) =>
            (band.min === null || Number.isFinite(band.min)) &&
            (band.max === null || Number.isFinite(band.max)) &&
            (band.min !== null || band.max !== null) &&
            (band.min === null || band.max === null || band.min <= band.max)
    );
    if (
        !validTimeZone(policy.timeZone) ||
        !validMonthDay(policy.seasonOpenMonthDay) ||
        !validMonthDay(policy.seasonCloseMonthDay) ||
        policy.seasonOpenMonthDay > policy.seasonCloseMonthDay ||
        new Set(bandEntries).size !== bandEntries.length ||
        new Set(sourceEntries).size !== sourceEntries.length ||
        !validBands
    ) {
        throw RpcError.InvalidParams('invalid Italia pool chemistry policy');
    }
}

function validateItaliaPoolRegisterWrite(write: ItaliaPoolRegisterWrite): void {
    const numeric = new Set<ItaliaPoolRegisterEntryId>([
        'freeChlorine',
        'combinedChlorine',
        'temperature',
        'ph',
        'makeUpWaterMeter',
        'bathers'
    ]);
    if (numeric.has(write.entry)) {
        if (
            typeof write.value !== 'number' ||
            !Number.isFinite(write.value) ||
            write.value < 0 ||
            (write.entry === 'bathers' && !Number.isInteger(write.value))
        ) {
            throw RpcError.InvalidParams('invalid Italia pool register value');
        }
        return;
    }
    if (typeof write.value !== 'string' || write.value.trim().length === 0) {
        throw RpcError.InvalidParams('invalid Italia pool register value');
    }
    if (write.entry === 'samplingDate' && !calendarDate(write.value)) {
        throw RpcError.InvalidParams('invalid Italia pool sampling date');
    }
}

function validateItaliaHotWaterPolicy(policy: ItaliaHotWaterPolicy): void {
    const blockIds = policy.blocks.map((block) => block.blockId);
    const sourceKeys = policy.blocks.map(
        (block) =>
            `${block.deviceId}:${block.kind}:${block.source}:${block.channel}`
    );
    if (
        !validTimeZone(policy.timeZone) ||
        policy.blocks.length > OPERATIONAL_POLICY_MAX_SOURCES ||
        new Set(blockIds).size !== blockIds.length ||
        new Set(sourceKeys).size !== sourceKeys.length
    ) {
        throw RpcError.InvalidParams('invalid Italia hot-water policy');
    }
}

function validateItaliaNightFlowPolicy(policy: ItaliaNightFlowPolicy): void {
    const quietMinutes = (policy.quietEndHour - policy.quietStartHour) * 60;
    const sources = policy.zones.flatMap((zone) => zone.sources);
    if (
        !validTimeZone(policy.timeZone) ||
        !validMonthDay(policy.seasonOpenMonthDay) ||
        !validMonthDay(policy.seasonCloseMonthDay) ||
        policy.quietStartHour >= policy.quietEndHour ||
        policy.sustainedMinutes < 15 ||
        policy.sustainedMinutes > quietMinutes ||
        sources.length > OPERATIONAL_POLICY_MAX_SOURCES ||
        sources.some(
            (source) =>
                !operationEnergyTagAllowed('italiaNightFlow', source.tag)
        )
    ) {
        throw RpcError.InvalidParams('invalid Italia night-flow policy');
    }
    const zoneIds = policy.zones.map((zone) => zone.zoneId);
    const sourceKeys = sources.map(
        (source) => `${source.deviceId}:${source.channel}:${source.tag}`
    );
    if (
        new Set(zoneIds).size !== zoneIds.length ||
        new Set(sourceKeys).size !== sourceKeys.length
    ) {
        throw RpcError.InvalidParams(
            'Italia night-flow zones and sources must be unique'
        );
    }
}

function validateItaliaPitchPolicy(policy: ItaliaPitchPolicy): void {
    if (
        !Number.isFinite(policy.ratedAmps) ||
        !Number.isFinite(policy.warningFraction) ||
        !Number.isFinite(policy.overloadFraction) ||
        policy.warningFraction > 1 ||
        policy.overloadFraction < 1 ||
        policy.warningFraction > policy.overloadFraction
    ) {
        throw RpcError.InvalidParams('invalid Italia pitch policy');
    }
}

function validateItaliaSitePowerPolicy(policy: ItaliaSitePowerPolicy): void {
    if (
        !Number.isFinite(policy.contractedKw) ||
        policy.contractedKw <= 0 ||
        !Number.isFinite(policy.availableMarginFraction) ||
        policy.availableMarginFraction < 0 ||
        policy.availableMarginFraction > 1 ||
        !Number.isFinite(policy.warningFraction) ||
        policy.warningFraction <= 0 ||
        policy.warningFraction > 1 ||
        !Number.isInteger(policy.disconnectAfterSeconds) ||
        policy.disconnectAfterSeconds <= 0 ||
        !Number.isInteger(policy.freshnessSeconds) ||
        policy.freshnessSeconds <= 0
    ) {
        throw RpcError.InvalidParams('invalid Italia site-power policy');
    }
}

function validateItaliaBreakerTripPolicy(
    policy: ItaliaBreakerTripPolicy
): void {
    if (
        !Number.isInteger(policy.pitchId) ||
        policy.pitchId <= 0 ||
        !Number.isInteger(policy.logicalDeviceId) ||
        policy.logicalDeviceId <= 0 ||
        policy.component.length === 0 ||
        policy.counterField.length === 0 ||
        !Number.isInteger(policy.windowDays) ||
        policy.windowDays <= 0 ||
        policy.windowDays > 30
    ) {
        throw RpcError.InvalidParams('invalid Italia breaker-trip policy');
    }
}

function validTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en', {timeZone}).format();
        return true;
    } catch {
        return false;
    }
}

function validMonthDay(monthDay: string): boolean {
    const match = /^(\d{2})-(\d{2})$/.exec(monthDay);
    if (!match) return false;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const date = new Date(Date.UTC(2000, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function nightFlowSamples(
    policy: ItaliaNightFlowPolicy,
    current: CurrentSourceResolution,
    now: Date
) {
    const repo = await defaultEnergyRepository();
    const sources = policy.zones.flatMap((zone) => zone.sources);
    if (sources.length > OPERATIONAL_POLICY_MAX_SOURCES) return [];
    const sourceZone = new Map<string, number>();
    const expectedByZone = new Map<number, number>();
    for (const zone of policy.zones) {
        const keys = zone.sources.flatMap((source) => {
            const internalId = current.internalIdByDeviceId.get(
                source.deviceId
            );
            return internalId === undefined
                ? []
                : [
                      operationalSourceKey(
                          internalId,
                          source.channel,
                          source.tag
                      )
                  ];
        });
        if (keys.length !== zone.sources.length) continue;
        expectedByZone.set(zone.zoneId, keys.length);
        for (const key of keys) sourceZone.set(key, zone.zoneId);
    }
    const states = new Map<
        number,
        {
            day: string | null;
            readings: ItaliaNightFlowReading[];
            samples: Array<{
                zoneId: number;
                day: string;
                minimumM3h: number | null;
                siteOpen: boolean;
            }>;
        }
    >();
    const finishDay = (zoneId: number): void => {
        const state = states.get(zoneId);
        if (!state || state.day === null) return;
        state.samples.push({
            zoneId,
            day: state.day,
            minimumM3h: sustainedMinimumM3h(
                state.readings,
                policy.sustainedMinutes
            ),
            siteOpen: siteOpenOn(state.day, policy)
        });
        state.day = null;
        state.readings = [];
    };
    const finishBucket = (
        observedAt: string,
        buckets: ReadonlyMap<number, {sources: number; totalM3h: number}>
    ): void => {
        const local = localNightParts(new Date(observedAt), policy.timeZone);
        if (
            local.hour < policy.quietStartHour ||
            local.hour >= policy.quietEndHour
        )
            return;
        for (const [zoneId, bucket] of buckets) {
            if (bucket.sources !== expectedByZone.get(zoneId)) continue;
            const state = states.get(zoneId) ?? {
                day: null,
                readings: [],
                samples: []
            };
            states.set(zoneId, state);
            if (state.day !== null && state.day !== local.day)
                finishDay(zoneId);
            state.day = local.day;
            state.readings.push({observedAt, flowM3h: bucket.totalM3h});
        }
    };
    const from = new Date(
        now.getTime() -
            (policy.minimumBaselineSamples + 2) * OPERATIONAL_QUERY_CHUNK_MS
    );
    const internalIds = [...current.internalIdByDeviceId.values()];
    for (const chunk of timeChunks(from, now)) {
        const rows = await repo.queryOperationalMetric15minByChannel({
            internalIds,
            from: chunk.from,
            to: chunk.to,
            tags: [...new Set(sources.map((source) => source.tag))],
            commodity: 'water'
        });
        assertOperationalRowsBounded(rows.length);
        let observedAt: string | null = null;
        let buckets = new Map<number, {sources: number; totalM3h: number}>();
        for (const row of rows) {
            const rowObservedAt = new Date(row.bucket).toISOString();
            if (observedAt !== null && rowObservedAt !== observedAt) {
                finishBucket(observedAt, buckets);
                buckets = new Map();
            }
            observedAt = rowObservedAt;
            const zoneId = sourceZone.get(
                operationalSourceKey(row.device, row.channel, row.tag)
            );
            const value = Number(row.value);
            if (zoneId === undefined || !Number.isFinite(value)) continue;
            const bucket = buckets.get(zoneId) ?? {
                sources: 0,
                totalM3h: 0
            };
            bucket.sources += 1;
            bucket.totalM3h += value;
            buckets.set(zoneId, bucket);
        }
        if (observedAt !== null) finishBucket(observedAt, buckets);
    }
    for (const zoneId of states.keys()) finishDay(zoneId);
    return policy.zones.flatMap(
        (zone) => states.get(zone.zoneId)?.samples ?? []
    );
}

function operationalSourceKey(
    device: number | undefined,
    channel: number,
    tag: string
): string {
    return `${device ?? 'missing'}:${channel}:${tag}`;
}

async function italiaPitchReadings(
    policy: ItaliaPitchPolicy,
    current: CurrentSourceResolution,
    now: Date
) {
    const repo = await defaultEnergyRepository();
    const internalId = current.internalIdByDeviceId.get(policy.deviceId);
    const historical =
        internalId === undefined
            ? []
            : await repo.queryCurrentHistoryByChannel({
                  internalId,
                  channel: policy.channel,
                  from: new Date(
                      now.getTime() -
                          (policy.disconnectAfterSeconds +
                              policy.freshnessSeconds) *
                              1000
                  ),
                  to: now
              });
    const readings = historical.map((row) => ({
        observedAt: new Date(row.observed_at).toISOString(),
        amps: Number(row.amps)
    }));
    const device = current.deviceIds.has(policy.deviceId)
        ? DeviceCollector.getDevice(policy.deviceId)
        : undefined;
    const live = device
        ? channelValue(
              device.toJSON().status,
              `${policy.component}:${policy.channel}.current`
          )
        : undefined;
    if (device && typeof live === 'number' && Number.isFinite(live)) {
        readings.push({
            observedAt: new Date(device.lastReportTs).toISOString(),
            amps: live
        });
    }
    return readings;
}

async function italiaSitePowerReading(
    orgId: string,
    policy: ItaliaSitePowerPolicy
): Promise<ItaliaSitePowerReading | undefined> {
    const meter = (await listLogicalMeters(orgId)).find(
        (item) => item.id === policy.meterId
    );
    if (
        !meter ||
        meter.locationId !== policy.siteId ||
        meter.utilityType !== 'electric' ||
        meter.aggregationMode === 'formula' ||
        meter.points.length === 0
    )
        return undefined;
    const repository = await defaultEnergyRepository();
    const {idMap} = repository.resolveFleetDevices();
    const deviceIds = [...new Set(meter.points.map((point) => point.deviceId))];
    const deviceLive = new Map<number, DeviceLive>();
    let observedAt = Number.POSITIVE_INFINITY;
    for (const logicalDeviceId of deviceIds) {
        const shellyId = idMap[logicalDeviceId];
        const device = shellyId
            ? DeviceCollector.getDevice(shellyId)
            : undefined;
        if (!device?.online) return undefined;
        observedAt = Math.min(observedAt, device.lastReportTs);
        deviceLive.set(logicalDeviceId, {
            online: true,
            channels: devicePowerChannels(device)
        });
    }
    if (!Number.isFinite(observedAt)) return undefined;
    const meters: MeterDeviceChannels[] = [
        {
            id: meter.id,
            points: meter.points.map((point) => ({
                deviceId: point.deviceId,
                channel: point.channel
            }))
        }
    ];
    const live = meterLiveWatts(meters, deviceLive);
    return {
        observedAt: new Date(observedAt).toISOString(),
        drawKw: live.total / 1000
    };
}

async function italiaBreakerCounterReadings(
    orgId: string,
    policy: ItaliaBreakerTripPolicy,
    period: {from: Date; to: Date}
): Promise<ItaliaBreakerCounterReading[]> {
    const shellyId = await logicalDeviceShellyId(
        orgId,
        policy.pitchId,
        policy.logicalDeviceId
    );
    if (!shellyId) return [];
    const readings: ItaliaBreakerCounterReading[] = [];
    const pageSize = 10_000;
    let queriedRows = 0;
    for (let offset = 0; ; offset += pageSize) {
        const rows = await queryDeviceEvents({
            organizationId: orgId,
            from: period.from,
            to: period.to,
            shellyIds: [shellyId],
            component: policy.component,
            limit: pageSize,
            offset
        });
        queriedRows += rows.length;
        if (queriedRows > MAX_OPERATIONAL_ROWS_PER_CHUNK)
            throw RpcError.OperationFailed('operations history row limit');
        for (const row of rows) {
            if (row.field !== policy.counterField) continue;
            const observedAt = new Date(row.ts).toISOString();
            readings.push(
                {observedAt, totalCycles: counterValue(row.prev)},
                {observedAt, totalCycles: counterValue(row.next)}
            );
        }
        if (rows.length < pageSize) break;
    }
    const device = DeviceCollector.getDevice(shellyId);
    const live = device
        ? channelValue(
              device.status ?? {},
              `${policy.component}.${policy.counterField}`
          )
        : undefined;
    const totalCycles = counterValue(live);
    if (totalCycles !== null) {
        readings.push({
            observedAt: period.to.toISOString(),
            totalCycles
        });
    }
    return readings;
}

function counterValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
        ? value
        : null;
}

async function logicalDeviceShellyId(
    orgId: string,
    locationId: number,
    logicalDeviceId: number
): Promise<string | undefined> {
    const result = await postgres.callMethod('device.fn_resolve_scope', {
        p_org_id: orgId,
        p_scope_kind: 'location',
        p_scope_id: locationId
    });
    const rows = (result?.rows ?? []) as Array<{
        dev_id?: unknown;
        shelly_id?: unknown;
    }>;
    const row = rows.find(
        (item) =>
            item.dev_id === logicalDeviceId &&
            typeof item.shelly_id === 'string'
    );
    return row && typeof row.shelly_id === 'string' ? row.shelly_id : undefined;
}

function localNightParts(
    instant: Date,
    timezone: string
): {day: string; hour: number} {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(instant);
    const value = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? '';
    return {
        day: `${value('year')}-${value('month')}-${value('day')}`,
        hour: Number(value('hour')) % 24
    };
}

async function operationSelectorCatalog(
    orgId: string,
    sender: CommandSender,
    params: OperationalPolicySelectorCatalogParams
): Promise<OperationalPolicySelectorCatalog> {
    const scope = await readableResourceAllowlistsAsync(sender);
    const locationRows = await postgres.callMethod(
        'organization.fn_location_list',
        {
            p_organization_id: orgId,
            p_parent_id: null,
            p_roots_only: false,
            p_limit: 2147483647,
            p_offset: 0,
            p_allowed_ids: scope.locations,
            p_include_summary: false,
            p_allowed_device_ids: scope.devices,
            p_allowed_group_ids: scope.groups,
            p_allowed_tag_ids: scope.tags,
            p_kind: null,
            p_query: null
        }
    );
    const locations = (
        (locationRows?.rows ?? []) as Array<{
            id?: unknown;
            name?: unknown;
            kind?: unknown;
            parent_location_id?: unknown;
            timezone?: unknown;
        }>
    ).flatMap((row) =>
        typeof row.id === 'number' &&
        typeof row.name === 'string' &&
        typeof row.kind === 'string'
            ? [
                  {
                      id: row.id,
                      name: row.name,
                      kind: row.kind,
                      parentLocationId:
                          typeof row.parent_location_id === 'number'
                              ? row.parent_location_id
                              : null,
                      timeZone:
                          typeof row.timezone === 'string' ? row.timezone : null
                  }
              ]
            : []
    );
    const selectedLocationId = requireAuthorizedCatalogLocation(
        params.locationId,
        locations,
        sender
    );
    const collections = new Set(
        operationSelectorBindings(params.family).map(
            (binding) => binding.collection
        )
    );
    const physicalScopeLocationIds = operationSelectorScopeLocationIds(
        params.family,
        'physicalSources',
        selectedLocationId,
        locations
    );
    const [physical, meters] = await Promise.all([
        collections.has('physicalSources')
            ? operationPhysicalSources(orgId, sender, physicalScopeLocationIds)
            : Promise.resolve([]),
        collections.has('logicalMeters')
            ? listLogicalMeters(orgId)
            : Promise.resolve([])
    ]);
    const sitePowerDeviceIds =
        collections.has('logicalMeters') && selectedLocationId !== undefined
            ? await authorizedOperationLocationDeviceIds(
                  orgId,
                  sender,
                  selectedLocationId
              )
            : new Set<number>();
    return {
        family: params.family,
        locations,
        physicalSources: physical.filter((source) =>
            operationSourceMatchesFamily(params.family, source)
        ),
        logicalMeters:
            collections.has('logicalMeters') && selectedLocationId !== undefined
                ? eligibleSitePowerMeters(
                      meters,
                      selectedLocationId,
                      sitePowerDeviceIds
                  ).map((meter) => ({
                      meterId: meter.id,
                      name: meter.name,
                      locationId: meter.locationId ?? null,
                      utilityType: meter.utilityType,
                      aggregationMode: meter.aggregationMode,
                      pointCount: meter.points.length
                  }))
                : [],
        logicalDevices: collections.has('logicalDevices')
            ? await operationLogicalDevices(orgId, sender, selectedLocationId)
            : [],
        customDeviceRoles: collections.has('customDeviceRoles')
            ? await operationCustomDeviceRoles(
                  orgId,
                  sender,
                  selectedLocationId
              )
            : []
    };
}

export function operationSelectorScopeLocationIds(
    family: OperationalPolicyFamily,
    collection: OperationalPolicySelectorBinding['collection'],
    selectedLocationId: number | undefined,
    locations: ReadonlyArray<{id: number; parentLocationId: number | null}>
): number[] | undefined {
    if (selectedLocationId === undefined) return undefined;
    const binding = operationSelectorBindings(family).find(
        (candidate) => candidate.collection === collection
    );
    if (binding?.locationRelation !== 'selected-or-parent')
        return [selectedLocationId];
    const parentLocationId = locations.find(
        (location) => location.id === selectedLocationId
    )?.parentLocationId;
    return parentLocationId === null || parentLocationId === undefined
        ? [selectedLocationId]
        : [selectedLocationId, parentLocationId];
}

async function authorizedOperationLocationDeviceIds(
    orgId: string,
    sender: CommandSender,
    locationId: number
): Promise<Set<number>> {
    const resolved = await postgres.callMethod('device.fn_resolve_scope', {
        p_org_id: orgId,
        p_scope_kind: 'location',
        p_scope_id: locationId
    });
    const candidates = (
        (resolved?.rows ?? []) as Array<{
            dev_id?: unknown;
            shelly_id?: unknown;
        }>
    ).flatMap((row) =>
        typeof row.dev_id === 'number' && typeof row.shelly_id === 'string'
            ? [{id: row.dev_id, shellyId: row.shelly_id}]
            : []
    );
    return new Set(
        (await filterAuthorizedOperationCatalogDevices(sender, candidates)).map(
            (device) => device.id
        )
    );
}

export function operationSourceMatchesFamily(
    family: OperationalPolicyFamily,
    source: OperationalPhysicalSourceChoice
): boolean {
    if (source.sourceType === 'energy')
        return operationEnergyTagAllowed(family, source.tag);
    if (
        family === 'coldChain' ||
        family === 'italiaPoolChemistry' ||
        family === 'italiaHotWater'
    )
        return source.sourceType === 'numeric';
    if (family === 'irrigation')
        return source.sourceType === 'numeric' || source.sourceType === 'event';
    return family === 'italiaPitch' && source.sourceType === 'switchCurrent';
}

export function operationEnergyTagAllowed(
    family: OperationalPolicyFamily,
    tag: string
): boolean {
    if (family === 'refrigeration') return tag === 'total_act_energy';
    if (family === 'pv')
        return tag === 'total_act_energy' || tag === 'total_act_ret_energy';
    return family === 'italiaNightFlow' && tag === 'volume_flow_m3h';
}

async function operationPhysicalSources(
    orgId: string,
    sender: CommandSender,
    locationIds?: readonly number[]
): Promise<OperationalPhysicalSourceChoice[]> {
    const scopeLocationIds = locationIds ?? [null];
    const resolvedScopes = await Promise.all(
        scopeLocationIds.map((locationId) =>
            postgres.callMethod('device.fn_resolve_scope', {
                p_org_id: orgId,
                p_scope_kind: locationId === null ? 'fleet' : 'location',
                p_scope_id: locationId
            })
        )
    );
    const candidateMap = new Map<number, {id: number; shellyId: string}>();
    for (const resolved of resolvedScopes) {
        for (const row of (resolved?.rows ?? []) as Array<{
            dev_id?: unknown;
            shelly_id?: unknown;
        }>) {
            if (
                typeof row.dev_id === 'number' &&
                typeof row.shelly_id === 'string'
            )
                candidateMap.set(row.dev_id, {
                    id: row.dev_id,
                    shellyId: row.shelly_id
                });
        }
    }
    const candidates = [...candidateMap.values()];
    const devices = await filterAuthorizedOperationCatalogDevices(
        sender,
        candidates
    );
    const byInternalId = new Map(
        devices.map((device) => [device.id, device.shellyId])
    );
    const history = await (
        await defaultEnergyRepository()
    ).listMeasurementPointHistory(devices.map((device) => device.id));
    const historyByDevice = new Map<number, typeof history>();
    for (const row of history)
        historyByDevice.set(row.device, [
            ...(historyByDevice.get(row.device) ?? []),
            row
        ]);
    const choices: OperationalPhysicalSourceChoice[] = [];
    for (const device of devices) {
        const current = DeviceCollector.getDevice(device.shellyId);
        const deviceLabel = operationDeviceLabel(
            device.shellyId,
            current?.info
        );
        const points = mergeMeasurementPoints({
            deviceId: device.id,
            shellyID: device.shellyId,
            history: (historyByDevice.get(device.id) ?? []).map((row) => ({
                channel: row.channel,
                phase: row.phase as 'a' | 'b' | 'c' | 'z',
                tag: row.tag as EnergyTag,
                electricalDomain: row.domain as EnergyDomain,
                sampleValue: row.sum_val,
                sampleTs: row.sample_ts
            })),
            live: current
                ? deviceMeasurementPoints({status: current.status})
                : []
        });
        for (const point of points)
            choices.push({
                sourceType: 'energy',
                deviceId: device.shellyId,
                label: operationSourceLabel(
                    deviceLabel,
                    [point.componentKey, `channel ${point.channel}`, point.tag]
                        .filter((part): part is string => part !== null)
                        .join(' · ')
                ),
                locationId: locationIds?.[0] ?? null,
                component: point.componentKey,
                channel: point.channel,
                tag: point.tag
            });
        if (current) {
            for (const power of devicePowerChannels(current)) {
                const match = /^switch:(\d+)$/.exec(power.componentKey);
                if (match)
                    choices.push({
                        sourceType: 'switchCurrent',
                        deviceId: device.shellyId,
                        label: operationSourceLabel(
                            deviceLabel,
                            `switch · channel ${match[1]}`
                        ),
                        locationId: locationIds?.[0] ?? null,
                        component: 'switch',
                        channel: Number(match[1])
                    });
            }
        }
    }
    const sensorRows = await (
        await defaultSensorRepository()
    ).listOperationSourceCatalog({
        organizationId: orgId,
        internalIds: devices.map((device) => device.id)
    });
    for (const row of sensorRows) {
        const deviceId = byInternalId.get(row.device_id);
        if (!deviceId) continue;
        choices.push({
            sourceType: row.source_type,
            deviceId,
            label: operationSourceLabel(
                operationDeviceLabel(
                    deviceId,
                    DeviceCollector.getDevice(deviceId)?.info
                ),
                `${row.kind} · ${row.source} · channel ${row.channel}`
            ),
            locationId: locationIds?.[0] ?? null,
            kind: row.kind,
            source: row.source,
            channel: row.channel
        });
    }
    return dedupeSelectorSources(choices);
}

function dedupeSelectorSources(
    choices: readonly OperationalPhysicalSourceChoice[]
): OperationalPhysicalSourceChoice[] {
    const unique = new Map<string, OperationalPhysicalSourceChoice>();
    for (const choice of choices) unique.set(JSON.stringify(choice), choice);
    return [...unique.values()];
}

async function operationLogicalDevices(
    orgId: string,
    sender: CommandSender,
    locationId?: number
) {
    if (locationId === undefined) return [];
    const scopedIds = await resolveScopeShellyIDs(
        orgId,
        'location',
        locationId
    );
    const accessible = await sender.filterAccessibleDevices(scopedIds);
    const shellyIds = scopedIds.filter((id) => accessible.has(id));
    const counters = await listOperationCounterCatalog({
        organizationId: orgId,
        shellyIds
    });
    const byShelly = new Map<string, Map<string, string[]>>();
    for (const counter of counters) {
        const components =
            byShelly.get(counter.shelly_id) ?? new Map<string, string[]>();
        components.set(counter.component, [
            ...(components.get(counter.component) ?? []),
            counter.counter_field
        ]);
        byShelly.set(counter.shelly_id, components);
    }
    const resolved = await postgres.callMethod('device.fn_resolve_scope', {
        p_org_id: orgId,
        p_scope_kind: 'location',
        p_scope_id: locationId
    });
    return (
        (resolved?.rows ?? []) as Array<{dev_id?: unknown; shelly_id?: unknown}>
    ).flatMap((row) => {
        if (
            typeof row.dev_id !== 'number' ||
            typeof row.shelly_id !== 'string' ||
            !accessible.has(row.shelly_id)
        )
            return [];
        const components = byShelly.get(row.shelly_id);
        if (!components) return [];
        const logicalDeviceId = row.dev_id;
        const deviceId = row.shelly_id;
        return [...components].flatMap(([component, counterFields]) =>
            [...new Set(counterFields)].sort().map((counterField) => ({
                logicalDeviceId,
                deviceId,
                label: operationSourceLabel(
                    operationDeviceLabel(
                        deviceId,
                        DeviceCollector.getDevice(deviceId)?.info
                    ),
                    `${component}.${counterField}`
                ),
                locationId,
                component,
                counterField
            }))
        );
    });
}

async function operationCustomDeviceRoles(
    orgId: string,
    sender: CommandSender,
    locationId?: number
) {
    if (locationId === undefined) return [];
    const devices = (await listVirtualDevices(orgId, {limit: 0})).items.filter(
        (device) => device.locationId === locationId
    );
    const accessible = await sender.filterAccessibleDevices(
        devices.map((device) => device.externalId)
    );
    const readable = devices.filter((device) =>
        accessible.has(device.externalId)
    );
    if (readable.length === 0) return [];
    const bindings = await loadActiveVirtualDeviceBindings({
        organizationId: orgId,
        deviceListIds: readable.map((device) => device.deviceListId)
    });
    return readable.flatMap((device) => {
        return (bindings.get(device.deviceListId) ?? []).map((binding) => ({
            customDeviceId: device.externalId,
            deviceName: device.name,
            locationId: device.locationId,
            roleKey: binding.roleKey,
            label: `${device.name} · ${binding.roleKey}`,
            valueType: catalogRoleValueType(binding.valueType)
        }));
    });
}

export function catalogRoleValueType(
    valueType: string | null
): OperationalCustomDeviceRoleChoice['valueType'] {
    if (
        valueType === 'boolean' ||
        valueType === 'number' ||
        valueType === 'string' ||
        valueType === 'event' ||
        valueType === 'json'
    ) {
        return valueType;
    }
    return null;
}

function siteOpenOn(day: string, policy: ItaliaNightFlowPolicy): boolean {
    const monthDay = day.slice(5);
    if (policy.seasonOpenMonthDay <= policy.seasonCloseMonthDay)
        return (
            monthDay >= policy.seasonOpenMonthDay &&
            monthDay <= policy.seasonCloseMonthDay
        );
    return (
        monthDay >= policy.seasonOpenMonthDay ||
        monthDay <= policy.seasonCloseMonthDay
    );
}

function channelValue(
    status: Record<string, unknown>,
    channel: string
): unknown {
    let value: unknown = status;
    for (const key of channel.split('.')) {
        if (!isRecord(value) || !(key in value)) return undefined;
        value = value[key];
    }
    return value;
}

function readPolicies(
    metadata: Record<string, unknown>
): OperationalVerdictPolicies {
    const value = metadata[METADATA_KEY];
    if (!isRecord(value))
        return {
            refrigeration: [],
            coldChain: [],
            parking: [],
            irrigation: [],
            pv: [],
            italiaPoolChemistry: [],
            italiaHotWater: [],
            italiaNightFlow: [],
            italiaPitch: [],
            italiaSitePower: [],
            italiaBreakerTrips: []
        };
    return {
        refrigeration: Array.isArray(value.refrigeration)
            ? value.refrigeration.filter(isRefrigerationPolicy)
            : [],
        coldChain: Array.isArray(value.coldChain)
            ? value.coldChain.filter(isColdChainRecordPolicy)
            : [],
        parking: Array.isArray(value.parking)
            ? value.parking.filter(isParkingPolicy)
            : [],
        irrigation: Array.isArray(value.irrigation)
            ? value.irrigation.filter(isIrrigationPolicy)
            : [],
        pv: Array.isArray(value.pv) ? value.pv.filter(isPvHealthPolicy) : [],
        italiaPoolChemistry: [],
        italiaHotWater: Array.isArray(value.italiaHotWater)
            ? value.italiaHotWater.filter(isItaliaHotWaterPolicy)
            : [],
        italiaNightFlow: Array.isArray(value.italiaNightFlow)
            ? value.italiaNightFlow.filter(isItaliaNightFlowPolicy)
            : [],
        italiaPitch: Array.isArray(value.italiaPitch)
            ? value.italiaPitch.filter(isItaliaPitchPolicy)
            : [],
        italiaSitePower: Array.isArray(value.italiaSitePower)
            ? value.italiaSitePower.filter(isItaliaSitePowerPolicy)
            : [],
        italiaBreakerTrips: Array.isArray(value.italiaBreakerTrips)
            ? value.italiaBreakerTrips.filter(isItaliaBreakerTripPolicy)
            : []
    };
}

function isItaliaHotWaterPolicy(value: unknown): value is ItaliaHotWaterPolicy {
    return (
        isRecord(value) &&
        typeof value.siteId === 'number' &&
        typeof value.timeZone === 'string' &&
        typeof value.freshnessSeconds === 'number' &&
        typeof value.maxGapMinutes === 'number' &&
        typeof value.holdMinutes === 'number' &&
        validTimeZone(value.timeZone) &&
        value.freshnessSeconds >= 60 &&
        value.maxGapMinutes > 0 &&
        value.holdMinutes > 0 &&
        Array.isArray(value.blocks) &&
        value.blocks.length > 0 &&
        value.blocks.every(
            (block) =>
                isRecord(block) &&
                typeof block.blockId === 'string' &&
                typeof block.deviceId === 'string' &&
                typeof block.kind === 'string' &&
                typeof block.source === 'string' &&
                typeof block.channel === 'number' &&
                typeof block.limitC === 'number' &&
                Number.isFinite(block.limitC)
        )
    );
}

function isItaliaNightFlowPolicy(
    value: unknown
): value is ItaliaNightFlowPolicy {
    return (
        isRecord(value) &&
        typeof value.siteId === 'number' &&
        typeof value.timeZone === 'string' &&
        typeof value.seasonOpenMonthDay === 'string' &&
        typeof value.seasonCloseMonthDay === 'string' &&
        typeof value.quietStartHour === 'number' &&
        typeof value.quietEndHour === 'number' &&
        typeof value.sustainedMinutes === 'number' &&
        typeof value.minimumBaselineSamples === 'number' &&
        typeof value.madMultiplier === 'number' &&
        typeof value.minimumExcessM3h === 'number' &&
        validTimeZone(value.timeZone) &&
        validMonthDay(value.seasonOpenMonthDay) &&
        validMonthDay(value.seasonCloseMonthDay) &&
        value.quietStartHour < value.quietEndHour &&
        value.sustainedMinutes >= 15 &&
        value.sustainedMinutes <=
            (value.quietEndHour - value.quietStartHour) * 60 &&
        Array.isArray(value.zones) &&
        value.zones.length > 0 &&
        value.zones.every(
            (zone) =>
                isRecord(zone) &&
                typeof zone.zoneId === 'number' &&
                Array.isArray(zone.sources) &&
                zone.sources.length > 0 &&
                zone.sources.every(
                    (source) =>
                        isRecord(source) &&
                        typeof source.deviceId === 'string' &&
                        typeof source.channel === 'number' &&
                        typeof source.tag === 'string'
                )
        )
    );
}

function isItaliaPitchPolicy(value: unknown): value is ItaliaPitchPolicy {
    return (
        isRecord(value) &&
        typeof value.pitchId === 'number' &&
        typeof value.deviceId === 'string' &&
        value.component === 'switch' &&
        typeof value.channel === 'number' &&
        typeof value.ratedAmps === 'number' &&
        typeof value.warningFraction === 'number' &&
        typeof value.overloadFraction === 'number' &&
        typeof value.disconnectAfterSeconds === 'number' &&
        typeof value.freshnessSeconds === 'number' &&
        value.ratedAmps > 0 &&
        value.warningFraction > 0 &&
        value.warningFraction <= 1 &&
        value.overloadFraction >= 1 &&
        value.disconnectAfterSeconds > 0 &&
        value.freshnessSeconds > 0
    );
}

function isItaliaSitePowerPolicy(
    value: unknown
): value is ItaliaSitePowerPolicy {
    return (
        isRecord(value) &&
        typeof value.siteId === 'number' &&
        typeof value.meterId === 'number' &&
        typeof value.contractedKw === 'number' &&
        typeof value.availableMarginFraction === 'number' &&
        typeof value.warningFraction === 'number' &&
        typeof value.disconnectAfterSeconds === 'number' &&
        typeof value.freshnessSeconds === 'number' &&
        value.contractedKw > 0 &&
        value.availableMarginFraction >= 0 &&
        value.availableMarginFraction <= 1 &&
        value.warningFraction > 0 &&
        value.warningFraction <= 1 &&
        value.disconnectAfterSeconds > 0 &&
        value.freshnessSeconds > 0
    );
}

function isItaliaBreakerTripPolicy(
    value: unknown
): value is ItaliaBreakerTripPolicy {
    return (
        isRecord(value) &&
        typeof value.pitchId === 'number' &&
        typeof value.logicalDeviceId === 'number' &&
        typeof value.component === 'string' &&
        typeof value.counterField === 'string' &&
        typeof value.windowDays === 'number' &&
        value.pitchId > 0 &&
        value.logicalDeviceId > 0 &&
        value.component.length > 0 &&
        value.counterField.length > 0 &&
        value.windowDays > 0 &&
        value.windowDays <= 30
    );
}

function isPvHealthPolicy(value: unknown): value is PvHealthPolicy {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.freshnessSec === 'number' &&
        typeof value.periodHours === 'number' &&
        typeof value.minComparableSources === 'number' &&
        typeof value.attentionFraction === 'number' &&
        Array.isArray(value.sources) &&
        value.sources.length > 0 &&
        value.sources.every(
            (source) =>
                isRecord(source) &&
                typeof source.id === 'string' &&
                typeof source.deviceId === 'string' &&
                typeof source.channel === 'number' &&
                typeof source.tag === 'string'
        )
    );
}

function isIrrigationPolicy(value: unknown): value is IrrigationPolicy {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.freshnessSec === 'number' &&
        typeof value.graceSec === 'number' &&
        isIrrigationSchedules(value.schedules) &&
        isIrrigationEventSource(value.valve) &&
        (value.soil === undefined || isIrrigationSkipSource(value.soil)) &&
        (value.rain === undefined || isIrrigationSkipSource(value.rain)) &&
        (value.locationId === undefined || typeof value.locationId === 'number')
    );
}

function isIrrigationSchedules(
    value: unknown
): value is IrrigationPolicy['schedules'] {
    return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(
            (schedule) =>
                isRecord(schedule) &&
                typeof schedule.hour === 'number' &&
                typeof schedule.minute === 'number'
        )
    );
}

function isIrrigationEventSource(
    value: unknown
): value is IrrigationPolicy['valve'] {
    return (
        isRecord(value) &&
        typeof value.deviceId === 'string' &&
        typeof value.channel === 'number' &&
        typeof value.kind === 'string'
    );
}

function isIrrigationSkipSource(value: unknown): value is IrrigationSkipSource {
    return (
        isRecord(value) &&
        typeof value.deviceId === 'string' &&
        typeof value.channel === 'number' &&
        typeof value.kind === 'string' &&
        typeof value.threshold === 'number' &&
        (value.source === undefined || typeof value.source === 'string')
    );
}

function isRefrigerationPolicy(
    value: unknown
): value is RefrigerationPeerPolicy {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.freshnessSec === 'number' &&
        typeof value.thresholdPct === 'number' &&
        typeof value.minPeerCount === 'number' &&
        Array.isArray(value.sources) &&
        value.sources.length > 0 &&
        value.sources.every(
            (source) =>
                isRecord(source) &&
                typeof source.id === 'string' &&
                typeof source.deviceId === 'string' &&
                typeof source.channel === 'number' &&
                typeof source.tag === 'string' &&
                Array.isArray(source.peerGroupIds) &&
                source.peerGroupIds.length > 0 &&
                source.peerGroupIds.every(
                    (peerGroupId) => typeof peerGroupId === 'string'
                )
        ) &&
        (value.locationId === undefined || typeof value.locationId === 'number')
    );
}

function isColdChainRecordPolicy(
    value: unknown
): value is ColdChainRecordPolicy {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.locationId === 'number' &&
        typeof value.timeZone === 'string' &&
        validTimeZone(value.timeZone) &&
        typeof value.freshnessSeconds === 'number' &&
        typeof value.deadlineHour === 'number' &&
        typeof value.retentionDays === 'number' &&
        Array.isArray(value.sources) &&
        value.sources.length > 0 &&
        value.sources.every(
            (source) =>
                isRecord(source) &&
                typeof source.id === 'string' &&
                typeof source.deviceId === 'string' &&
                typeof source.kind === 'string' &&
                typeof source.source === 'string' &&
                typeof source.channel === 'number' &&
                typeof source.evidenceRequired === 'boolean' &&
                (source.maxTemperatureC === null ||
                    typeof source.maxTemperatureC === 'number') &&
                (source.limitBasis === null ||
                    source.limitBasis === 'statutory' ||
                    source.limitBasis === 'industry_practice' ||
                    source.limitBasis === 'custom')
        )
    );
}

function isParkingPolicy(value: unknown): value is ParkingOperationalPolicy {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        typeof value.freshnessSec === 'number' &&
        typeof value.locationId === 'number' &&
        Array.isArray(value.sources) &&
        value.sources.length > 0 &&
        value.sources.every(isParkingSource) &&
        (value.safetySources === undefined ||
            (Array.isArray(value.safetySources) &&
                value.safetySources.length > 0 &&
                value.safetySources.every(isParkingSafetySource)))
    );
}

function isParkingSafetySource(
    value: unknown
): value is NonNullable<ParkingOperationalPolicy['safetySources']>[number] {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.customDeviceId !== 'string' ||
        typeof value.roleKey !== 'string'
    ) {
        return false;
    }
    if (value.kind === 'gas') return value.alarmWhen === undefined;
    return (
        (value.kind === 'smoke' || value.kind === 'flood') &&
        typeof value.alarmWhen === 'boolean'
    );
}

function isParkingSource(
    value: unknown
): value is ParkingOperationalPolicy['sources'][number] {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.customDeviceId !== 'string' ||
        typeof value.roleKey !== 'string'
    ) {
        return false;
    }
    if (value.kind === 'boolean')
        return typeof value.occupiedWhen === 'boolean';
    if (value.kind !== 'distance' || !isRecord(value.calibration)) return false;
    if (value.calibration.mode === 'ratio')
        return (
            typeof value.calibration.mountHeightM === 'number' &&
            typeof value.calibration.occupiedRatio === 'number'
        );
    return (
        value.calibration.mode === 'threshold' &&
        typeof value.calibration.occupiedBelowM === 'number'
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRefrigerationPolicy(policy: RefrigerationPeerPolicy): void {
    if (
        !Number.isFinite(policy.thresholdPct) ||
        policy.thresholdPct <= 0 ||
        !Number.isInteger(policy.minPeerCount) ||
        policy.minPeerCount < 2 ||
        policy.minPeerCount > policy.sources.length ||
        policy.sources.some(
            (source) => !operationEnergyTagAllowed('refrigeration', source.tag)
        )
    ) {
        throw RpcError.InvalidParams(
            'refrigeration peer comparison settings are invalid'
        );
    }
    const ids = policy.sources.map((source) => source.id);
    if (new Set(ids).size !== ids.length)
        throw RpcError.InvalidParams(
            'refrigeration policy source ids must be distinct'
        );
    if (
        policy.sources.some(
            (source) =>
                source.peerGroupIds.length === 0 ||
                new Set(source.peerGroupIds).size !== source.peerGroupIds.length
        )
    ) {
        throw RpcError.InvalidParams(
            'refrigeration peer groups must be non-empty and distinct per source'
        );
    }
    validateDistinctSources(policy.sources);
}

function validateColdChainRecordPolicy(policy: ColdChainRecordPolicy): void {
    if (!validTimeZone(policy.timeZone))
        throw RpcError.InvalidParams('cold-chain timezone is invalid');
    const ids = policy.sources.map((source) => source.id);
    if (new Set(ids).size !== ids.length)
        throw RpcError.InvalidParams(
            'cold-chain policy source ids must be distinct'
        );
    if (
        policy.sources.some(
            (source) =>
                (source.maxTemperatureC === null) !==
                    (source.limitBasis === null) ||
                (source.maxTemperatureC !== null &&
                    !Number.isFinite(source.maxTemperatureC))
        )
    )
        throw RpcError.InvalidParams(
            'cold-chain limits and their basis must be configured together'
        );
    validateDistinctSources(policy.sources);
}

function validateParkingPolicy(policy: ParkingOperationalPolicy): void {
    const allSources = [...policy.sources, ...(policy.safetySources ?? [])];
    if (allSources.length > OPERATIONAL_POLICY_MAX_SOURCES)
        throw RpcError.InvalidParams('parking policy has too many sources');
    const ids = allSources.map((source) => source.id);
    if (new Set(ids).size !== ids.length)
        throw RpcError.InvalidParams(
            'parking policy source ids must be distinct'
        );
    const identities = allSources.map(
        (source) => `${source.customDeviceId}\u0000${source.roleKey}`
    );
    if (new Set(identities).size !== identities.length)
        throw RpcError.InvalidParams('parking policy roles must be distinct');
    for (const source of policy.sources) {
        if (source.kind === 'boolean') continue;
        if (
            source.calibration.mode === 'ratio' &&
            (!Number.isFinite(source.calibration.mountHeightM) ||
                source.calibration.mountHeightM <= 0 ||
                !Number.isFinite(source.calibration.occupiedRatio) ||
                source.calibration.occupiedRatio <= 0 ||
                source.calibration.occupiedRatio > 1)
        ) {
            throw RpcError.InvalidParams(
                'parking distance ratio calibration is invalid'
            );
        }
        if (
            source.calibration.mode === 'threshold' &&
            (!Number.isFinite(source.calibration.occupiedBelowM) ||
                source.calibration.occupiedBelowM <= 0)
        ) {
            throw RpcError.InvalidParams(
                'parking distance threshold calibration is invalid'
            );
        }
    }
}

function validateDistinctSources(
    sources: readonly {deviceId: string; channel: string | number}[]
): void {
    const identities = sources.map(
        (source) => `${source.deviceId}\u0000${source.channel}`
    );
    if (new Set(identities).size !== identities.length)
        throw RpcError.InvalidParams('policy sources must be distinct');
}

async function assertParkingRolesOwned(
    orgId: string,
    sources: readonly (
        | ParkingOperationalPolicy['sources'][number]
        | NonNullable<ParkingOperationalPolicy['safetySources']>[number]
    )[],
    locationId: number
): Promise<void> {
    await assertLocationOwned(orgId, locationId);
    const resolution = await resolveParkingRoleSources(
        orgId,
        locationId,
        sources
    );
    if (resolution.resolvedSourceIds.size !== sources.length) {
        throw RpcError.InvalidParams(
            'parking policy role is outside the configured location or is not bound'
        );
    }
}

async function assertIrrigationSourcesOwned(
    orgId: string,
    policy: IrrigationPolicy
): Promise<void> {
    const sources: OperationalSource[] = [
        {
            deviceId: policy.valve.deviceId,
            channel: String(policy.valve.channel)
        },
        ...(policy.soil
            ? [
                  {
                      deviceId: policy.soil.deviceId,
                      channel: String(policy.soil.channel)
                  }
              ]
            : []),
        ...(policy.rain
            ? [
                  {
                      deviceId: policy.rain.deviceId,
                      channel: String(policy.rain.channel)
                  }
              ]
            : [])
    ];
    validateDistinctSources(sources);
    await assertSourcesOwned(orgId, sources, policy.locationId);
}

function irrigationSourceIds(policy: IrrigationPolicy): string[] {
    return [policy.valve, policy.soil, policy.rain]
        .filter(
            (
                source
            ): source is IrrigationPolicy['valve'] | IrrigationSkipSource =>
                source !== undefined
        )
        .map((source) => source.deviceId);
}

async function irrigationPolicyVerdict(
    orgId: string,
    policy: IrrigationPolicy,
    current: CurrentSourceResolution,
    timezone: string,
    now: Date
): Promise<IrrigationVerdict> {
    const valveDevice = current.deviceIds.has(policy.valve.deviceId)
        ? DeviceCollector.getDevice(policy.valve.deviceId)
        : undefined;
    const valveAvailable = valveDevice !== undefined;
    const valveFresh =
        valveDevice !== undefined &&
        now.getTime() - valveDevice.lastReportTs <= policy.freshnessSec * 1000;
    const dueAt = lastIrrigationDueAt(policy, timezone, now);
    const until = new Date(
        Math.min(now.getTime(), dueAt.getTime() + policy.graceSec * 1000)
    );
    const internalIdFor = (deviceId: string): number | undefined =>
        current.internalIdByDeviceId.get(deviceId);
    const valveId = internalIdFor(policy.valve.deviceId);
    if (valveId === undefined)
        return irrigationVerdict(
            policy,
            timezone,
            unavailableIrrigationHistory(),
            now
        );
    const repo = await defaultSensorRepository();
    const events = await repo.queryEvents({
        organizationId: orgId,
        internalIds: [valveId],
        kind: policy.valve.kind,
        from: dueAt,
        to: until,
        limit: 500
    });
    const completed = events.find(
        (event) => event.channel === policy.valve.channel && event.state === 1
    );
    const [soilValue, rainValue] = await Promise.all([
        irrigationSkipValue(
            repo,
            orgId,
            policy.soil,
            internalIdFor,
            dueAt,
            until
        ),
        irrigationSkipValue(
            repo,
            orgId,
            policy.rain,
            internalIdFor,
            dueAt,
            until
        )
    ]);
    return irrigationVerdict(
        policy,
        timezone,
        {
            valveAvailable,
            valveFresh,
            completedAt: completed ? new Date(completed.ts) : null,
            soilValue,
            rainValue
        },
        now
    );
}

function lastIrrigationDueAt(
    policy: IrrigationPolicy,
    timezone: string,
    now: Date
): Date {
    return latestScheduledOccurrence({
        schedules: policy.schedules,
        timezone,
        now
    });
}

async function irrigationSkipValue(
    repo: Awaited<ReturnType<typeof defaultSensorRepository>>,
    orgId: string,
    source: IrrigationSkipSource | undefined,
    internalIdFor: (deviceId: string) => number | undefined,
    from: Date,
    to: Date
): Promise<number | null> {
    if (!source) return null;
    const internalId = internalIdFor(source.deviceId);
    if (internalId === undefined) return null;
    const rows = await repo.queryNumeric({
        organizationId: orgId,
        internalIds: [internalId],
        kind: source.kind,
        source: source.source ?? null,
        from,
        to,
        bucket: '15 minutes',
        limit: 500
    });
    return maximumChannelValue(rows, source.channel);
}

function maximumChannelValue(
    rows: readonly SensorNumericRow[],
    channel: number
): number | null {
    const values = rows
        .filter((row) => row.channel === channel)
        .map((row) => Number(row.max_value))
        .filter(Number.isFinite);
    return values.length > 0 ? Math.max(...values) : null;
}

function unavailableIrrigationHistory() {
    return {
        valveAvailable: false,
        valveFresh: false,
        completedAt: null,
        soilValue: null,
        rainValue: null
    };
}

function validatePvPolicy(policy: PvHealthPolicy): void {
    if (
        !Number.isFinite(policy.attentionFraction) ||
        policy.attentionFraction <= 0 ||
        policy.attentionFraction > 1 ||
        policy.minComparableSources > policy.sources.length ||
        policy.sources.some(
            (source) => !operationEnergyTagAllowed('pv', source.tag)
        )
    ) {
        throw RpcError.InvalidParams(
            'PV policy comparison settings are invalid'
        );
    }
    const identities = policy.sources.map((source) => source.id);
    if (new Set(identities).size !== identities.length)
        throw RpcError.InvalidParams('PV policy source ids must be distinct');
    const mappings = policy.sources.map(
        (source) =>
            `${source.deviceId}\u0000${source.channel}\u0000${source.tag}`
    );
    if (new Set(mappings).size !== mappings.length)
        throw RpcError.InvalidParams(
            'PV policy source mappings must be distinct'
        );
}

async function pvPolicyVerdict(
    policy: PvHealthPolicy,
    current: CurrentSourceResolution,
    now: Date
): Promise<PvHealthVerdict> {
    const repo = await defaultEnergyRepository();
    const sourceByKey = new Map(
        policy.sources.flatMap((source) => {
            if (!current.deviceIds.has(source.deviceId)) return [];
            return [
                [
                    energySourceKey(
                        source.deviceId,
                        source.channel,
                        source.tag
                    ),
                    source
                ] as const
            ];
        })
    );
    const aggregates = new Map<
        string,
        {generatedWh: number; lastBucketAt: number | null}
    >();
    const from = new Date(now.getTime() - policy.periodHours * 3_600_000);
    const internalIds = [...current.internalIdByDeviceId.values()];
    const deviceIdByInternalId = invertDeviceIds(current.internalIdByDeviceId);
    for (const chunk of timeChunks(from, now)) {
        const rows = await repo.queryEnergy15minByChannel({
            internalIds,
            from: chunk.from,
            to: chunk.to,
            tags: [...new Set(policy.sources.map((source) => source.tag))]
        });
        assertOperationalRowsBounded(rows.length);
        for (const row of rows) {
            const deviceId = deviceIdByInternalId.get(row.device);
            if (!deviceId) continue;
            const source = sourceByKey.get(
                energySourceKey(deviceId, row.channel, row.tag)
            );
            if (!source) continue;
            const aggregate = aggregates.get(source.id) ?? {
                generatedWh: 0,
                lastBucketAt: null
            };
            aggregate.generatedWh += row.energy_wh;
            const bucketAt = Date.parse(row.bucket);
            if (
                Number.isFinite(bucketAt) &&
                (aggregate.lastBucketAt === null ||
                    bucketAt > aggregate.lastBucketAt)
            ) {
                aggregate.lastBucketAt = bucketAt;
            }
            aggregates.set(source.id, aggregate);
        }
    }
    return pvHealthVerdict(
        policy,
        policy.sources.map((source) => {
            const aggregate = aggregates.get(source.id);
            return {
                id: source.id,
                generatedWh: aggregate?.generatedWh ?? null,
                fresh:
                    aggregate?.lastBucketAt !== null &&
                    aggregate?.lastBucketAt !== undefined &&
                    now.getTime() - aggregate.lastBucketAt <=
                        policy.freshnessSec * 1000
            };
        })
    );
}
