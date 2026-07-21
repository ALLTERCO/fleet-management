import type ws from 'ws';
import type AbstractDevice from './model/AbstractDevice';
import type {DeviceProfile} from './model/deviceProfile';
import type {FleetRole} from './modules/zitadel';

/** Device-specific UI surfaces, derived from what the device announces
 *  (components/methods). Exception: `wallDisplay` — no advertised RPC marks
 *  the relay/thermostat mode switch, so it keys off app/model like the
 *  backend's entity composer already does. */
export interface DeviceUiCapabilities {
    /** Device advertises Pill.SetConfig — pin-mode configuration UI */
    pillPinMode: boolean;
    /** Device reports a cury:N component in status */
    cury: boolean;
    /** LED settings via a device-reported `*_ui` component (plugs_ui, …) */
    ledSettings: boolean;
    /** Wall Display (app WallDisplayV2 / model SAWD) — relay↔thermostat mode */
    wallDisplay: boolean;
}

export interface DeviceCapabilities {
    backup?: boolean;
    /** Device advertises the RPCs the FM restore flow sends
     *  (Sys.RestoreBackup + Shelly.GetDeviceInfo) */
    restore?: boolean;
    firmwareUpdate?: boolean;
    firmwareCheck?: boolean;
    otaCommit?: boolean;
    matter?: boolean;
    tlsUserCA?: boolean;
    tlsClientCert?: boolean;
    /** Device has XMOD — Powered by Shelly (XMOD1 or XT1) */
    xmod?: boolean;
    /** Device has Service component — XT1 with service module (HVAC, irrigation, etc.) */
    service?: boolean;
    /** Device supports Service.ResetCounters (water consumption, energy, etc.) */
    serviceResetCounters?: boolean;
    /** Device supports user-created virtual components (Virtual.Add/Delete) */
    virtualComponents?: boolean;
    /** Addon services the device advertises via ListMethods, as
     *  sys.device.addon_type values; [] = no slot or none advertised */
    addons?: string[];
    /** Device-specific UI feature flags */
    ui?: DeviceUiCapabilities;
}

export interface ShellyDeviceExternal {
    shellyID: string;
    id: number;
    source: string | null;
    info: any;
    status: any;
    presence: 'online' | 'offline' | 'pending';
    settings: any;
    entities: string[];
    capabilities: DeviceCapabilities;
    /** Raw Shelly.ListMethods output. The frontend derives UI capabilities
     *  (which actions to show, which RPCs to call) from this list — it is
     *  the source of truth for what the device supports. */
    methods?: string[];
    meta: any;
    /** Groups this device currently belongs to. Populated by DeviceComponent
     *  from `organization.group_members` at serialization time. Empty if the
     *  device isn't a member of any group. */
    groupIds?: number[];
    /** Primary location, or null. From `organization.location_assignments`. */
    locationId?: number | null;
    /** Tags assigned to this device. From `organization.tag_assignments`. */
    tagIds?: number[];
    // Optional so callers not needing the profile stay unaffected.
    profile?: DeviceProfile;
    /** ms-epoch of the last `sys.sleep` event; independent of `presence`. */
    lastSeenSleepingMs?: number;
}

export interface ShellyMessageData {
    jsonrpc: '2.0';
    id: number;
    src: string;
    method: string;
    params?: any;
}

export interface ShellyMessage {
    data_sent: ShellyMessageData;
    cb?: (result?: ShellyMessageIncoming, err?: any) => void;
}

export interface ShellyMessageIncoming {
    id?: number;
    src: string;
    dst: string;
    method: 'NotifyStatus' | 'NotifyEvent' | string;
    result?: any;
    params?: any;
    error?: any;
}

interface outgoing_jsonrpc_error {
    jsonrpc?: '2.0';
    id: number | null;
    src: string;
    dst?: string | undefined;
    result?: any;
    error: {
        code: number;
        message: string;
    };
}

export type ShellyResponseCallback = (
    resp: ShellyMessageIncoming | outgoing_jsonrpc_error,
    req?: ShellyMessageData
) => void;

