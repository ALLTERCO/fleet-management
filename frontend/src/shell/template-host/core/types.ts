// Framework-neutral public types. Nothing here may name a Vue, React or Pinia
// type; renderer wrappers live in ../vue and ../react.

import type {DeviceCapabilities as BackendDeviceCapabilities} from '@api/deviceCapabilities';
import type {DerivedDeviceProfile} from '@api/deviceProfile';
import type {DeviceSource} from '@api/deviceSource';
import type {FleetAdminDestination, FleetAdminPath} from './admin-destinations';
import type {HostMethod, HostParams, HostResult} from './data-contract';
import type {FleetAlertDomain} from './domains/alerts';
import type {FleetAnalyticsDomain} from './domains/analytics';
import type {FleetAuditDomain} from './domains/audit';
import type {FleetAuthorizationDomain} from './domains/authorization';
import type {FleetAutomationDomain} from './domains/automations';
import type {FleetBillingDomain} from './domains/billing';
import type {FleetBluetoothDeviceDomain} from './domains/bluetooth-devices';
import type {FleetBrandingDomain} from './domains/branding';
import type {FleetCarbonDomain} from './domains/carbon';
import type {FleetCertificatesDomain} from './domains/certificates';
import type {FleetCredentialDomain} from './domains/credentials';
import type {FleetDashboardDomain} from './domains/dashboards';
import type {FleetDeviceEventsDomain} from './domains/deviceevents';
import type {FleetDeviceDomain} from './domains/devices';
import type {FleetEnergyDomain} from './domains/energy';
import type {FleetEnrollmentDomain} from './domains/enrollment';
import type {FleetEntitiesDomain} from './domains/entities';
import type {FleetFirmwareDomain} from './domains/firmware';
import type {FleetFleetMapDomain} from './domains/fleetmap';
import type {FleetFleetSummaryDomain} from './domains/fleetsummary';
import type {FleetGasConversionDomain} from './domains/gas-conversion';
import type {FleetGroupDomain} from './domains/groups';
import type {FleetKindDomain} from './domains/kinds';
import type {FleetLocationDomain} from './domains/locations';
import type {FleetMediaDomain} from './domains/media';
import type {FleetNotificationDomain} from './domains/notifications';
import type {FleetOperationsDomain} from './domains/operations';
import type {FleetOrganizationDomain} from './domains/organization';
import type {FleetReportsDomain} from './domains/reports';
import type {FleetSchedulesDomain} from './domains/schedules';
import type {FleetScriptsDomain} from './domains/scripts';
import type {FleetSensorDomain} from './domains/sensors';
import type {FleetSystemDomain} from './domains/system';
import type {FleetTagDomain} from './domains/tags';
import type {FleetTariffDomain} from './domains/tariffs';
import type {FleetUserDomain} from './domains/users';
import type {FleetVirtualDeviceDomain} from './domains/virtual-devices';
import type {FleetWaitingRoomDomain} from './domains/waiting-room';
import type {FleetWebhooksDomain} from './domains/webhooks';
import type {FleetSdkError} from './errors';
import type {ExternalStore} from './external-store';
import type {FleetLiveEvents} from './live-events';
import type {OperationalBindings} from './operational-bindings';
import type {ListAll} from './pagination';
import type {HostApiNode, RpcCaller} from './rpc-client';
import type {FleetSessionIdentity} from './session';
import type {HostVisual} from './visual';

/**
 * Everything a curated domain needs to reach the backend. Domains are pure
 * factories over this, which is what keeps them free of a global singleton.
 */
