// Public `@host/core` surface. No UI framework, no state library, no Fleet
// application module; `@api/*` is imported but never re-exported from here.

export {
    createFleetClient,
    createRpcAccess,
    createTemplateRuntimeContext,
    type FleetClient,
    type FleetClientOptions,
    type TemplateRuntimeContextOptions
} from './client';
export {
    createCommand,
    DEFAULT_COMMAND_TIMEOUT_MS,
    FLEET_COMMAND_DISPOSED,
    FLEET_COMMAND_IN_FLIGHT,
    FLEET_COMMAND_NOT_PERMITTED,
    FLEET_COMMAND_TIMED_OUT,
    type FleetCommand,
    type FleetCommandOptions,
    type FleetCommandToken,
    NO_COMMAND_TOKEN
} from './command';
export {
    createControlDomain,
    type DeviceControlSubmitter,
    FLEET_CONTROL_INVALID_REQUEST,
    FLEET_CONTROL_NOT_PERMITTED,
    FLEET_CONTROL_NOT_SUPPORTED,
    type FleetControls
} from './controls';
export {
    type PresentationComponentInstanceOverrides,
    type PresentationComponentOverride,
    type PresentationComponentOverrides,
    type PresentationCustomization,
    type PresentationSize,
    type ResolvedPresentationCustomization,
    resolveComponentPresentation,
    resolvePresentationCustomization
} from './customization-presentation';
export type {
    HostAlert,
    HostAlertActions,
    HostAlertAnnotation,
    HostAlertListParams,
    HostAlertRule,
    HostAlertRuleCreateInput,
    HostAlertRuleKind,
    HostAlertRuleListParams,
    HostAlertRuleListResult,
    HostAlertRuleUpdateInput,
    HostAlertTimeline,
    HostAlertTransition,
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
    HostMethod,
    HostParams,
    HostResourceQueryOptions,
    HostResult,
    HostSensorEventsParams,
    HostSensorEventsResult,
    HostSensorHistoryParams,
    HostSensorHistoryResult,
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
} from './data-contract';
export {deriveDomainCapabilities} from './device-capabilities';
export {type DeviceKeyInput, deviceKey} from './device-key';
export {presenceFields, toHostDevice} from './device-mapper';
export {
    createAlertDomain,
    type FleetAlertDomain
} from './domains/alerts';
export {
    createAnalyticsDomain,
    type FleetAnalyticsDomain
} from './domains/analytics';
export {createAuditDomain, type FleetAuditDomain} from './domains/audit';
export {
    createAuthorizationDomain,
    type FleetAuthorizationDomain
} from './domains/authorization';
export {
    createAutomationDomain,
    type FleetAutomationDomain
} from './domains/automations';
export {
    createBillingDomain,
    type FleetBillingDomain
} from './domains/billing';
export {
    createBluetoothDeviceDomain,
    type FleetBluetoothDeviceDomain
} from './domains/bluetooth-devices';
export {
    createBrandingDomain,
    type FleetBrandingDomain
} from './domains/branding';
export {createCarbonDomain, type FleetCarbonDomain} from './domains/carbon';
export {
    createCertificatesDomain,
    type FleetCertificatesDomain
} from './domains/certificates';
export {
    createCredentialDomain,
    type FleetCredentialDomain
} from './domains/credentials';
export {
    createDashboardDomain,
    type FleetDashboardDomain
} from './domains/dashboards';
export {
    createDeviceEventsDomain,
    type FleetDeviceEventsDomain
} from './domains/deviceevents';
export {
    createDeviceDomain,
    type FleetDeviceDomain
} from './domains/devices';
export {
    createEnergyDomain,
    type FleetEnergyDomain
} from './domains/energy';
export {
    createEnrollmentDomain,
    type EnrollmentProfile,
    type EnrollmentTicket,
    type FleetEnrollmentDomain
} from './domains/enrollment';
export {
    createEntitiesDomain,
    type FleetEntitiesDomain
} from './domains/entities';
export {
    createFirmwareDomain,
    type FleetFirmwareDomain
} from './domains/firmware';
export {
    createFleetMapDomain,
    type FleetFleetMapDomain
} from './domains/fleetmap';
export {
    createFleetSummaryDomain,
    type FleetFleetSummaryDomain
} from './domains/fleetsummary';
export {
    createGasConversionDomain,
    type FleetGasConversionDomain
} from './domains/gas-conversion';
export {
    createGroupDomain,
    type FleetGroupDomain,
    type GroupListParams
} from './domains/groups';
export {createKindDomain, type FleetKindDomain} from './domains/kinds';
export {
    createLocationDomain,
    type FleetLocationDomain,
    type LocationCreateInput,
    type LocationListParams,
    type LocationUpdateInput
} from './domains/locations';
export {
    createMediaDomain,
    type FleetMediaDomain
} from './domains/media';
export {
    createNotificationDomain,
    type FleetNotificationDomain
} from './domains/notifications';
export {
    createOperationsDomain,
    type FleetOperationsDomain
} from './domains/operations';
export {
    createOrganizationDomain,
    type FleetOrganizationDomain
} from './domains/organization';
export {
    createReportsDomain,
    type FleetReportsDomain
} from './domains/reports';
export {
    createSchedulesDomain,
    type FleetSchedulesDomain
} from './domains/schedules';
export {
    createScriptsDomain,
    type FleetScriptsDomain
} from './domains/scripts';
export {createSensorDomain, type FleetSensorDomain} from './domains/sensors';
export {
    createSystemDomain,
    type FleetSystemDomain
} from './domains/system';
export {
    createTagDomain,
    type FleetTagDomain,
    type HostTag
} from './domains/tags';
export {
    createTariffDomain,
    type FleetTariffDomain,
    type HostTariff,
    type HostTariffAssignment,
    type HostTariffAssignmentInput,
    type HostTariffAssignmentScope,
    type HostTariffBillingPeriod,
    type HostTariffBillingPeriodAt,
    type HostTariffBillingPeriodAtParams,
    type HostTariffBillingPeriodsParams,
    type HostTariffListItem,
    type HostTariffLiveSourceInput,
    type HostTariffPricing,
    type HostTariffPricingParams,
    type HostTariffPricingUnavailableReason,
    type HostTariffResolutionPoint,
    type HostTariffResolvedAssignment
} from './domains/tariffs';
export {
    createUserDomain,
    type FleetUserDomain,
    type HostOrganizationUser,
    type HostOrganizationUserCreateInput,
    type HostOrganizationUserDirectory,
    type HostOrganizationUserStatus,
    type HostOrganizationUserUpdateInput
} from './domains/users';
export {
    createVirtualDeviceDomain,
    type FleetVirtualDeviceDomain
} from './domains/virtual-devices';
export {
    createWaitingRoomDomain,
    type FleetWaitingRoomDomain
} from './domains/waiting-room';
export {
    createWebhooksDomain,
    type FleetWebhooksDomain
} from './domains/webhooks';
export {
    createFleetSdkError,
    FLEET_PAGINATION_NO_PROGRESS,
    FLEET_PERMISSION_DENIED_MESSAGE,
    FLEET_UNKNOWN_ERROR,
    type FleetSdkError,
    fleetSdkErrorMessage,
    fleetSdkFieldErrors,
    isFleetSdkError,
    toFleetSdkError
} from './errors';
export {
    createConstantStore,
    createExternalStore,
    type ExternalStore,
    type MutableExternalStore,
    mapExternalStore
} from './external-store';
export {createFormat} from './format';
export {
    createLiveDevices,
    type LiveDevices,
    type LiveDevicesOptions,
    UNKNOWN_DEVICE_REFRESH_MS
} from './live-devices';
export {
    FLEET_LIVE_EVENT,
    type FleetConnectionState,
    type FleetConnectionStatus,
    type FleetLiveEvent,
    type FleetLiveEventName,
    type FleetLiveEvents,
    type FleetLiveRequest
} from './live-events';
export {
    createSessionBoundOperationalBindings,
    EMPTY_OPERATIONAL_BINDINGS,
    listOperationalBindingKeys,
    MAX_OPERATIONAL_INTEGER_ID,
    OPERATIONAL_BINDING_SPECS,
    type OperationalBindingDeclarationType,
    type OperationalBindingKey,
    type OperationalBindings,
    OperationalBindingsError,
    type SessionBoundOperationalBindings,
    VIRTUAL_DEVICE_EXTERNAL_ID_MAX_LENGTH,
    VIRTUAL_DEVICE_EXTERNAL_ID_MIN_LENGTH,
    VIRTUAL_DEVICE_EXTERNAL_ID_PATTERN,
    VIRTUAL_DEVICE_ROLE_KEY_MAX_LENGTH,
    VIRTUAL_DEVICE_ROLE_KEY_MIN_LENGTH,
    VIRTUAL_DEVICE_ROLE_KEY_PATTERN,
    validateOperationalBindings
} from './operational-bindings';
export {
    createListAll,
    DEFAULT_PAGE_SIZE,
    type ListAll,
    MAX_PAGES
} from './pagination';
export {createPeriods} from './periods';
export {
    createResource,
    type FleetResource,
    type FleetResourceOptions
} from './resource';
export {
    createApiProxy,
    createRpcCaller,
    type HostApiMethod,
    type HostApiNode,
    type RpcCaller,
    splitMethod,
    toRpcMethod
} from './rpc-client';
export {
    matchSearch,
    rankSearchMatches,
    type SearchCandidate,
    type SearchHit,
    type SearchRange
} from './search-match';
export {
    ANONYMOUS_SESSION,
    createSessionGuard,
    type FleetSessionGuard,
    type FleetSessionIdentity,
    sameSessionIdentity,
    sessionInvalidates,
    watchSessionInvalidation
} from './session';
export type {
    FleetEvent,
    FleetEventTransport,
    FleetRpcTransport,
    FleetSubscriptionRequest,
    FleetTransport
} from './transport';
export type {
    DeviceCapabilities,
    DeviceControlCapabilities,
    DeviceControlRequest,
    DeviceDoorCapability,
    DeviceEnergyCapability,
    DeviceLeakCapability,
    DeviceMotionCapability,
    DeviceOccupancyCapability,
    DeviceRelayCapability,
    DeviceSmokeCapability,
    DeviceTemperatureCapability,
    FleetAlerts,
    FleetAudit,
    FleetCommandState,
    FleetCommandStatus,
    FleetDevices,
    FleetEnergy,
    FleetFormat,
    FleetFormatDateOptions,
    FleetFormatNumberOptions,
    FleetFreshness,
    FleetGroups,
    FleetHost,
    FleetKinds,
    FleetLocations,
    FleetNavigation,
    FleetOrganization,
    FleetOrganizationProfile,
    FleetPeriodBaseKey,
    FleetPeriodBucket,
    FleetPeriodKey,
    FleetPeriodOptions,
    FleetPeriodSelection,
    FleetPeriods,
    FleetPeriodWindow,
    FleetPermissionOperation,
    FleetPermissions,
    FleetResourceState,
    FleetRouteLocation,
    FleetRpc,
    FleetRpcAccess,
    FleetSdk,
    FleetSensors,
    FleetUser,
    FleetUsers,
    FleetVirtualDevices,
    HostDevice,
    HostDeviceComponent,
    HostError,
    HostLifecycle,
    HostLoadState,
    HostPagedEnvelope,
    MountedTemplate,
    MountTemplate,
    TemplateCustomization,
    TemplateRuntimeContext
} from './types';