export interface ShellyMessageUnsafe {
    method: string;
    id: number;
    src: string;
    params?: object;
}

export interface message_handler_t {
    resolve: (value: unknown) => void;
    reject: (reason?: any) => void;
    method: string;
}

export interface json_rpc_event {
    method: string;
    params: Record<string, any>;
}

export interface user_t {
    username: string;
    password: string;
    permissions: string[];
    group: string;
    enabled: boolean;
    // All JWT roles, sorted by catalog priority. roles[0] is the priority pick.
    roles?: FleetRole[];
    /** Zitadel organization the user belongs to — source of scope isolation. */
    organizationId?: string;
    /** True when this FM process pins the authenticated user to one tenant. */
    tenantPinned?: boolean;
    /** Hidden provider-support authority. Not a tenant role/persona. */
    isPlatformAdmin?: boolean;
    /** Zitadel sub claim — stable user identifier across token refreshes.
     *  Used by the authz resolver as the user_id key for cache + scope lookups. */
    userId?: string;
    /** OIDC `name` claim — actor display name; falls back to username. */
    displayName?: string;
    /** True iff the JWT amr claim shows the token was minted via an MFA factor
     *  (otp, u2f/passkey, push). Used by authz statement conditions. */
    mfaPresent?: boolean;
    // FM-issued scoped PAT only. Absent for OIDC + Zitadel PATs.
    credentialId?: string;
    credentialPurpose?: string;
    credentialBoundary?: import('./modules/authz/types').Scope;
    // Surfaces this token is scoped to (e.g. 'mcp'). Empty = unrestricted.
    credentialAudience?: string[];
    // Pre-computed V2 shape. Set by short-lived single-use scoped tokens whose
    // grant is one fixed action — skips the resolver DB lookup.
    effectiveShape?: import('./modules/authz/types').EffectiveShape;
}

/** Who is acting: a human (`user`), an automation/API key (`service_user`),
 *  or an internal FM process (`system`). Used to tell humans from automations
 *  in slow-operation diagnostics. */
export type PrincipalType = 'user' | 'service_user' | 'system';

export interface PluginInfo {
    name: string;
    version: string;
    description: string;
    config?: {
        metadata?: boolean;
        menuItems: any[];
        /** Exact backend RPC methods this plugin may call from its worker. */
        rpcAllowlist?: string[];
        allowedRpcMethods?: string[];
    } & Record<string, any>;
}

export interface PluginData {
    location: string;
    info: PluginInfo;
}

/** A single leaf-level change discovered at the merge boundary. */
export interface PathChange {
    path: string;
    prev: unknown;
    next: unknown;
}

export type event_data_t = {
    device?: AbstractDevice;
    /** Source device for events that don't carry the full `device` object
     *  (entity/BTHome events). Dispatch scopes delivery by per-device access,
     *  same as `device` — without it such events fan out unscoped. */
    shellyID?: string;
    reason?: string | string[];
    /** Field-level changes for this event. Computed once at the merge
     *  boundary; carries previous + new value per path. Used by:
     *    - EventDistributor path filter (reads `.path`)
     *    - ShellyMessageHandler flush (reads `.prev` to write prev_value
     *      into the time-series row — no PG round-trip)
     *  Pattern adopted from OSIsoft PI's Snapshot Subsystem. */
    changes?: PathChange[];
    serialized?: string;
    /** Tenant the event belongs to. Set on non-device app-domain
     *  events (group/dashboard/location/tag/...) so notifyAll can
     *  filter listeners whose CommandSender belongs to a different
     *  org. Absent for device events (device → org lookup happens
     *  via deviceOrgByShellyId), system-wide notices, and trusted
     *  internal callbacks. */
    organizationId?: string;
};
export type shelly_presence_t = 'online' | 'offline' | 'pending';

export interface FleetManagerPlugin extends ReturnType<typeof require> {
    load?(properties?: any): void;
    on?(event: json_rpc_event, eventData?: event_data_t): void;
    unload?(): void;
    addMetadata?(
        event: json_rpc_event,
        additional: event_data_t
    ): any | Promise<any>;
}