export type FleetRpcAccess = {
    /** Property-access proxy over the whole generated surface. */
    api: HostApiNode;
    /** `call(namespace, methodPath, params)` — segments are normalized. */
    call: RpcCaller;
    /** `listAll(namespace, methodPath, params, pageSize)`. */
    listAll: ListAll;
    /** `rpc('alert.instance.ack', params)` — one fully-qualified method. */
    rpc<TResult = unknown>(method: string, params?: object): Promise<TResult>;
    /** `rpcListAll('device.list', params)` — one fully-qualified method. */
    rpcListAll<TItem = unknown>(
        method: string,
        params?: object,
        pageSize?: number
    ): Promise<TItem[]>;
};

export type HostLoadState = 'idle' | 'loading' | 'ready' | 'error';

// What a device MEASURES, not the management operations it supports. Fleet's
// own DeviceCapabilities is that other concept. Mirrors host.ts in the
// templates repository.
export type DeviceEnergyCapability = {
    power_w?: number | null;
    total_energy_wh?: number | null;
};
export type DeviceTemperatureCapability = {
    temperature_c?: number | null;
    humidity_pct?: number | null;
};
export type DeviceRelayCapability = {state: boolean};
export type DeviceDoorCapability = {open: boolean};
export type DeviceMotionCapability = {detected: boolean};
export type DeviceOccupancyCapability = {
    occupied: boolean;
    count?: number | null;
};
/** Water detected. `flood:N.alarm` on a wired sensor, BTHome `moisture`. */
export type DeviceLeakCapability = {detected: boolean};
/** Smoke detected. `smoke:N.alarm` on a wired sensor, BTHome `smoke`. */
export type DeviceSmokeCapability = {detected: boolean};

/** One component the device reports, as its own status names it. `key` is the
 * exact status key ("switch:1"); `type` is the part before the index. */
export type HostDeviceComponent = {
    type: string;
    key: string;
};

export type DeviceControlCapabilities = {
    relay?: number[];
    light?: number[];
    cover?: number[];
    thermostat?: number[];
};

export type DeviceCapabilities = {
    energy?: DeviceEnergyCapability;
    temperature?: DeviceTemperatureCapability;
    relay?: DeviceRelayCapability;
    door?: DeviceDoorCapability;
    motion?: DeviceMotionCapability;
    occupancy?: DeviceOccupancyCapability;
    leak?: DeviceLeakCapability;
    smoke?: DeviceSmokeCapability;
    /** Every component the device's status names, in the order it reports
     * them. Present whenever a status was read, so a template can tell "this
     * device has no switch" from "this device reported nothing at all"
     * instead of guessing from the model name. */
    components?: readonly HostDeviceComponent[];
};

/** How to render a device's identifying picture. Fleet Manager resolves this
 * once (via resolveDeviceLogo, its single source of image logic); templates
 * only render the descriptor and never compute an image URL themselves. */
export type HostDeviceLogo = HostVisual;

/** Battery reading, when the device reports one. */
export type HostDeviceBattery = {
    percent?: number;
    /** True when running on external power rather than the cell. */
    external?: boolean;
};

/** Which firmware channels have a newer version waiting. */
export type HostDeviceFirmwareUpdate = {
    stable?: string;
    beta?: string;
};

/** Link quality, when the device reports it. */
export type HostDeviceSignal = {
    /** dBm. Higher is better; roughly -60 good, -75 usable. */
    rssi?: number;
    ssid?: string;
};

