export type presence = 'online' | 'offline' | 'pending';

export interface DeviceStatus {
    sys?: {
        sleep?: {wakeup_period?: number};
        available_updates?: any;
        [key: string]: any;
    };
    wifi?: {rssi?: number; sta_ip?: string; ssid?: string; [key: string]: any};
    'devicepower:0'?: {
        battery?: {percent?: number; voltage?: number; [key: string]: any};
        [key: string]: any;
    };
    [key: string]: any;
}

export interface DeviceSettings {
    [key: string]: any;
}

/** Device-specific UI surfaces, derived by the backend. Mostly from what the
 *  device announces; `wallDisplay` is the one app/model-based flag (no RPC
 *  marks the relay/thermostat mode switch). */
export interface DeviceUiCapabilities {
    /** Device advertises Pill.SetConfig — pin-mode configuration UI */
    pillPinMode: boolean;
    /** Device reports a cury:N component in status */
    cury: boolean;
    /** LED settings via a device-reported `*_ui` component (plugs_ui, …) */
    ledSettings: boolean;
    /** Wall Display — shows the relay↔thermostat mode switch */
    wallDisplay: boolean;
}

export interface DeviceCapabilities {
    backup?: boolean;
    /** Device advertises the RPCs the FM restore flow sends */
    restore?: boolean;
    firmwareUpdate?: boolean;
    firmwareCheck?: boolean;
    otaCommit?: boolean;
    matter?: boolean;
    /** Device has XMOD — Powered by Shelly (XMOD1 or XT1) */
    xmod?: boolean;
    /** Device has Service component — XT1 with service module (HVAC, irrigation, etc.) */
    service?: boolean;
    /** Device supports Service.ResetCounters */
    serviceResetCounters?: boolean;
    /** Device supports user-created virtual components (Virtual.Add/Delete) */
    virtualComponents?: boolean;
    /** Addon services the device advertises, as sys.device.addon_type values */
    addons?: string[];
    /** Device-specific UI feature flags */
    ui?: DeviceUiCapabilities;
    tlsUserCA?: boolean;
    tlsClientCert?: boolean;
}

export interface shelly_device_t {
    id: number;
    shellyID: string;
    /** Backend identity classification — drives logo + card variant resolution. */
    source?: 'shelly' | 'virtual' | 'bluetooth';
    status: DeviceStatus;
    settings: DeviceSettings;
    info: any;
    online: boolean;
    /** Device is within its wakeup window but not actively connected */
    sleeping: boolean;
    loading: boolean;
    selected: boolean;
    entities: string[];
    capabilities: DeviceCapabilities;
    meta: any;
    methods: string[];
    groupIds?: number[];
    locationId?: number | null;
    tagIds?: number[];
}

export interface ShellyDeviceExternal {
    id: number;
    presence: presence;
    shellyID: string;
    source: string;
    info: any;
    status: DeviceStatus;
    _statusTs: number | undefined;
    settings: DeviceSettings;
    _settingsTs: number | undefined;
    selected: boolean;
    kvs: Record<string, string>;
    entities: string[];
    capabilities: DeviceCapabilities;
    meta: any;
    methods: string[];
    groupIds?: number[];
    locationId?: number | null;
    tagIds?: number[];
}

export interface shelly_device {
    mac: string;
    selected: boolean;
    status?: any;
    setting?: any;
}