export namespace ShellyEvent {
    export interface Basic extends json_rpc_event {
        method: string;
        params: {
            shellyID: string;
            metadata?: any;
        };
    }
    export interface Connect extends Basic {
        method: 'Shelly.Connect';
        params: {
            shellyID: string;
            device: ShellyDeviceExternal;
            /** ms epoch — backend emit time, used by frontend to compute end-to-end latency. */
            emittedAt?: number;
        };
    }
    export interface Disconnect extends Basic {
        method: 'Shelly.Disconnect';
        params: {
            shellyID: string;
            /** ms epoch — backend emit time. */
            emittedAt?: number;
        };
    }
    export interface Delete extends Basic {
        method: 'Shelly.Delete';
        params: {
            shellyID: string;
        };
    }
    export interface Info extends Basic {
        method: 'Shelly.Info';
        params: {
            shellyID: string;
            info: any;
        };
    }
    export interface Status extends Basic {
        method: 'Shelly.Status';
        params: {
            shellyID: string;
            status: any;
            partial?: boolean;
        };
    }
    export interface Settings extends Basic {
        method: 'Shelly.Settings';
        params: {
            shellyID: string;
            settings: any;
        };
    }
    export interface Message extends Basic {
        method: 'Shelly.Message';
        params: {
            shellyID: string;
            message: ShellyMessageIncoming;
            req: ShellyMessageData | undefined;
        };
    }
    export interface KVS extends Basic {
        method: 'Shelly.KVS';
        params: {
            shellyID: string;
            kvs: Record<string, string>;
        };
    }

    export interface Presence extends Basic {
        method: 'Shelly.Presence';
        params: {
            shellyID: string;
            presence: shelly_presence_t;
        };
    }
    export interface PresenceTrack extends Basic {
        method: 'Shelly.PresenceTrack';
        params: {
            shellyID: string;
            objects: Array<{
                id: number;
                x: number;
                y: number;
                z: number;
                minz: number;
                maxz: number;
            }>;
            ts: number;
        };
    }
    export interface OtaProgress extends Basic {
        method: 'Shelly.OtaProgress';
        params: {
            shellyID: string;
            event: 'ota_begin' | 'ota_progress' | 'ota_success' | 'ota_error';
            progress_percent?: number;
            msg?: string;
        };
    }
}

export namespace EntityEvent {
    export interface Basic extends json_rpc_event {
        method: string;
        params: {
            entityId: string;
        };
    }

    export interface Added extends Basic {
        method: 'Entity.Added';
        // Carry the full entity so the client never round-trips Entity.Get per
        // add — a snapshot/seed of N entities is 0 extra RPCs, not N.
        params: {
            entityId: string;
            entity: entity_t;
        };
    }

    export interface Removed extends Basic {
        method: 'Entity.Removed';
    }

    export interface Event extends Basic {
        method: 'Entity.Event';
        params: {
            entityId: string;
            event:
                | 'single_push'
                | 'double_push'
                | 'triple_push'
                | 'long_push'
                | 'long_double_push'
                | 'long_triple_push'
                | 'rotate_left'
                | 'rotate_right'
                | 'hold_press';
        };
    }
}

/**
 * BLE device model string — stable identifier resolved from shelly_mfdata.model_id,
 * or the raw local_name when model_id is unavailable.
 * Canonical list lives in backend/src/config/BTHomeData.ts (BLU_DEVICES).
 */
export type shelly_bthome_type_t = string;

export type shelly_bthome_result_t = {
    type: shelly_bthome_type_t;
    mac: string;
    shellyID: string;
};