export type HostDevice = {
    shellyID: string;
    /** Replacement-stable device.list identity. `shellyID` is the current
     * external routing identifier and may change after a hardware swap. */
    id: number;
    name?: string;
    /** Model or app name, whichever the device reported. Kept for the callers
     * that already read it; `model` below is the unfolded one. */
    type?: string;
    /** Hardware model on its own. `type` folds model and app into one string,
     * so a template could not tell which it had. */
    model?: string;
    /** Device picture descriptor, resolved host-side from the device model. */
    logo?: HostDeviceLogo;
    online?: boolean;
    /** The backend's own presence. `pending` means still being admitted —
     * it used to be flattened to `offline`, which reads as dead. */
    presence?: 'online' | 'offline' | 'pending';
    /** First group the device belongs to, so templates can group without a join. */
    groupId?: number | string | null;
    groupIds?: number[];
    locationId?: number | null;
    tagIds?: number[];
    /** Catalog classification assigned to the device, e.g. 'lighting'.
     * Null for virtual and BLU records, which have no kind. */
    kind?: string | null;
    capabilities?: DeviceCapabilities;
    /** What the device supports DOING — backup, firmware, Matter, add-ons,
     * Wall Display. `capabilities` above is what it MEASURES; two different
     * questions, and the backend answers both. */
    supports?: BackendDeviceCapabilities;
    /** Battery reading, absent on mains devices. */
    battery?: HostDeviceBattery;
    /** Link quality, absent when the device reports none. */
    signal?: HostDeviceSignal;
    /** Firmware waiting, by channel. Absent means never checked; present
     * with no channel means checked and up to date. */
    firmwareUpdate?: HostDeviceFirmwareUpdate;
    /** Physical controls derived from actual component keys in device status. */
    controlCapabilities?: DeviceControlCapabilities;
    /** Epoch millis the backend last heard from the device. Absent when the
     * payload carries none, so a reading's age stays unknown rather than made up. */
    lastReportTs?: number;
    /** How the device is connected. `online` says whether it is reachable;
     * this says by what route. Typed, because this comment used to say
     * "websocket" and templates believed it. */
    source?: DeviceSource;
    /** The device's own Shelly.ListMethods output — what it actually supports.
     * Fleet Manager decides which actions to show from this, so a template that
     * cannot read it has to guess from the model name. */
    methods?: string[];
    /** Composed entity ids on this device, for per-entity UI. */
    entities?: string[];
    /** ms-epoch of the last sleep event. A battery sensor that is sleeping is
     * not a dead one, and without this the two look identical. */
    lastSeenSleepingMs?: number;
    /** What Fleet Manager worked out about the device: its family, the
     * component types it has, the derived flags. NOT the device's own word —
     * Shelly's `profile` is the operating mode of a multi-profile device and
     * reaches you as `info.profile`. */
    derivedProfile?: DerivedDeviceProfile;
    status?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    raw?: unknown;
};

export type HostPagedEnvelope<T> = {
    items: T[];
    total?: number;
    limit?: number;
    offset?: number;
    has_more?: boolean;
    /** Present (even null) on keyset pages; then paging uses it, not offset. */
    next_cursor?: string | null;
};

/** Loosely-typed error shape exposed by the `@host` surface. */
export type HostError = {
    code?: string;
    message: string;
    data?: unknown;
};

/** Missing, stale, offline and permission-filtered are four different states
 * and a template must be able to tell them apart. */
export type FleetFreshness =
    | 'live'
    | 'stale'
    | 'offline'
    | 'unknown'
    | 'permission_filtered';

/**
 * The lifecycle every host object a binding holds obeys. React runs cleanup on
 * trees it keeps mounted, so releasing and ending an object are two different
 * moves: `detach` gives back what `attach` took and can be attached again,
 * `dispose` ends the object for good.
 */
export type HostLifecycle = {
    attach?(): void;
    detach?(): void;
    dispose(): void;
};

/** The neutral async-resource shape both renderer bindings project. */
export type FleetResourceState<T> = {
    status: HostLoadState;
    data: T;
    error: FleetSdkError | null;
    /** Epoch millis of the last load or live update; null if never loaded. */
    updatedAt: number | null;
    freshness: FleetFreshness;
};

export type FleetUser = {
    id?: string;
    email?: string;
    name?: string;
    username?: string;
    isAdmin: boolean;
    /** Read-only reader: every write control should be hidden. */
    isViewer: boolean;
    /** System persona keys, priority first. Empty when signed out. */
    roles: readonly string[];
    loggedIn: boolean;
};

