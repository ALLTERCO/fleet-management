// `@host/vue` — the explicit Vue binding. `@host` stays the legacy surface;
// both run the same core, so they cannot drift.

export {
    useAlerts,
    useSupervisedAlerts
} from '../alerts';
export {type DeviceKeyInput, deviceKey} from '../core/device-key';
export type {FleetBluetoothDeviceDomain} from '../core/domains/bluetooth-devices';
export type {HostBrandingRead} from '../core/domains/branding';
export type {
    FleetCarbonDomain,
    HostCarbonBreakdownParams,
    HostCarbonBreakdownResult
} from '../core/domains/carbon';
export type {
    FleetFleetMapDomain,
    HostFleetMapAlertSnapshot,
    HostFleetMapEnergySnapshot,
    HostFleetMapSignalSnapshot,
    HostFleetMapSnapshotParams
} from '../core/domains/fleetmap';
export type {
    HostTariffBillingPeriodAt,
    HostTariffBillingPeriodAtParams
} from '../core/domains/tariffs';
export type {
    HostOrganizationUser,
    HostOrganizationUserCreateInput,
    HostOrganizationUserDirectory,
    HostOrganizationUserStatus,
    HostOrganizationUserUpdateInput
} from '../core/domains/users';
export type {FleetVirtualDeviceDomain} from '../core/domains/virtual-devices';
export {type FleetSdkError, fleetSdkFieldErrors} from '../core/errors';
export {
    FLEET_LIVE_EVENT,
    type FleetConnectionState,
    type FleetConnectionStatus,
    type FleetLiveEvent,
    type FleetLiveEventName,
    type FleetLiveRequest
} from '../core/live-events';
export type {OperationalBindings} from '../core/operational-bindings';
export {
    matchSearch,
    rankSearchMatches,
    type SearchCandidate,
    type SearchHit,
    type SearchRange
} from '../core/search-match';
export type {FleetSessionIdentity} from '../core/session';
export type {
    DeviceControlCapabilities,
    DeviceControlRequest,
    DeviceLeakCapability,
    DeviceSmokeCapability,
    FleetFormat,
    FleetFormatDateOptions,
    FleetFormatNumberOptions,
    FleetHost,
    FleetOrganizationProfile,
    HostDeviceComponent
} from '../core/types';
export {signOut} from '../currentUser';
export {
    useDeviceActions,
    useDeviceCapabilities,
    useDevicesForGroup
} from '../devices';
export {
    type LiveMetric,
    type LiveMetricOptions,
    type MetricHistory,
    type MetricHistoryOptions,
    useLiveMetric,
    useMetric,
    useMetricHistory
} from '../energy';
export {useGroup, useGroupActions, useGroups} from '../groups';
export {useLocations} from '../locations';
export {useTemplateRpc} from '../rpc';
export type * from '../shared-contract-types';
export type {
    HostAction,
    HostAsyncState,
    HostResource,
    HostResourceFreshness
} from '../types';
export {
    useCustomization,
    useCustomizationField,
    useNavLabels,
    useNavOrder,
    usePresentationCustomization,
    useThemeTokens
} from './composables/useCustomizationFields';
export {
    type UseDeviceControlOptions,
    useDeviceControl
} from './composables/useDeviceControl';
export {useDevices} from './composables/useDevices';
export {useFleetCommand} from './composables/useFleetCommand';
export {
    useAlertActions,
    useAlertRuleActions,
    useAlertRuleKinds,
    useAlertRules,
    useAlertTimeline,
    useAuditTimeline,
    useBluetoothDeviceActions,
    useCan,
    useCarbon,
    useCarbonBreakdown,
    useConnection,
    useCredentialActions,
    useCredentials,
    useDeviceAdministration,
    useDeviceStatusTimeline,
    useEnergyCurrent,
    useEnergyHistory,
    useFirmwareActions,
    useFirmwareUpdateStatus,
    useFormat,
    useHost,
    useKinds,
    useLocationActions,
    useLocationAssignments,
    useLocationChildren,
    useLocationDevices,
    useLocationPath,
    useLogicalMeters,
    useMeterTopology,
    useNavigation,
    useOperationalBindings,
    useOrganizationProfile,
    useOrganizationUserActions,
    useOrganizationUsers,
    usePermissions,
    useResolvedTariffAssignments,
    useSensorEvents,
    useSensorHistory,
    useTariff,
    useTariffActions,
    useTariffAssignments,
    useTariffBillingPeriodAt,
    useTariffBillingPeriods,
    useTariffPricing,
    useTariffs,
    useUtilityCost,
    useVirtualDeviceActions,
    useVirtualRoleHistory,
    useVirtualRoleProvenance,
    useWaitingRoom,
    useWaitingRoomActions,
    useWaitingRoomCounts
} from './composables/useFleetData';
export {useCurrentUser, useSession} from './composables/useFleetIdentity';
export {
    useFleetResource,
    type VueFleetResource
} from './composables/useFleetResource';
export {
    createVueStoreBridge,
    useExternalStore,
    useFleetStore,
    type VueStoreBridge
} from './external-store';
export {provideFleetRuntime, useFleet, useFleetRuntime} from './provider';