export namespace BTHome {
    export interface DiscoveryResult extends json_rpc_event {
        method: 'BTHome.DiscoveryResult';
        params: {
            type: shelly_bthome_type_t;
            mac: string;
            shellyID: string;
            /** Human-readable product name resolved by backend */
            name: string;
            /** Human-readable product name resolved from the canonical BLU registry */
            productName?: string;
            /** Stable Shelly model string such as "SBBT-004CEU" */
            modelString?: string;
            /** True if this is a remote/button device that supports BTHomeControl learning */
            isRemote: boolean;
            /** Numeric model_id from shelly_mfdata 0x0B block, if available */
            modelId?: number;
            /** Raw BLE local_name reported by the gateway */
            localName?: string;
            /** Discovery RSSI when the gateway provides it */
            rssi?: number;
        };
    }

    export interface DiscoveryDone extends json_rpc_event {
        method: 'BTHome.DiscoveryDone';
        params: {
            shellyID: string;
            discoveredDevicesCount: number;
        };
    }

    export interface ControlLearning extends json_rpc_event {
        method: 'BTHome.ControlLearning';
        params: {
            shellyID: string;
            state: BTHomeLearningState | null;
        };
    }

    export interface ControlsUpdated extends json_rpc_event {
        method: 'BTHome.ControlsUpdated';
        params: {
            shellyID: string;
        };
    }
}

export interface BTHomeLearningState {
    inputId: number;
    stage: 'pairing' | 'press' | 'done' | 'remove' | 'error' | null;
    err: {code: number; msg: string | null} | null;
}

export interface BTHomeControlBinding {
    id: number;
    key: string;
    inputs: Array<{
        bthomedevice: string;
        obj_id: string;
        event: string;
        action: string;
    }>;
}

export namespace Console {
    export interface Log extends json_rpc_event {
        method: string;
        params: {
            coloredPart: string;
            log: string;
            color: string;
            category?: string;
        };
    }
}

// BEGIN: Entity

interface entity {
    name: string;
    id: string;
    type: string;
    source: string;
    properties: {id: number; errors?: string[]} & object;
}

export interface input_entity extends entity {
    type: 'input';
    properties: entity['properties'] & {
        type: 'button' | 'analog' | 'switch' | 'count';
        unit?: string;
    };
}

export interface switch_entity extends entity {
    type: 'switch';
    properties: entity['properties'] & {
        /** Thermostat id if this switch is wired as the thermostat actuator. */
        thermostatActuator?: number;
    };
}

export interface temperature_entity extends entity {
    type: 'temperature';
    properties: entity['properties'] & {
        embeddedIn?: string;
    };
}

export interface em1_entity extends entity {
    type: 'em1';
}

export interface em_entity extends entity {
    type: 'em';
}

export interface light_entity extends entity {
    type: 'light';
}

export interface rgb_entity extends entity {
    type: 'rgb';
}

export interface rgbw_entity extends entity {
    type: 'rgbw';
}

export interface bthomesensor_entity extends entity {
    type: 'bthomesensor';
    properties: entity['properties'] & {
        unit: string;
        sensorType?: string;
        objName?: string;
        /** BLE MAC address of the parent sensor device */
        addr?: string;
        /** Product name from bthomedevice config (e.g. "Shelly BLU H&T") */
        bleProductName?: string;
        /** Model ID from bthomedevice config (e.g. "SBHT-003C") */
        bleModelId?: string;
        /** Display name: user-set name or product name */
        bleDisplayName?: string;
        /** Parent bthomedevice component key (e.g. "bthomedevice:200") */
        parentDeviceKey?: string;
    };
}

export interface virtual_boolean_entity extends entity {
    type: 'boolean' | string;
    properties: entity['properties'] & {
        view: null | 'label' | 'toggle';
        labelTrue: string;
        labelFalse: string;
    };
}

export interface virtual_number_entity extends entity {
    type: 'number' | string;
    properties: entity['properties'] & {
        view: null | 'label' | 'field' | 'slider' | 'progressbar';
        unit: string;
        min: number;
        max: number;
        step: number;
    };
}

export interface virtual_text_entity extends entity {
    type: 'text' | string;
    properties: entity['properties'] & {
        view: null | 'label' | 'field' | 'image';
        maxLength: number;
    };
}

export interface virtual_enum_entity extends entity {
    type: 'enum' | string;
    properties: entity['properties'] & {
        view: null | 'label' | 'dropdown';
        options: Record<string, string>;
    };
}