export type FleetPermissionOperation =
    | 'create'
    | 'read'
    | 'update'
    | 'delete'
    | 'execute';

export type FleetPermissions = {
    isAdmin: boolean;
    /** Read-only reader: every write control should be hidden. */
    isViewer: boolean;
    /** System persona keys, priority first. */
    roles: readonly string[];
    can(
        action: string,
        operation?: FleetPermissionOperation,
        itemId?: string | number
    ): boolean;
    /** Group ids this caller is scoped to; empty when unlimited. */
    scopedGroupIds: readonly number[];
    scopedGroupsUnlimited: boolean;
    /** Location ids this caller is scoped to, already expanded to every
     *  descendant by the backend; empty when unlimited. */
    scopedLocationIds: readonly number[];
    scopedLocationsUnlimited: boolean;
};

/** The approved customization patch, left open so the SDK never tracks a
 * template's override schema version. */
export type TemplateCustomization = Record<string, unknown>;

/** Organization-owned market defaults exposed to every mounted template. */
export type FleetOrganizationProfile = {
    id: string;
    displayName: string | null;
    /** IANA zone name. Fleet resolves an unset organization value to UTC.
     *  Anchors a billing period to a calendar day only where nothing more
     *  specific applies — a tariff's own time zone always wins for that bill. */
    timezoneDefault: string;
    /** BCP-47 region tag. Fleet resolves an unset organization value to en-US.
     *  Decides only how a date, number or amount is
     *  WRITTEN: day order, decimal separator, symbol placement. Never what a
     *  bill is charged in and never which day a reading is counted on.
     *  Prefer `format` on `TemplateRuntimeContext` over reading this tag
     *  directly — see `FleetFormat` below. */
    localeDefault: string;
    /** ISO 4217 code money is presented in when nothing more specific
     *  applies (a new tariff's starting point, a report with no tariff
     *  scope). An existing tariff still bills, and must be formatted, in its
     *  own `currency` (`tariffs`/`billing`) — never this default. */
    currencyDefault: string | null;
    unitSystemDefault: 'metric' | 'imperial' | null;
};

/**
 * Region-aware formatting for templates — the way this organization writes a
 * date, a number, or a money amount. Full boundary in
 * `docs/reference/separate-ui-host-sdk.md`; the short version:
 *   - region (`localeDefault`) decides only how a value is WRITTEN;
 *   - currency decides what a person is CHARGED — always the tariff's own
 *     (`tariffs`/`billing`), never guessed from the region;
 *   - the billing time zone decides which DAY a reading is counted on —
 *     always the tariff's own, never the region and never `timezoneDefault`.
 * A billing day therefore still needs the tariff's zone passed explicitly in
 * `options.timeZone`; the organization default below is a display clock only.
 */
export type FleetFormat = {
    /** Region-aware calendar date, e.g. "Mar 4, 2026" vs "4 Mar 2026". */
    date(
        input: number | string | Date,
        options?: FleetFormatDateOptions
    ): string;
    /** Region-aware number: digit grouping, decimal and thousands separators. */
    number(value: number, options?: FleetFormatNumberOptions): string;
    /**
     * Region-aware money amount. `currency` is required: the ISO 4217 code
     * the amount is actually billed in (read a tariff's `currency`, or a
     * bill quote's `currency`) — never the organization's own
     * `currencyDefault`, and never guessed from the region.
     */
    amount(
        value: number,
        currency: string,
        options?: FleetFormatNumberOptions
    ): string;
};

/**
 * Which clock a timestamp is written on:
 *   1. `options.timeZone`, when the caller states one — the only way to land a
 *      value on a specific tariff's billing day;
 *   2. otherwise the organization's `timezoneDefault`, so two people in two
 *      countries reading the same fleet see the same wall clock;
 *   3. otherwise UTC, never the browser's own zone, so a rendered timestamp
 *      does not change meaning with who is looking at it.
 */
