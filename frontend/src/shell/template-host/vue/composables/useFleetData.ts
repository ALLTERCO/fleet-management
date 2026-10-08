import type {LocationAssignment} from '@api/location';
import {computed, type Ref} from 'vue';
import type {
    HostAlertActions,
    HostAlertRule,
    HostAlertRuleCreateInput,
    HostAlertRuleKind,
    HostAlertRuleListParams,
    HostAlertRuleUpdateInput,
    HostAlertTimeline,
    HostAuditTimelineParams,
    HostAuditTimelineResult,
    HostCredentialListParams,
    HostCredentialListResult,
    HostDeviceStatusTimelineParams,
    HostDeviceStatusTimelineResult,
    HostEnergyCurrentParams,
    HostEnergyCurrentResult,
    HostEnergyHistoryParams,
    HostEnergyHistoryResult,
    HostFirmwareUpdateStatusParams,
    HostFirmwareUpdateStatusResult,
    HostKindListParams,
    HostKindListResult,
    HostLocation,
    HostLogicalMeterParams,
    HostLogicalMeterResult,
    HostMeterTopologyResult,
    HostResourceQueryOptions,
    HostSensorEventsParams,
    HostSensorEventsResult,
    HostSensorHistoryParams,
    HostSensorHistoryResult,
    HostTariff,
    HostTariffAssignment,
    HostTariffBillingPeriod,
    HostTariffBillingPeriodAt,
    HostTariffBillingPeriodAtParams,
    HostTariffBillingPeriodsParams,
    HostTariffListItem,
    HostTariffPricing,
    HostTariffPricingParams,
    HostTariffResolutionPoint,
    HostTariffResolvedAssignment,
    HostUtilityCost,
    HostUtilityCostParams,
    HostVirtualRoleHistoryParams,
    HostVirtualRoleHistoryResult,
    HostVirtualRoleProvenanceParams,
    HostVirtualRoleProvenanceResult,
    HostWaitingRoomCountsParams,
    HostWaitingRoomCountsResult,
    HostWaitingRoomListParams,
    HostWaitingRoomListResult
} from '../../core/data-contract';
import type {
    FleetCarbonDomain,
    HostCarbonBreakdownParams,
    HostCarbonBreakdownResult
} from '../../core/domains/carbon';
import type {
    LocationAssignmentQuery,
    LocationListParams
} from '../../core/domains/locations';
import type {
    HostOrganizationUserCreateInput,
    HostOrganizationUserDirectory,
    HostOrganizationUserUpdateInput
} from '../../core/domains/users';
import type {FleetConnectionState} from '../../core/live-events';
import {createResource} from '../../core/resource';
import type {
    FleetFormat,
    FleetHost,
    FleetPeriods,
    FleetPermissions
} from '../../core/types';
import {useExternalStore} from '../external-store';
import {useFleetRuntime} from '../provider';
import {useFleetResource, type VueFleetResource} from './useFleetResource';

function useBoundResource<T>(
    load: () => Promise<T>,
    initial: T,
    options: HostResourceQueryOptions = {}
): VueFleetResource<T> {
    const runtime = useFleetRuntime();
    const bound = useFleetResource(
        createResource({load, initial, session: runtime.session})
    );
    if (options.enabled !== false) void bound.refresh();
    return bound;
}

export function useEnergyHistory(
    params: HostEnergyHistoryParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostEnergyHistoryResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.energy.history(params),
        null,
        options
    );
}

export function useEnergyCurrent(
    params: HostEnergyCurrentParams = {},
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostEnergyCurrentResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.energy.current(params),
        null,
        options
    );
}

/** Full Fleet-owned utility bill. Missing/partial pricing remains explicit in
 * `data.status`; this resource never substitutes a local or country rate. */
export function useUtilityCost(
    params: HostUtilityCostParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostUtilityCost | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.billing.quote(params),
        null,
        options
    );
}

export function useSensorHistory(
    params: HostSensorHistoryParams
): VueFleetResource<HostSensorHistoryResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(() => runtime.fleet.sensors.history(params), null);
}

export function useSensorEvents(
    params: HostSensorEventsParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostSensorEventsResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.sensors.events(params),
        null,
        options
    );
}

export function useVirtualRoleHistory(
    params: HostVirtualRoleHistoryParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostVirtualRoleHistoryResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.virtualDevices.history.readRole(params),
        null,
        options
    );
}

export function useVirtualRoleProvenance(
    params: HostVirtualRoleProvenanceParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostVirtualRoleProvenanceResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.virtualDevices.history.readProvenance(params),
        null,
        options
    );
}

