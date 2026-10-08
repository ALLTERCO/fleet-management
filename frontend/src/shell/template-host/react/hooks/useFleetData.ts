// Domain hooks the proof template needs: a curated core domain bound to the
// generic resource hook. No business vocabulary, no per-template shapes.

import {useEffect, useMemo} from 'react';
import type {
    HostAlert,
    HostAlertActions,
    HostAlertListParams,
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
    HostDeviceListParams,
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
    HostLocationListParams,
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
import type {GroupListParams, HostGroupRow} from '../../core/domains/groups';
import type {
    LocationAssignmentQuery,
    LocationListParams
} from '../../core/domains/locations';
import type {
    HostOrganizationUserCreateInput,
    HostOrganizationUserDirectory,
    HostOrganizationUserUpdateInput
} from '../../core/domains/users';
import {createLiveDevices, loadDevicesByCursor} from '../../core/live-devices';
import type {FleetConnectionState} from '../../core/live-events';
import type {OperationalBindings} from '../../core/operational-bindings';
import type {FleetSessionIdentity} from '../../core/session';
import type {
    FleetFormat,
    FleetHost,
    HostDevice,
    TemplateCustomization
} from '../../core/types';
import {useFleet, useFleetRuntime} from '../FleetProvider';
import {
    type UseFleetResourceResult,
    useFleetResource,
    useResourceState
} from './useFleetResource';
import {useFleetStore} from './useFleetStore';
import {useRetained} from './useRetained';

const NO_LOCATIONS: readonly HostLocation[] = [];
const NO_ALERTS: readonly HostAlert[] = [];
const NO_ALERT_RULES: readonly HostAlertRule[] = [];
const NO_TARIFFS: readonly HostTariffListItem[] = [];
const NO_TARIFF_ASSIGNMENTS: readonly HostTariffAssignment[] = [];
const NO_TARIFF_BILLING_PERIODS: readonly HostTariffBillingPeriod[] = [];

/** Loads the whole scope once, then tracks it from the host's live feed. */
export function useDevices(
    params: HostDeviceListParams = {}
): UseFleetResourceResult<readonly HostDevice[]> {
    const runtime = useFleetRuntime();
    // The request identity is the params value, not the object identity a
    // caller happens to pass, so the memo keys off the serialized form.
    const key = JSON.stringify(params);
    const request = useMemo(
        () => JSON.parse(key) as HostDeviceListParams,
        [key]
    );
    const devices = useRetained(
        () =>
            createLiveDevices({
                load: () =>
                    loadDevicesByCursor(
                        (page) => runtime.fleet.devices.listPage(page),
                        request
                    ),
                loadByIds: (shellyIDs) =>
                    runtime.fleet.devices.list({
                        ...request,
                        shellyIDs: [...shellyIDs],
                        limit: shellyIDs.length
                    }),
                live: runtime.fleet.live,
                session: runtime.session
            }),
        [runtime, request]
    );

    // The feed belongs to the instance: a released one stays closed, and the
    // replacement opens its own.
    useEffect(() => devices.listen(), [devices]);

    return useResourceState(devices);
}

export function useLocations(
    params: HostLocationListParams = {}
): UseFleetResourceResult<readonly HostLocation[]> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<readonly HostLocation[]>({
        load: () => runtime.fleet.locations.list(params),
        initial: NO_LOCATIONS,
        session: runtime.session,
        deps: [runtime, key]
    });
}

export function useAlerts(
    filters: HostAlertListParams = {}
): UseFleetResourceResult<readonly HostAlert[]> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(filters);
    return useFleetResource<readonly HostAlert[]>({
        load: () => runtime.fleet.alerts.listInstances(filters),
        initial: NO_ALERTS,
        session: runtime.session,
        deps: [runtime, key]
    });
}

/** Alias the Vue binding also exports: a supervised alert is an alert. */
export const useSupervisedAlerts = useAlerts;