export type FleetFormatDateOptions = Intl.DateTimeFormatOptions & {
    timeZone?: string;
};

/**
 * A number and a money amount carry no clock, so `timeZone` is accepted here
 * only so one options object can be handed to any of the three calls; it does
 * not change what either one writes.
 */
export type FleetFormatNumberOptions = Intl.NumberFormatOptions & {
    timeZone?: string;
};

/** The four calendar-anchored periods every other key is described in terms of. */
export type FleetPeriodBaseKey = 'today' | 'week' | 'month' | 'year';

export type FleetPeriodKey =
    | FleetPeriodBaseKey
    | 'last24'
    | 'last7'
    | 'last30'
    | 'last90'
    | 'lastMonth'
    | 'ytd'
    | 'lastYear'
    | 'custom';

export type FleetPeriodBucket = '1 hour' | '1 day' | '1 month';

/** What the operator picked; `from`/`to` are plain YYYY-MM-DD days, only for `custom`. */
export type FleetPeriodSelection = {
    readonly key: FleetPeriodKey;
    readonly from?: string;
    readonly to?: string;
};

/** The instant range a data source is asked for, and the grain it answers in. */
export type FleetPeriodWindow = {
    readonly from: string;
    readonly to: string;
    readonly bucket: FleetPeriodBucket;
};

export type FleetPeriodOptions = {
    /** The instant the window ends at; anchor it once so two readers cover one window. */
    now?: Date;
    /** A read scoped to one location passes that location's own zone. */
    timeZone?: string | null;
};

/** Fleet resolves named periods on the caller's zone, else the organization's, else UTC — never the browser's. */
export type FleetPeriods = {
    /** Which clock a window would be taken on, for a template that must show it. */
    timeZone(zone?: string | null): string;
    window(
        selection: FleetPeriodSelection,
        options?: FleetPeriodOptions
    ): FleetPeriodWindow;
    /** The same period one step back, clipped to the same elapsed point. */
    previousWindow(
        selection: FleetPeriodSelection,
        options?: FleetPeriodOptions
    ): FleetPeriodWindow;
    granularity(
        selection: FleetPeriodSelection,
        options?: FleetPeriodOptions
    ): FleetPeriodBaseKey;
    bucketKeys(
        selection: FleetPeriodSelection,
        options?: FleetPeriodOptions
    ): string[];
    dailyBucketKeys(
        from: string,
        to: string,
        options?: FleetPeriodOptions
    ): string[];
    floorBucketKey(
        instant: string | number | Date,
        bucket: FleetPeriodBucket,
        options?: FleetPeriodOptions
    ): string | null;
    nextBucketKey(
        bucketKey: string,
        bucket: FleetPeriodBucket,
        options?: FleetPeriodOptions
    ): string | null;
};

/**
 * Which Fleet a template is running inside, and what that Fleet has. One
 * value with one source: Fleet's own build version, injected by the shell.
 *
 * This is how a template written for a newer Fleet stays usable on an older
 * one: ask before you call, hide the panel, do not throw.
 */
export type FleetHost = {
    /** The running Fleet build, e.g. "1.92.0". Show this; do not parse it. */
    version: string;
    /** The same build as one integer that orders correctly:
     *  major*1000000 + minor*1000 + patch, so 1.92.0 is 1092000 and sorts
     *  after 1.9.0, which a string comparison gets backwards. 0 when the
     *  host cannot state a readable version, so it is never a silent yes. */
    versionNumber: number;
    /** True only when this Fleet is at or above `floor` ("1.92" or "1.92.0"). */
    atLeast(floor: string): boolean;
    /**
     * True when this Fleet has `name`. Two spellings, both runtime questions:
     *   - `fleet.energy`, `fleet.energy.history` probe the live SDK object;
     *   - `rpc:energy.query` asks this build's generated method catalog.
     * Any other spelling is false, so a typo never reads as a yes.
     *
     * It does NOT answer for an `@host` export name: `has('useEnergyHistory')`
     * is false. An import is a build-time question: a template that imports a
     * name this Fleet does not export never builds, so there is nothing to ask
     * at runtime. Declare those in the manifest's `requiredHostExports` and the
     * boundary gate refuses the build by name.
     *
     * It also cannot answer whether the caller is ALLOWED to call it (ask
     * `permissions.can`), whether a device supports a device method (read
     * `HostDevice.methods`), or whether the call will succeed.
     */
    has(name: string): boolean;
};