export function useDeviceStatusTimeline(
    params: HostDeviceStatusTimelineParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostDeviceStatusTimelineResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.devices.statusTimeline(params),
        null,
        options
    );
}

export function useAlertRules(
    params: HostAlertRuleListParams = {},
    options: HostResourceQueryOptions = {}
): VueFleetResource<readonly HostAlertRule[]> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.alerts.listRules(params),
        [],
        options
    );
}

export function useAlertRuleKinds(
    options: HostResourceQueryOptions = {}
): VueFleetResource<readonly HostAlertRuleKind[]> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.alerts.listKinds(),
        [],
        options
    );
}

export function useAlertRuleActions() {
    const {alerts} = useFleetRuntime().fleet;
    return {
        get: (id: number) => alerts.getRule(id),
        create: (input: HostAlertRuleCreateInput) => alerts.createRule(input),
        update: (input: HostAlertRuleUpdateInput) => alerts.updateRule(input),
        delete: (id: number) => alerts.deleteRule(id)
    };
}

export function useTariffs(
    options: HostResourceQueryOptions = {}
): VueFleetResource<readonly HostTariffListItem[]> {
    const runtime = useFleetRuntime();
    return useBoundResource(() => runtime.fleet.tariffs.list(), [], options);
}

export function useTariffAssignments(
    options: HostResourceQueryOptions = {}
): VueFleetResource<readonly HostTariffAssignment[]> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.tariffs.listAssignments(),
        [],
        options
    );
}

export function useResolvedTariffAssignments(
    points: HostTariffResolutionPoint[],
    options: HostResourceQueryOptions = {}
): VueFleetResource<readonly HostTariffResolvedAssignment[]> {
    const runtime = useFleetRuntime();
    return useBoundResource<readonly HostTariffResolvedAssignment[]>(
        () => runtime.fleet.tariffs.resolveAssignments(points),
        [],
        options
    );
}

export function useTariff(
    id: number,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostTariff | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(() => runtime.fleet.tariffs.get(id), null, options);
}

export function useTariffBillingPeriods(
    params: HostTariffBillingPeriodsParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<readonly HostTariffBillingPeriod[]> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.tariffs.billingPeriods(params),
        [],
        options
    );
}

export function useTariffBillingPeriodAt(
    params: HostTariffBillingPeriodAtParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostTariffBillingPeriodAt | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.tariffs.billingPeriodAt(params),
        null,
        options
    );
}

export function useTariffPricing(
    params: HostTariffPricingParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostTariffPricing | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.tariffs.resolvePricing(params),
        null,
        options
    );
}

export function useWaitingRoom(
    params: HostWaitingRoomListParams = {},
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostWaitingRoomListResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.waitingRoom.list(params),
        null,
        options
    );
}

export function useWaitingRoomCounts(
    params: HostWaitingRoomCountsParams = {},
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostWaitingRoomCountsResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.waitingRoom.counts(params),
        null,
        options
    );
}

export function useFirmwareUpdateStatus(
    params: HostFirmwareUpdateStatusParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostFirmwareUpdateStatusResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.firmware.getAutoUpdateStatus(params),
        null,
        options
    );
}

export function useCredentials(
    params: HostCredentialListParams = {},
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostCredentialListResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.credentials.list(params),
        null,
        options
    );
}

export function useKinds(
    params: HostKindListParams = {},
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostKindListResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.kinds.list(params),
        null,
        options
    );
}

export function useLocationChildren(
    id: number,
    params: Omit<LocationListParams, 'parentLocationId'> = {},
    options: HostResourceQueryOptions = {}
): VueFleetResource<readonly HostLocation[]> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.locations.children(id, params),
        [],
        options
    );
}

export function useLocationPath(
    id: number,
    options: HostResourceQueryOptions = {}
) {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.locations.path(id),
        [],
        options
    );
}

export function useLocationAssignments(
    params: LocationAssignmentQuery = {},
    options: HostResourceQueryOptions = {}
): VueFleetResource<readonly LocationAssignment[]> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.locations.assignments(params),
        [],
        options
    );
}

export function useLocationDevices(
    id: number,
    options: HostResourceQueryOptions = {}
) {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.locations.scopedDevices(id),
        [],
        options
    );
}

export function useDeviceAdministration() {
    return useFleetRuntime().fleet.devices;
}

export function useLocationActions() {
    return useFleetRuntime().fleet.locations;
}

export function useTariffActions() {
    return useFleetRuntime().fleet.tariffs;
}

export function useWaitingRoomActions() {
    return useFleetRuntime().fleet.waitingRoom;
}

export function useFirmwareActions() {
    return useFleetRuntime().fleet.firmware;
}