export interface virtual_button_entity extends entity {
    type: 'button' | string;
    properties: entity['properties'] & {
        view: string;
    };
}

export interface virtual_group_entity extends entity {
    type: 'group';
    properties: entity['properties'] & {
        /** Component keys contained in this group (e.g. ["button:200", "enum:201"]) */
        members: string[];
    };
}

export type virtual_component_t =
    | virtual_boolean_entity
    | virtual_number_entity
    | virtual_text_entity
    | virtual_enum_entity
    | virtual_button_entity
    | virtual_group_entity;

export interface cover_entity extends entity {
    type: 'cover';
    properties: entity['properties'] & {
        favorites: number[];
    };
}

export interface pm1_entity extends entity {
    type: 'pm1';
}

export interface cury_entity extends entity {
    type: 'cury';
    properties: entity['properties'] & {
        mode?: string;
        awayMode?: boolean;
    };
}

export interface humidity_entity extends entity {
    type: 'humidity';
}

export interface voltmeter_entity extends entity {
    type: 'voltmeter';
}

export interface cct_entity extends entity {
    type: 'cct';
}

export interface rgbcct_entity extends entity {
    type: 'rgbcct';
}

export interface flood_entity extends entity {
    type: 'flood';
    properties: entity['properties'] & {
        alarm_mode: string;
        mute: boolean;
    };
}

export interface smoke_entity extends entity {
    type: 'smoke';
}

export interface devicepower_entity extends entity {
    type: 'devicepower';
}

export interface illuminance_entity extends entity {
    type: 'illuminance';
}

// Binary presence sensor (e.g. Wall Display occupancy:N). Live state is
// status.value (bool); config carries wake_screen.
export interface occupancy_entity extends entity {
    type: 'occupancy';
}

export interface thermostat_entity extends entity {
    type: 'thermostat';
}

export interface media_entity extends entity {
    type: 'media';
}

export interface ui_entity extends entity {
    type: 'ui';
}

export interface matter_entity extends entity {
    type: 'matter';
}

export interface camera_entity extends entity {
    type: 'camera';
}

export interface schedule_entity extends entity {
    type: 'schedule';
}

export interface presence_entity extends entity {
    type: 'presence';
}

export interface presencezone_entity extends entity {
    type: 'presencezone';
}

export interface camerazone_entity extends entity {
    type: 'camerazone';
}

export interface service_entity extends entity {
    type: 'service';
    properties: entity['properties'] & {
        /** Service type from jwt.xt1.svc0.type (e.g. "linkedgo-st-802-hvac") */
        serviceType: string;
        /** Backend-resolved card category — frontends must not regex serviceType */
        category: 'hvac' | 'valve' | 'ev_charger' | 'irrigation' | 'generic';
        /** Service component key (e.g. "service:0") */
        serviceKey: string;
        /** Product name from jwt.n (e.g. "Youth Smart Thermostat ST802") */
        productName: string;
        /** Resource role → full component key (e.g. "enable" → "boolean:201") */
        components: Record<string, string>;
    };
}

export interface bthomedevice_entity extends entity {
    type: 'bthomedevice';
    properties: entity['properties'] & {
        addr: string;
        productName: string;
        modelId: string;
        paired: boolean;
        /** Backend-supplied control objects discovered from BTHomeDevice.GetKnownObjects.
         *  Frontend should render using `kind` and `label` — do not hardcode objId→kind mapping. */
        controls: Array<{
            objId: number;
            idx: number;
            kind: 'button' | 'dimmer';
            label: string;
        }>;
        /** Entity IDs of child bthomesensor entities */
        childSensorIds: string[];
        /** BTHome obj_ids that are device-level events (button, dimmer) — not addable as sensors */
        eventObjIds: number[];
        /** Errors from BTHomeDevice status: key_missing_or_bad, decrypt_failed, parse_failed, unencrypted_data */
        errors: string[];
    };
}