export type FleetRouteLocation = {
    pathname: string;
    search: string;
    hash: string;
};

export type FleetNavigation = {
    location: ExternalStore<FleetRouteLocation>;
    navigate(target: string, options?: {replace?: boolean}): Promise<void>;
    /**
     * Opens Fleet's own admin app. Name the screen with a destination key so
     * Fleet can rename the URL under you; a raw path is accepted for the
     * screens no key covers, and Fleet promises nothing about those.
     */
    openAdmin(target?: FleetAdminDestination): void;
    openAdmin(target: FleetAdminPath): void;
    /** Keeps the original string form source-compatible for existing hosts. */
    openAdmin(target: string): void;
};

/** A physical command's observable lifecycle. `confirmed` needs evidence. */
export type FleetCommandStatus =
    | 'idle'
    | 'pending'
    | 'submitted'
    | 'confirmed'
    | 'failed'
    | 'timed_out';

export type FleetCommandState<T> = {
    status: FleetCommandStatus;
    /** The last state the backend confirmed; a rejection rolls back to it. */
    confirmed: T;
    /** What the UI is optimistically showing, if anything. */
    optimistic: T | null;
    error: FleetSdkError | null;
    /** Identifies the issued command; pass it back to confirm(). */
    token: number;
};

export type MountedTemplate = {
    unmount(): void | Promise<void>;
};

export type MountTemplate = (
    element: HTMLElement,
    context: TemplateRuntimeContext
) => MountedTemplate | Promise<MountedTemplate>;

export type TemplateRuntimeContext = {
    fleet: FleetSdk;
    customization: ExternalStore<TemplateCustomization>;
    /** Live organization defaults. They are runtime data, never build customization. */
    organizationProfile: ExternalStore<FleetOrganizationProfile | null>;
    /** Date, number and money formatting that follows the organization's
     *  region. See `FleetFormat` above for what it must never be used for. */
    format: FleetFormat;
    /** Named periods resolved on the tenant clock, so no template does calendar arithmetic. */
    periods: FleetPeriods;
    /** Which Fleet this is, and what it has. Ask this before calling
     *  something a newer Fleet added. */
    host: FleetHost;
    /** Deployment-owned backend bindings. Never part of customization. */
    operationalBindings: ExternalStore<OperationalBindings>;
    navigation: FleetNavigation;
    /** Who this context belongs to. Changes invalidate every snapshot. */
    session: ExternalStore<FleetSessionIdentity>;
    /** The same string as `host.version`. Kept because an exposed name is a
     *  promise; `host` is where the comparison and the capability check are. */
    hostVersion: string;
    /** Releases subscriptions, watchers and timers this context owns. */
    dispose(): void;
};

