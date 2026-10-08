// `@host/react` — the React binding. One provider, one store hook, one
// resource hook, and the domain hooks a template needs.

export {type DeviceKeyInput, deviceKey} from '../core/device-key';
export type {FleetAlertDomain} from '../core/domains/alerts';
export type {FleetBluetoothDeviceDomain} from '../core/domains/bluetooth-devices';
export type {HostBrandingRead} from '../core/domains/branding';
export type {
    FleetCarbonDomain,
    HostCarbonBreakdownParams,
    HostCarbonBreakdownResult
} from '../core/domains/carbon';
export type {FleetCredentialDomain} from '../core/domains/credentials';
export type {FleetDeviceDomain} from '../core/domains/devices';
export type {FleetFirmwareDomain} from '../core/domains/firmware';
export type {
    FleetFleetMapDomain,
    HostFleetMapAlertSnapshot,
    HostFleetMapEnergySnapshot,
    HostFleetMapSignalSnapshot,
    HostFleetMapSnapshotParams
} from '../core/domains/fleetmap';
export type {FleetGroupDomain} from '../core/domains/groups';
export type {FleetLocationDomain} from '../core/domains/locations';
export type {
    FleetTariffDomain,
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
export type {FleetWaitingRoomDomain} from '../core/domains/waiting-room';
export {type FleetSdkError, fleetSdkFieldErrors} from '../core/errors';
export {
    FLEET_LIVE_EVENT,
    type FleetConnectionState,
    type FleetConnectionStatus,
    type FleetLiveEvent,
    type FleetLiveEventName,
    type FleetLiveRequest
} from '../core/live-events';
export type {
    LiveMetricOptions,
    MetricHistoryOptions
} from '../core/live-metric';
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
    DeviceCapabilities,
    DeviceControlCapabilities,
    DeviceControlRequest,
    DeviceLeakCapability,
    DeviceSmokeCapability,
    FleetCommandState,
    FleetCommandStatus,
    FleetFormat,
    FleetFormatDateOptions,
    FleetFormatNumberOptions,
    FleetFreshness,
    FleetHost,
    FleetOrganizationProfile,
    FleetPermissions,
    FleetResourceState,
    FleetSdk,
    FleetUser,
    HostDevice,
    HostDeviceComponent,
    TemplateCustomization,
    TemplateRuntimeContext
} from '../core/types';
export {signOut} from '../currentUser';
export type * from '../shared-contract-types';
export {
    FleetProvider,
    type FleetProviderProps,
    useFleet,
    useFleetRuntime
} from './FleetProvider';
export {
    useCustomizationField,
    useNavLabels,
    useNavOrder,
    usePresentationCustomization,
    useThemeTokens
} from './hooks/useCustomizationFields';
export {
    type UseDeviceControlOptions,
    useDeviceControl
} from './hooks/useDeviceControl';
export {
    useDeviceActions,
    useDeviceCapabilities,
    useDevicesForGroup
} from './hooks/useDeviceViews';
export {
    type UseFleetCommandResult,
    useFleetCommand
} from './hooks/useFleetCommand';
export {
    useAlertActions,
    useAlertRuleActions,
    useAlertRuleKinds,
    useAlertRules,
    useAlerts,
    useAlertTimeline,
    useAuditTimeline,
    useBluetoothDeviceActions,
    useCarbon,
    useCarbonBreakdown,
    useConnection,
    useCredentialActions,
    useCredentials,
    useCustomization,
    useDeviceAdministration,
    useDeviceStatusTimeline,
    useDevices,
    useEnergyCurrent,
    useEnergyHistory,
    useFirmwareActions,
    useFirmwareUpdateStatus,
    useFormat,
    useGroup,
    useGroupActions,
    useGroups,
    useHost,
    useKinds,
    useLocationActions,
    useLocationAssignments,
    useLocationChildren,
    useLocationDevices,
    useLocationPath,
    useLocations,
    useLogicalMeters,
    useMeterTopology,
    useNavigation,
    useOperationalBindings,
    useOrganizationProfile,
    useOrganizationUserActions,
    useOrganizationUsers,
    useResolvedTariffAssignments,
    useSensorEvents,
    useSensorHistory,
    useSession,
    useSupervisedAlerts,
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
} from './hooks/useFleetData';
export {useCan, useCurrentUser, usePermissions} from './hooks/useFleetIdentity';
export {
    type UseFleetResourceOptions,
    type UseFleetResourceResult,
    useFleetResource
} from './hooks/useFleetResource';
export {useFleetStore} from './hooks/useFleetStore';
export {
    type UseLiveMetricResult,
    type UseMetricHistoryOptions,
    type UseMetricHistoryResult,
    type UseMetricLiveOptions,
    useLiveMetric,
    useMetric,
    useMetricHistory
} from './hooks/useMetric';