export interface bthomecontrol_entity extends entity {
    type: 'bthomecontrol';
    properties: entity['properties'] & {
        addr?: string;
    };
}

export interface blutrv_entity extends entity {
    type: 'blutrv';
    properties: entity['properties'] & {
        addr: string;
        /** Shelly ID of the gateway this TRV is attached to */
        gatewayId: string;
        /** BLE link state (device status.connected) */
        connected: boolean;
        /** Target temperature in °C (device status.target_C) */
        target_C: number | null;
        /** Measured room temperature in °C (device status.current_C) */
        current_C: number | null;
        /** Valve position 0-100 (device status.pos). Heating = pos > 0. */
        pos: number | null;
        /** Battery level 0-100 (device status.battery) */
        battery: number | null;
        /** BLE signal strength dBm (device status.rssi) */
        rssi: number | null;
        /** Unix timestamp of last broadcast (device status.last_updated_ts) */
        lastUpdatedTs: number | null;
    };
}

export type BareEntity<T extends string> = entity & {type: T};

export type bm_entity = BareEntity<'bm'>;
export interface cb_entity extends entity {
    type: 'cb';
    properties: entity['properties'] & {
        /** Protection thresholds surfaced from CB.GetConfig (volts). */
        undervoltageLimit?: number;
        voltageLimit?: number;
        /** Hysteresis band around the limits; drives the near-limit warning. */
        voltageThr?: number;
        /** Pole count (voltmeter components), fixed from the full device. */
        poles?: number;
    };
}
export type fan_entity = BareEntity<'fan'>;
export type lnm_entity = BareEntity<'lnm'>;
export type zigbee_entity = BareEntity<'zigbee'>;
export type pill_entity = BareEntity<'pill'>;
export type dali_entity = BareEntity<'dali'>;
export type modbus_entity = BareEntity<'modbus'>;
export type object_entity = BareEntity<'object'>;
export type script_entity = BareEntity<'script'>;
export type emdata_entity = BareEntity<'emdata'>;
export type em1data_entity = BareEntity<'em1data'>;

export type entity_t =
    | input_entity
    | switch_entity
    | temperature_entity
    | em1_entity
    | em_entity
    | light_entity
    | bthomesensor_entity
    | virtual_component_t
    | rgb_entity
    | rgbw_entity
    | cover_entity
    | pm1_entity
    | cury_entity
    | humidity_entity
    | voltmeter_entity
    | cct_entity
    | rgbcct_entity
    | flood_entity
    | smoke_entity
    | devicepower_entity
    | illuminance_entity
    | occupancy_entity
    | thermostat_entity
    | media_entity
    | ui_entity
    | matter_entity
    | camera_entity
    | schedule_entity
    | presence_entity
    | presencezone_entity
    | camerazone_entity
    | service_entity
    | bthomedevice_entity
    | bthomecontrol_entity
    | blutrv_entity
    | bm_entity
    | cb_entity
    | fan_entity
    | lnm_entity
    | zigbee_entity
    | pill_entity
    | dali_entity
    | modbus_entity
    | object_entity
    | script_entity
    | emdata_entity
    | em1data_entity;

// END: Entity

export interface Context {
    name: string;
    kind: string;
    static: boolean;
    private: boolean;
    metadata: Record<PropertyKey, any>;
}

declare module 'express-serve-static-core' {
    interface Request {
        token?: string;
        user?: user_t;
    }
}

export interface Sendable {
    send(data: string): void;
}

declare module 'ws' {
    export interface WebSocket extends ws {
        isAlive: boolean;
        missedPongs?: number;
        __rpcTransport?: {pendingRpcCount: number};
    }
}

export namespace WaitingRoomEvent {
    export interface Basic extends json_rpc_event {
        method: string;
        params: {
            id: number;
        };
    }

    export interface Accepted extends Basic {
        method: 'WaitingRoomEvent.Accepted';
        params: {
            id: number;
        };
    }

    export interface Denied extends Basic {
        method: 'WaitingRoomEvent.Denied';
        params: {
            id: number;
        };
    }
}
