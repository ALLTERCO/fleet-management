// The Fleet SDK assembled from an injected transport, so a test can build the
// whole SDK without a session, a WebSocket or a Pinia store.

import {createControlDomain, type DeviceControlSubmitter} from './controls';
import {createAlertDomain} from './domains/alerts';
import {createAnalyticsDomain} from './domains/analytics';
import {createAuditDomain} from './domains/audit';
import {createAuthorizationDomain} from './domains/authorization';
import {createAutomationDomain} from './domains/automations';
import {createBillingDomain} from './domains/billing';
import {createBluetoothDeviceDomain} from './domains/bluetooth-devices';
import {createBrandingDomain} from './domains/branding';
import {createCarbonDomain} from './domains/carbon';
import {createCertificatesDomain} from './domains/certificates';
import {createCredentialDomain} from './domains/credentials';
import {createDashboardDomain} from './domains/dashboards';
import {createDeviceEventsDomain} from './domains/deviceevents';
import {createDeviceDomain} from './domains/devices';
import {createEnergyDomain} from './domains/energy';
import {createEnrollmentDomain} from './domains/enrollment';
import {createEntitiesDomain} from './domains/entities';
import {createFirmwareDomain} from './domains/firmware';
import {createFleetMapDomain} from './domains/fleetmap';
import {createFleetSummaryDomain} from './domains/fleetsummary';
import {createGasConversionDomain} from './domains/gas-conversion';
import {createGroupDomain} from './domains/groups';
import {createKindDomain} from './domains/kinds';
import {createLocationDomain} from './domains/locations';
import {createMediaDomain} from './domains/media';
import {createNotificationDomain} from './domains/notifications';
import {createOperationsDomain} from './domains/operations';
import {createOrganizationDomain} from './domains/organization';
import {createReportsDomain} from './domains/reports';
import {createSchedulesDomain} from './domains/schedules';
import {createScriptsDomain} from './domains/scripts';
import {createSensorDomain} from './domains/sensors';
import {createSystemDomain} from './domains/system';
import {createTagDomain} from './domains/tags';
import {createTariffDomain} from './domains/tariffs';
import {createUserDomain} from './domains/users';
import {createVirtualDeviceDomain} from './domains/virtual-devices';
import {createWaitingRoomDomain} from './domains/waiting-room';
import {createWebhooksDomain} from './domains/webhooks';
import {createConstantStore, type ExternalStore} from './external-store';
import {createFormat} from './format';
import {createHostCapabilities} from './host-capabilities';
import type {FleetLiveEvents} from './live-events';
import type {OperationalBindings} from './operational-bindings';
import {EMPTY_OPERATIONAL_BINDINGS} from './operational-bindings';
import {createListAll} from './pagination';
import {createPeriods} from './periods';
import {createApiProxy, createRpcCaller, splitMethod} from './rpc-client';
import type {FleetSessionIdentity} from './session';
import type {FleetRpcTransport} from './transport';
import type {
    FleetOrganizationProfile,
    FleetPermissions,
    FleetRpcAccess,
    FleetSdk,
    FleetUser,
    TemplateCustomization,
    TemplateRuntimeContext
} from './types';

export type FleetClient = {
    access: FleetRpcAccess;
    live: FleetLiveEvents;
    devices: ReturnType<typeof createDeviceDomain>;
    locations: ReturnType<typeof createLocationDomain>;
    kinds: ReturnType<typeof createKindDomain>;
    groups: ReturnType<typeof createGroupDomain>;
    alerts: ReturnType<typeof createAlertDomain>;
    tags: ReturnType<typeof createTagDomain>;
    tariffs: ReturnType<typeof createTariffDomain>;
    carbon: ReturnType<typeof createCarbonDomain>;
    gasConversion: ReturnType<typeof createGasConversionDomain>;
    waitingRoom: ReturnType<typeof createWaitingRoomDomain>;
    firmware: ReturnType<typeof createFirmwareDomain>;
    credentials: ReturnType<typeof createCredentialDomain>;
    enrollment: ReturnType<typeof createEnrollmentDomain>;
    notifications: ReturnType<typeof createNotificationDomain>;
    organization: ReturnType<typeof createOrganizationDomain>;
    operations: ReturnType<typeof createOperationsDomain>;
    dashboards: ReturnType<typeof createDashboardDomain>;
    entities: ReturnType<typeof createEntitiesDomain>;
    deviceevents: ReturnType<typeof createDeviceEventsDomain>;
    fleetsummary: ReturnType<typeof createFleetSummaryDomain>;
    fleetmap: ReturnType<typeof createFleetMapDomain>;
    analytics: ReturnType<typeof createAnalyticsDomain>;
    automations: ReturnType<typeof createAutomationDomain>;
    authorization: ReturnType<typeof createAuthorizationDomain>;
    schedules: ReturnType<typeof createSchedulesDomain>;
    scripts: ReturnType<typeof createScriptsDomain>;
    webhooks: ReturnType<typeof createWebhooksDomain>;
    reports: ReturnType<typeof createReportsDomain>;
    media: ReturnType<typeof createMediaDomain>;
    branding: ReturnType<typeof createBrandingDomain>;
    certificates: ReturnType<typeof createCertificatesDomain>;
    system: ReturnType<typeof createSystemDomain>;
    energy: ReturnType<typeof createEnergyDomain>;
    controls: ReturnType<typeof createControlDomain>;
    sensors: ReturnType<typeof createSensorDomain>;
    virtualDevices: ReturnType<typeof createVirtualDeviceDomain>;
    bluetoothDevices: ReturnType<typeof createBluetoothDeviceDomain>;
    billing: ReturnType<typeof createBillingDomain>;
    audit: ReturnType<typeof createAuditDomain>;
    users: ReturnType<typeof createUserDomain>;
    permissions: ExternalStore<FleetPermissions>;
    currentUser: ExternalStore<FleetUser | null>;
};