export function useDeviceStatusTimeline(
    params: HostDeviceStatusTimelineParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostDeviceStatusTimelineResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.devices.statusTimeline(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useAlertRules(
    params: HostAlertRuleListParams = {},
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<readonly HostAlertRule[]> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.alerts.listRules(params),
        initial: NO_ALERT_RULES,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useAlertRuleKinds(
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<readonly HostAlertRuleKind[]> {
    const runtime = useFleetRuntime();
    return useFleetResource({
        load: () => runtime.fleet.alerts.listKinds(),
        initial: [],
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, options.enabled]
    });
}

export function useAlertRuleActions() {
    const {alerts} = useFleetRuntime().fleet;
    return useMemo(
        () => ({
            get: (id: number) => alerts.getRule(id),
            create: (input: HostAlertRuleCreateInput) =>
                alerts.createRule(input),
            update: (input: HostAlertRuleUpdateInput) =>
                alerts.updateRule(input),
            delete: (id: number) => alerts.deleteRule(id)
        }),
        [alerts]
    );
}

export function useTariffs(
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<readonly HostTariffListItem[]> {
    const runtime = useFleetRuntime();
    return useFleetResource({
        load: () => runtime.fleet.tariffs.list(),
        initial: NO_TARIFFS,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, options.enabled]
    });
}

export function useTariffAssignments(
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<readonly HostTariffAssignment[]> {
    const runtime = useFleetRuntime();
    return useFleetResource({
        load: () => runtime.fleet.tariffs.listAssignments(),
        initial: NO_TARIFF_ASSIGNMENTS,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, options.enabled]
    });
}

export function useResolvedTariffAssignments(
    points: HostTariffResolutionPoint[],
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<readonly HostTariffResolvedAssignment[]> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(points);
    const request = useMemo(
        () => JSON.parse(key) as HostTariffResolutionPoint[],
        [key]
    );
    return useFleetResource({
        load: () => runtime.fleet.tariffs.resolveAssignments(request),
        initial: [],
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useTariff(
    id: number,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostTariff | null> {
    const runtime = useFleetRuntime();
    return useFleetResource({
        load: () => runtime.fleet.tariffs.get(id),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, id, options.enabled]
    });
}

export function useTariffBillingPeriods(
    params: HostTariffBillingPeriodsParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<readonly HostTariffBillingPeriod[]> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.tariffs.billingPeriods(params),
        initial: NO_TARIFF_BILLING_PERIODS,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useTariffBillingPeriodAt(
    params: HostTariffBillingPeriodAtParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostTariffBillingPeriodAt | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.tariffs.billingPeriodAt(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useTariffPricing(
    params: HostTariffPricingParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostTariffPricing | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.tariffs.resolvePricing(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useWaitingRoom(
    params: HostWaitingRoomListParams = {},
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostWaitingRoomListResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.waitingRoom.list(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useWaitingRoomCounts(
    params: HostWaitingRoomCountsParams = {},
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostWaitingRoomCountsResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.waitingRoom.counts(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useFirmwareUpdateStatus(
    params: HostFirmwareUpdateStatusParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostFirmwareUpdateStatusResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.firmware.getAutoUpdateStatus(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useCredentials(
    params: HostCredentialListParams = {},
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostCredentialListResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.credentials.list(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

/** Stable domain accessors expose all typed writes without inventing one hook
 * per method. Fleet still authorizes every call. */
export function useDeviceAdministration() {
    return useFleetRuntime().fleet.devices;
}

export function useLocationActions() {
    return useFleetRuntime().fleet.locations;
}

export function useGroupActions() {
    return useFleetRuntime().fleet.groups;
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

export function useEnergyCurrent(
    params: HostEnergyCurrentParams = {}
): UseFleetResourceResult<HostEnergyCurrentResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostEnergyCurrentResult | null>({
        load: () => runtime.fleet.energy.current(params),
        initial: null,
        session: runtime.session,
        deps: [runtime, key]
    });
}

export function useEnergyHistory(
    params: HostEnergyHistoryParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostEnergyHistoryResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostEnergyHistoryResult | null>({
        load: () => runtime.fleet.energy.history(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key]
    });
}

/** Full Fleet-owned utility bill with explicit partial/unconfigured states. */
export function useUtilityCost(
    params: HostUtilityCostParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostUtilityCost | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostUtilityCost | null>({
        load: () => runtime.fleet.billing.quote(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key]
    });
}

export function useSensorHistory(
    params: HostSensorHistoryParams
): UseFleetResourceResult<HostSensorHistoryResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostSensorHistoryResult | null>({
        load: () => runtime.fleet.sensors.history(params),
        initial: null,
        session: runtime.session,
        deps: [runtime, key]
    });
}

export function useSensorEvents(
    params: HostSensorEventsParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostSensorEventsResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostSensorEventsResult | null>({
        load: () => runtime.fleet.sensors.events(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useVirtualRoleHistory(
    params: HostVirtualRoleHistoryParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostVirtualRoleHistoryResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostVirtualRoleHistoryResult | null>({
        load: () => runtime.fleet.virtualDevices.history.readRole(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useVirtualRoleProvenance(
    params: HostVirtualRoleProvenanceParams,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostVirtualRoleProvenanceResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostVirtualRoleProvenanceResult | null>({
        load: () => runtime.fleet.virtualDevices.history.readProvenance(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key, options.enabled]
    });
}

export function useGroups(params: GroupListParams = {}) {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.groups.list(params),
        initial: [],
        session: runtime.session,
        deps: [runtime, key]
    });
}

export function useGroup(
    id: number,
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostGroupRow | null> {
    const runtime = useFleetRuntime();
    return useFleetResource<HostGroupRow | null>({
        load: () => runtime.fleet.groups.get(id),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, id, options.enabled]
    });
}

export function useLocationChildren(
    id: number,
    params: Omit<LocationListParams, 'parentLocationId'> = {}
) {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.locations.children(id, params),
        initial: [],
        session: runtime.session,
        deps: [runtime, id, key]
    });
}

export function useLocationPath(id: number) {
    const runtime = useFleetRuntime();
    return useFleetResource({
        load: () => runtime.fleet.locations.path(id),
        initial: [],
        session: runtime.session,
        deps: [runtime, id]
    });
}

export function useLocationAssignments(params: LocationAssignmentQuery = {}) {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource({
        load: () => runtime.fleet.locations.assignments(params),
        initial: [],
        session: runtime.session,
        deps: [runtime, key]
    });
}

export function useLocationDevices(
    id: number,
    options: HostResourceQueryOptions = {}
) {
    const runtime = useFleetRuntime();
    return useFleetResource({
        load: () => runtime.fleet.locations.scopedDevices(id),
        initial: [],
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, id, options.enabled]
    });
}

export function useKinds(
    params: HostKindListParams = {}
): UseFleetResourceResult<HostKindListResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostKindListResult | null>({
        load: () => runtime.fleet.kinds.list(params),
        initial: null,
        session: runtime.session,
        deps: [runtime, key]
    });
}

export function useLogicalMeters(
    params: HostLogicalMeterParams = {}
): UseFleetResourceResult<HostLogicalMeterResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostLogicalMeterResult | null>({
        load: () => runtime.fleet.energy.logicalMeters(params),
        initial: null,
        session: runtime.session,
        deps: [runtime, key]
    });
}

export function useMeterTopology(): UseFleetResourceResult<HostMeterTopologyResult | null> {
    const runtime = useFleetRuntime();
    return useFleetResource<HostMeterTopologyResult | null>({
        load: () => runtime.fleet.energy.meterConnections(),
        initial: null,
        session: runtime.session,
        deps: [runtime]
    });
}

export function useAuditTimeline(
    params: HostAuditTimelineParams = {}
): UseFleetResourceResult<HostAuditTimelineResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostAuditTimelineResult | null>({
        load: () => runtime.fleet.audit.query(params),
        initial: null,
        session: runtime.session,
        deps: [runtime, key]
    });
}

export function useAlertTimeline(
    alertInstanceId: number
): UseFleetResourceResult<HostAlertTimeline | null> {
    const runtime = useFleetRuntime();
    return useFleetResource<HostAlertTimeline | null>({
        load: async () => ({
            transitions:
                await runtime.fleet.alerts.transitions(alertInstanceId),
            annotations: await runtime.fleet.alerts.annotations(alertInstanceId)
        }),
        initial: null,
        session: runtime.session,
        deps: [runtime, alertInstanceId]
    });
}

export function useAlertActions(): HostAlertActions {
    const {alerts} = useFleetRuntime().fleet;
    return useMemo(
        () => ({
            acknowledge: (id: number) => alerts.acknowledge(id),
            resolve: (id: number) => alerts.resolve(id),
            annotate: (id: number, body: string) => alerts.annotate(id, body)
        }),
        [alerts]
    );
}

export function useCustomization(): TemplateCustomization {
    return useFleetStore(useFleetRuntime().customization);
}

export function useOperationalBindings(): OperationalBindings {
    return useFleetStore(useFleetRuntime().operationalBindings);
}

/**
 * Whether the live feed is delivering right now. A card showing a two-hour-old
 * number with nothing said about it is worse than a card saying "not
 * connected", and this is the only way a template can tell the difference.
 */
export function useConnection(): FleetConnectionState {
    return useFleetStore(useFleetRuntime().fleet.live.connection);
}

/** Live organization market defaults for currency, dates, and units. */
export function useOrganizationProfile() {
    return useFleetStore(useFleetRuntime().organizationProfile);
}

/** Date, number and money formatting that follows the organization's
 *  region. See `FleetFormat` (core/types.ts) for what each part decides. */
export function useFormat(): FleetFormat {
    return useFleetRuntime().format;
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
): UseFleetResourceResult<HostCarbonBreakdownResult | null> {
    const runtime = useFleetRuntime();
    const key = JSON.stringify(params);
    return useFleetResource<HostCarbonBreakdownResult | null>({
        load: () => runtime.fleet.carbon.calculateBreakdown(params),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, key]
    });
}

/** Which Fleet this template is running inside, and what it has. See
 *  `FleetHost` (core/types.ts) for what `has` can and cannot answer. */
export function useHost(): FleetHost {
    return useFleetRuntime().host;
}

/** Who the data on screen belongs to. Read `organizationId` from here rather
 *  than digging a tenant out of a profile load, which answers with whichever
 *  load returned last and keeps that answer across a tenant switch. Either
 *  field is null until the host resolves it: not yet known, never none. */
export function useSession(): FleetSessionIdentity {
    return useFleetStore(useFleetRuntime().session);
}

export function useNavigation() {
    // `location` is a store, so it has to be subscribed to. Returning the raw
    // runtime object meant a React template never re-rendered on a route
    // change, while the Vue one did — same hook name, different behaviour.
    const navigation = useFleetRuntime().navigation;
    return {
        ...navigation,
        location: useFleetStore(navigation.location)
    };
}

export function useOrganizationUsers(
    options: HostResourceQueryOptions = {}
): UseFleetResourceResult<HostOrganizationUserDirectory | null> {
    const runtime = useFleetRuntime();
    return useFleetResource<HostOrganizationUserDirectory | null>({
        load: () => runtime.fleet.users.directory(),
        initial: null,
        immediate: options.enabled !== false,
        session: runtime.session,
        deps: [runtime, options.enabled]
    });
}

export function useOrganizationUserActions() {
    const {users} = useFleetRuntime().fleet;
    return useMemo(
        () => ({
            create: (input: HostOrganizationUserCreateInput) =>
                users.create(input),
            update: (input: HostOrganizationUserUpdateInput) =>
                users.update(input),
            sendPasswordReset: (id: string) => users.sendPasswordReset(id),
            deactivate: (id: string) => users.deactivate(id),
            reactivate: (id: string) => users.reactivate(id),
            delete: (id: string) => users.delete(id)
        }),
        [users]
    );
}

export {useFleet};