// Declared after the domain modules so the SDK shape stays in one place.
// The concrete factories live in `./domains/`.
export type FleetSdk = {
    /** Full generated API surface plus the documented escape hatches. */
    rpc: FleetRpc;
    /** The only live-event surface: neutral names, never wire names. */
    live: FleetLiveEvents;
    devices: FleetDevices;
    locations: FleetLocations;
    kinds: FleetKinds;
    groups: FleetGroups;
    alerts: FleetAlerts;
    tags: FleetTagDomain;
    tariffs: FleetTariffDomain;
    /** Full assignment-aware utility bill quotes; templates never pass rates. */
    billing: FleetBillingDomain;
    /** Versioned physical emissions factors and separate carbon valuations. */
    carbon: FleetCarbonDomain;
    /** Versioned gas zones, meter profiles and calorific values. */
    gasConversion: FleetGasConversionDomain;
    waitingRoom: FleetWaitingRoomDomain;
    firmware: FleetFirmwareDomain;
    credentials: FleetCredentialDomain;
    /** Mint a token so a device can connect. See domains/enrollment.ts. */
    enrollment: FleetEnrollmentDomain;
    /** Where an alert goes, and whether it arrived. */
    notifications: FleetNotificationDomain;
    /** Org profile, defaults, and the shared settings bag. */
    organization: FleetOrganization;
    /** Fleet-owned operational policies and their evidence-backed verdicts. */
    operations: FleetOperationsDomain;
    /** Dashboards and the items on them. */
    dashboards: FleetDashboardDomain;
    entities: FleetEntitiesDomain;
    deviceevents: FleetDeviceEventsDomain;
    fleetsummary: FleetFleetSummaryDomain;
    fleetmap: FleetFleetMapDomain;
    analytics: FleetAnalyticsDomain;
    automations: FleetAutomationDomain;
    /** Personas, scoped assignments, and organization role grants. */
    authorization: FleetAuthorizationDomain;
    schedules: FleetSchedulesDomain;
    scripts: FleetScriptsDomain;
    webhooks: FleetWebhooksDomain;
    reports: FleetReportsDomain;
    media: FleetMediaDomain;
    branding: FleetBrandingDomain;
    certificates: FleetCertificatesDomain;
    /** Named, permission-filtered Fleet configuration profiles. */
    system: FleetSystemDomain;
    energy: FleetEnergy;
    controls: FleetControls;
    sensors: FleetSensors;
    virtualDevices: FleetVirtualDeviceDomain;
    bluetoothDevices: FleetBluetoothDeviceDomain;
    audit: FleetAudit;
    users: FleetUsers;
    permissions: ExternalStore<FleetPermissions>;
    currentUser: ExternalStore<FleetUser | null>;
};

export type DeviceControlRequest =
    | {kind: 'relay'; shellyID: string; id: number; on: boolean}
    | {
          kind: 'light';
          shellyID: string;
          id: number;
          on?: boolean;
          brightness?: number;
      }
    | {
          kind: 'cover';
          shellyID: string;
          id: number;
          action: 'open' | 'close' | 'stop' | 'position';
          position?: number;
      }
    | {
          kind: 'thermostat';
          shellyID: string;
          id: number;
          action: 'increase' | 'decrease';
          delta?: number;
      };

export type FleetControls = import('./controls').FleetControls;

export type {HostVisual};

export type FleetRpc = {
    /** Property-access proxy over the whole generated surface. */
    api: HostApiNode;
    /** Complete generated API with exact request and response typing. */
    call<M extends HostMethod>(
        method: M,
        params: HostParams<M>
    ): Promise<HostResult<M>>;
    listAll<TItem = unknown>(
        method: string,
        params?: object,
        pageSize?: number
    ): Promise<TItem[]>;
};

export type FleetDevices = FleetDeviceDomain;

export type FleetLocations = FleetLocationDomain;

export type FleetGroups = FleetGroupDomain;

export type FleetKinds = FleetKindDomain;
export type FleetOrganization = FleetOrganizationDomain;

export type FleetAlerts = FleetAlertDomain;

// Aliases, not copies. These three were typed out by hand, so a method added
// to the domain stayed invisible to every template until someone remembered
// to edit this file too — a silent drop nobody would see.
export type FleetEnergy = FleetEnergyDomain;

export type FleetSensors = FleetSensorDomain;

export type FleetVirtualDevices = FleetVirtualDeviceDomain;

export type FleetAudit = FleetAuditDomain;

export type FleetUsers = FleetUserDomain;