export type FleetClientOptions = {
    /** RPC only: live events reach the SDK through `live`, never from here. */
    transport: FleetRpcTransport;
    /** Wire events translated into the neutral vocabulary by the host. */
    live: FleetLiveEvents;
    permissions: ExternalStore<FleetPermissions>;
    currentUser: ExternalStore<FleetUser | null>;
    controlSubmitter?: DeviceControlSubmitter;
};

/** Bundles the RPC proxy, caller and paginator over one transport. */
export function createRpcAccess(transport: FleetRpcTransport): FleetRpcAccess {
    const call = createRpcCaller(transport);
    const listAll = createListAll(call);
    return {
        api: createApiProxy(transport),
        call,
        listAll,
        rpc<TResult = unknown>(method: string, params: object = {}) {
            const [namespace, methodPath] = splitMethod(method);
            return call<TResult>(namespace, methodPath, params);
        },
        rpcListAll<TItem = unknown>(
            method: string,
            params: object = {},
            pageSize?: number
        ) {
            const [namespace, methodPath] = splitMethod(method);
            return listAll<TItem>(namespace, methodPath, params, pageSize);
        }
    };
}

export function createFleetClient(options: FleetClientOptions): FleetClient {
    const access = createRpcAccess(options.transport);
    const devices = createDeviceDomain(access);
    return {
        access,
        live: options.live,
        devices,
        locations: createLocationDomain(access),
        kinds: createKindDomain(access),
        groups: createGroupDomain(access),
        alerts: createAlertDomain(access),
        tags: createTagDomain(access),
        tariffs: createTariffDomain(access),
        carbon: createCarbonDomain(access),
        gasConversion: createGasConversionDomain(access),
        waitingRoom: createWaitingRoomDomain(access),
        firmware: createFirmwareDomain(access),
        credentials: createCredentialDomain(access),
        enrollment: createEnrollmentDomain(access),
        notifications: createNotificationDomain(access),
        organization: createOrganizationDomain(access),
        operations: createOperationsDomain(access),
        dashboards: createDashboardDomain(access),
        entities: createEntitiesDomain(access),
        deviceevents: createDeviceEventsDomain(access),
        fleetsummary: createFleetSummaryDomain(access),
        fleetmap: createFleetMapDomain(access),
        analytics: createAnalyticsDomain(access),
        automations: createAutomationDomain(access),
        authorization: createAuthorizationDomain(access),
        schedules: createSchedulesDomain(access),
        scripts: createScriptsDomain(access),
        webhooks: createWebhooksDomain(access),
        reports: createReportsDomain(access),
        media: createMediaDomain(access),
        branding: createBrandingDomain(access),
        certificates: createCertificatesDomain(access),
        system: createSystemDomain(access),
        energy: createEnergyDomain(access),
        controls: createControlDomain(
            devices,
            options.permissions,
            options.controlSubmitter ??
                (async () => {
                    throw new Error(
                        'Semantic device controls are not bound to this host'
                    );
                })
        ),
        sensors: createSensorDomain(access),
        virtualDevices: createVirtualDeviceDomain(access),
        bluetoothDevices: createBluetoothDeviceDomain(access),
        billing: createBillingDomain(access),
        audit: createAuditDomain(access),
        users: createUserDomain(access),
        permissions: options.permissions,
        currentUser: options.currentUser
    };
}

export type TemplateRuntimeContextOptions = {
    fleet: FleetClient;
    customization: ExternalStore<TemplateCustomization>;
    /** Omitted only by older embedders; they receive an immutable null profile. */
    organizationProfile?: TemplateRuntimeContext['organizationProfile'];
    /** Omitted only by older embedders; they receive an immutable empty set. */
    operationalBindings?: ExternalStore<OperationalBindings>;
    navigation: TemplateRuntimeContext['navigation'];
    session: ExternalStore<FleetSessionIdentity>;
    hostVersion: string;
    /** Releases whatever the host wired up for this context. */
    dispose: () => void;
};

export function createTemplateRuntimeContext(
    options: TemplateRuntimeContextOptions
): TemplateRuntimeContext {
    // Every domain, taken as a set rather than relisted. This block used to
    // name all thirty-four by hand, so adding one meant editing here too and
    // forgetting meant it never reached a template.
    const {access, ...domains} = options.fleet;
    const fleet: FleetSdk = {
        ...domains,
        rpc: {
            api: access.api,
            call: <M extends import('./data-contract').HostMethod>(
                method: M,
                params: import('./data-contract').HostParams<M>
            ) =>
                access.rpc<import('./data-contract').HostResult<M>>(
                    method,
                    params as object
                ),
            listAll: access.rpcListAll
        }
    };

    const organizationProfile =
        options.organizationProfile ??
        createConstantStore<FleetOrganizationProfile | null>(null);

    return {
        fleet,
        customization: options.customization,
        organizationProfile,
        format: createFormat(organizationProfile),
        periods: createPeriods(organizationProfile),
        host: createHostCapabilities({
            version: options.hostVersion,
            sdk: fleet
        }),
        operationalBindings:
            options.operationalBindings ??
            createConstantStore(EMPTY_OPERATIONAL_BINDINGS),
        navigation: options.navigation,
        session: options.session,
        hostVersion: options.hostVersion,
        dispose: options.dispose
    };
}
