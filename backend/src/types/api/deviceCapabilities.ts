// What a device supports doing. The one place these are declared.
//
// Lives here, not in `types.ts`, so the frontend and the host SDK reach it
// through @api/*. The SDK's own `DeviceCapabilities` is a different idea —
// what a device MEASURES. Two ideas, two homes, neither guessing.

/** Device-specific UI surfaces, derived from what the device announces
 *  (components/methods). Exception: `wallDisplay` — no advertised RPC marks
 *  the relay/thermostat mode switch, so it keys off app/model like the
 *  backend's entity composer already does. */
export interface DeviceUiCapabilities {
    /** Device advertises Pill.SetConfig — pin-mode configuration UI */
    pillPinMode: boolean;
    /** Device advertises PillUart.GetConfig — firmware has the uart mode */
    pillUartMode: boolean;
    /** Pill modes the device enumerated at discovery (newer firmware) */
    pillModes?: string[];
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
    /** Device advertises the IR namespace (IR.GetConfig) — IR Controller */
    ir?: boolean;
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
