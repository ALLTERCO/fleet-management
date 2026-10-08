// Public aliases over the generated Fleet contract. Renderer bindings use
// these names so a template compiles against the same request and response
// shapes that the running host sends.

import type {Location} from '@api/location';
import type {HostMethod, HostParams, HostResult} from '../generated/contract';

export type {HostMethod, HostParams, HostResult};

export type HostDeviceListParams = HostParams<'device.list'>;
export type HostDeviceStatusTimelineParams =
    HostParams<'device.getstatustimeline'>;
export type HostDeviceStatusTimelineResult =
    HostResult<'device.getstatustimeline'>;

export type HostLocationListParams = HostParams<'location.list'>;
/** Curated location model keeps immutable effective metadata immutable. */
export type HostLocation = Location;

export type HostAlertListParams = HostParams<'alert.instance.list'>;
export type HostAlert = HostResult<'alert.instance.list'>['items'][number];
export type HostAlertTransition =
    HostResult<'alert.instance.listtransitions'>['items'][number];
export type HostAlertAnnotation =
    HostResult<'alert.instance.listannotations'>['items'][number];
export type HostAlertTimeline = {
    transitions: HostAlertTransition[];
    annotations: HostAlertAnnotation[];
};
export type HostAlertActions = {
    acknowledge(id: number): Promise<HostResult<'alert.instance.ack'>>;
    resolve(id: number): Promise<HostResult<'alert.instance.resolvemanual'>>;
    annotate(
        alertInstanceId: number,
        body: string
    ): Promise<HostResult<'alert.instance.annotate'>>;
};
export type HostAlertRuleListParams = HostParams<'alert.rule.list'>;
export type HostAlertRuleListResult = HostResult<'alert.rule.list'>;
export type HostAlertRule = HostResult<'alert.rule.get'>;
export type HostAlertRuleKind =
    HostResult<'alert.rule.listkinds'>['items'][number];
export type HostAlertRuleCreateInput = HostParams<'alert.rule.create'>;
export type HostAlertRuleUpdateInput = HostParams<'alert.rule.update'>;

export type HostEnergyCurrentParams = HostParams<'energy.current'>;
/**
 * `asOf` is when the SERVER ASSEMBLED THE ANSWER, not when a device took the
 * reading. The handler stamps `Date.now()` as it builds the response
 * (`backend/src/model/energy/currentHandler.ts`), reading the in-memory device
 * status it happens to hold — so a device that last reported an hour ago still
 * contributes to a response stamped one second ago.
 *
 * Label it "as of <time>", never "measured at <time>". For a reading's real
 * age fall back to the device's own `lastReportTs` on `HostDevice`; where that
 * is absent the age is unknown, and a template must say so rather than
 * substitute `asOf`. The same rule holds for every `asOf` on this contract
 * (`energy.syncstatus`, `fleetsummary.*`, `fleetmap.*`).
 */
export type HostEnergyCurrentResult = HostResult<'energy.current'>;
export type HostEnergyHistoryParams = HostParams<'energy.query'>;
export type HostEnergyHistoryResult = HostResult<'energy.query'>;
export type HostUtilityCostParams = HostParams<'bill.quote'>;
export type HostUtilityCost = HostResult<'bill.quote'>;
export type HostResourceQueryOptions = Readonly<{
    /** When false, skip the automatic request. The returned refresh action remains available. */
    enabled?: boolean;
}>;
export type HostLogicalMeterParams = HostParams<'energy.listlogicalmeters'>;
export type HostLogicalMeterResult = HostResult<'energy.listlogicalmeters'>;
export type HostMeterTopologyResult = HostResult<'energy.listmeterconnections'>;

export type HostSensorHistoryParams = HostParams<'sensor.query'>;
export type HostSensorHistoryResult = HostResult<'sensor.query'>;
export type HostSensorEventsParams = HostParams<'sensor.events'>;
export type HostSensorEventsResult = HostResult<'sensor.events'>;

export type HostVirtualRoleHistoryParams =
    HostParams<'virtualdevice.history.readrole'>;
export type HostVirtualRoleHistoryResult =
    HostResult<'virtualdevice.history.readrole'>;
export type HostVirtualRoleProvenanceParams =
    HostParams<'virtualdevice.history.readprovenance'>;
export type HostVirtualRoleProvenanceResult =
    HostResult<'virtualdevice.history.readprovenance'>;

export type HostKindListParams = HostParams<'kind.list'>;
export type HostKindListResult = HostResult<'kind.list'>;

export type HostWaitingRoomListParams = HostParams<'waitingroom.list'>;
export type HostWaitingRoomListResult = HostResult<'waitingroom.list'>;
export type HostWaitingRoomCountsParams = HostParams<'waitingroom.getcounts'>;
export type HostWaitingRoomCountsResult = HostResult<'waitingroom.getcounts'>;

export type HostFirmwareUpdateStatusParams =
    HostParams<'firmware.getautoupdatestatus'>;
export type HostFirmwareUpdateStatusResult =
    HostResult<'firmware.getautoupdatestatus'>;

export type HostCredentialListParams = HostParams<'credential.list'>;
export type HostCredentialListResult = HostResult<'credential.list'>;

export type HostAuditTimelineParams = HostParams<'audit.query'>;
export type HostAuditTimelineResult = HostResult<'audit.query'>;

export type {
    HostTariff,
    HostTariffAssignment,
    HostTariffAssignmentInput,
    HostTariffAssignmentScope,
    HostTariffBillingPeriod,
    HostTariffBillingPeriodAt,
    HostTariffBillingPeriodAtParams,
    HostTariffBillingPeriodsParams,
    HostTariffListItem,
    HostTariffLiveSourceInput,
    HostTariffPricing,
    HostTariffPricingParams,
    HostTariffPricingUnavailableReason,
    HostTariffResolutionPoint,
    HostTariffResolvedAssignment
} from './domains/tariffs';
export type {
    HostOrganizationUser,
    HostOrganizationUserCreateInput,
    HostOrganizationUserDirectory,
    HostOrganizationUserStatus,
    HostOrganizationUserUpdateInput
} from './domains/users';