export function useCredentialActions() {
    return useFleetRuntime().fleet.credentials;
}

export function useVirtualDeviceActions() {
    return useFleetRuntime().fleet.virtualDevices;
}

export function useBluetoothDeviceActions() {
    return useFleetRuntime().fleet.bluetoothDevices;
}

export function useNavigation() {
    const navigation = useFleetRuntime().navigation;
    return {
        ...navigation,
        location: useExternalStore(navigation.location)
    };
}

/** The same store React reads. The host builds it from Fleet's own permissions
 * computed, so this is a source change, not a shape change. */
export function usePermissions(): Readonly<Ref<FleetPermissions>> {
    return useExternalStore(useFleetRuntime().fleet.permissions);
}

/** Controls visibility only. Fleet still authorizes the backend call. */
export function useCan(
    action: string,
    operation?: Parameters<FleetPermissions['can']>[1],
    itemId?: string | number
) {
    const permissions = useExternalStore(useFleetRuntime().fleet.permissions);
    return computed(() => permissions.value.can(action, operation, itemId));
}

export function useLogicalMeters(
    params: HostLogicalMeterParams = {}
): VueFleetResource<HostLogicalMeterResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.energy.logicalMeters(params),
        null
    );
}

export function useMeterTopology(): VueFleetResource<HostMeterTopologyResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.energy.meterConnections(),
        null
    );
}

export function useAuditTimeline(
    params: HostAuditTimelineParams = {}
): VueFleetResource<HostAuditTimelineResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(() => runtime.fleet.audit.query(params), null);
}

export function useAlertTimeline(
    alertInstanceId: number
): VueFleetResource<HostAlertTimeline | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        async () => ({
            transitions:
                await runtime.fleet.alerts.transitions(alertInstanceId),
            annotations: await runtime.fleet.alerts.annotations(alertInstanceId)
        }),
        null
    );
}

export function useAlertActions(): HostAlertActions {
    const {alerts} = useFleetRuntime().fleet;
    return {
        acknowledge: (id: number) => alerts.acknowledge(id),
        resolve: (id: number) => alerts.resolve(id),
        annotate: (id: number, body: string) => alerts.annotate(id, body)
    };
}

export function useOperationalBindings() {
    return useExternalStore(useFleetRuntime().operationalBindings);
}

/**
 * Whether the live feed is delivering right now. A card showing a two-hour-old
 * number with nothing said about it is worse than a card saying "not
 * connected", and this is the only way a template can tell the difference.
 */
export function useConnection(): Readonly<Ref<FleetConnectionState>> {
    return useExternalStore(useFleetRuntime().fleet.live.connection);
}

/** Live organization market defaults for currency, dates, and units. */
export function useOrganizationProfile() {
    return useExternalStore(useFleetRuntime().organizationProfile);
}

/** Date, number and money formatting that follows the organization's
 *  region. See `FleetFormat` (core/types.ts) for what each part decides. */
export function useFormat(): FleetFormat {
    return useFleetRuntime().format;
}

/** Named periods resolved on the tenant clock; a template never does calendar arithmetic. */
export function usePeriods(): FleetPeriods {
    return useFleetRuntime().periods;
}

/** Versioned emission factors and carbon valuations owned by Fleet. */
export function useCarbon(): FleetCarbonDomain {
    return useFleetRuntime().fleet.carbon;
}

/** Fleet-owned measured electricity carbon totals and chart series. Factor
 * revisions, gaps, and per-location attribution remain server-side. */
export function useCarbonBreakdown(
    params: HostCarbonBreakdownParams,
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostCarbonBreakdownResult | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.carbon.calculateBreakdown(params),
        null,
        options
    );
}

/** Which Fleet this template is running inside, and what it has. See
 *  `FleetHost` (core/types.ts) for what `has` can and cannot answer. */
export function useHost(): FleetHost {
    return useFleetRuntime().host;
}

export function useOrganizationUsers(
    options: HostResourceQueryOptions = {}
): VueFleetResource<HostOrganizationUserDirectory | null> {
    const runtime = useFleetRuntime();
    return useBoundResource(
        () => runtime.fleet.users.directory(),
        null,
        options
    );
}

export function useOrganizationUserActions() {
    const {users} = useFleetRuntime().fleet;
    return {
        create: (input: HostOrganizationUserCreateInput) => users.create(input),
        update: (input: HostOrganizationUserUpdateInput) => users.update(input),
        sendPasswordReset: (id: string) => users.sendPasswordReset(id),
        deactivate: (id: string) => users.deactivate(id),
        reactivate: (id: string) => users.reactivate(id),
        delete: (id: string) => users.delete(id)
    };
}
