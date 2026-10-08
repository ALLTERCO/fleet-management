// Single home for device capability derivation: the RPC-derived base
// (Shelly.ListMethods) plus wire enrichment computed from what the device
// announces — advertised methods and reported components/config. No
// app/model-name rules anywhere; the frontend renders what we send.

import type {DeviceCapabilities, DeviceUiCapabilities} from '../types';

/**
 * Derive a compact capabilities object from the raw Shelly.ListMethods array.
 * Only the booleans travel to the frontend — not the full 70+ method list.
 */
export function deriveCapabilities(methods: string[]): DeviceCapabilities {
    const set = new Set(methods);
    return {
        backup:
            set.has('Sys.CreateBackup') &&
            set.has('Sys.DownloadBackup') &&
            set.has('Sys.RestoreBackup'),
        firmwareUpdate: set.has('Shelly.Update'),
        firmwareCheck: set.has('Shelly.CheckForUpdate'),
        otaCommit: set.has('OTA.Commit') && set.has('OTA.Revert'),
        matter: set.has('Matter.GetConfig'),
        tlsUserCA: set.has('Shelly.PutUserCA'),
        tlsClientCert:
            set.has('Shelly.PutTLSClientCert') &&
            set.has('Shelly.PutTLSClientKey'),
        xmod: set.has('XMOD.GetInfo'),
        // Pre-market IR Controller (app IRG4): the advertised IR namespace is
        // the capability signal; IRDevice/IRCode ride along with it.
        ir: set.has('IR.GetConfig'),
        service: set.has('Service.GetResources'),
        serviceResetCounters: set.has('Service.ResetCounters'),
        virtualComponents: set.has('Virtual.Add') && set.has('Virtual.Delete')
    };
}

// Single home for Wall Display identity. No advertised RPC uniquely marks the
// relay/thermostat mode switch, so app/model is the only reliable signal —
// the entity composer keys its Wall Display logic off this same check.
export function isWallDisplayInfo(info: {
    app?: string;
    model?: string;
}): boolean {
    // app is 'WallDisplay' or 'WallDisplayV2' across firmwares; model is SAWD-*.
    return (
        info?.app === 'WallDisplay' ||
        info?.app === 'WallDisplayV2' ||
        (typeof info?.model === 'string' && info.model.startsWith('SAWD'))
    );
}

export function versionAtLeast(
    version: unknown,
    requiredMajor: number,
    requiredMinor: number
): boolean {
    if (typeof version !== 'string') return false;
    const [major, minor] = version
        .split('.')
        .map((z: string) => Number.parseInt(z, 10));
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
    return (
        major > requiredMajor ||
        (major === requiredMajor && minor >= requiredMinor)
    );
}

// The FM restore flow sends exactly these RPCs to the target device:
// Sys.RestoreBackup (chunk stream + apply, BackupComponent
// #raceRestoreChunkSend) and Shelly.GetDeviceInfo (post-reboot confirm
// probe, #confirmRestoreApplied). The device's advertised method list is
// the source of truth — no firmware-version guessing.
const RESTORE_FLOW_METHODS: readonly string[] = [
    'Sys.RestoreBackup',
    'Shelly.GetDeviceInfo'
];

// Advertised addon-service RPC namespace → sys.device.addon_type value.
// Namespaces per docs/Addons/: SensorAddon + ProSensorAddon both enable
// the 'sensor' board; ProOutputAddon → 'prooutput'; LoRa → 'LoRa'; the
// RS485 addon exposes the Serial component → 'rs485'.
const ADDON_NAMESPACE_TO_OPTION: ReadonlyArray<
    readonly [prefix: string, option: string]
> = [
    ['SensorAddon.', 'sensor'],
    ['ProSensorAddon.', 'sensor'],
    ['ProOutputAddon.', 'prooutput'],
    ['LoRa.', 'LoRa'],
    ['Serial.', 'rs485']
];

interface EnrichCapabilitiesInput {
    base: DeviceCapabilities;
    info: {app?: string; model?: string};
    status: Record<string, unknown>;
    config: Record<string, unknown>;
    methods: string[];
}

/**
 * Wire view of a device's capabilities: the RPC-derived base plus fields
 * computed from status/config/methods. Derived fields are always recomputed
 * here so stale persisted snapshots can never mask current device state.
 */
export function enrichCapabilities(
    input: EnrichCapabilitiesInput
): DeviceCapabilities {
    const {base, info, status, config, methods} = input;
    return {
        ...base,
        restore: hasRestoreMethods(methods),
        addons: advertisedAddons(methods, config),
        ui: deriveUiCapabilities({info, status, config, methods})
    };
}

function hasRestoreMethods(methods: string[]): boolean {
    const set = new Set(methods);
    return RESTORE_FLOW_METHODS.every((m) => set.has(m));
}

function advertisedAddons(
    methods: string[],
    config: Record<string, unknown>
): string[] {
    if (!hasAddonSlot(config)) return [];
    const out: string[] = [];
    for (const [prefix, option] of ADDON_NAMESPACE_TO_OPTION) {
        if (out.includes(option)) continue;
        if (methods.some((m) => m.startsWith(prefix))) out.push(option);
    }
    return out;
}

// Addon-capable devices always expose sys.device.addon_type (null when
// unconfigured); devices without an addon slot omit the key entirely.
function hasAddonSlot(config: Record<string, unknown>): boolean {
    const sys = config.sys as {device?: unknown} | undefined;
    const device = sys?.device;
    return (
        device !== null &&
        typeof device === 'object' &&
        'addon_type' in (device as Record<string, unknown>)
    );
}

function deriveUiCapabilities(input: {
    info: {app?: string; model?: string};
    status: Record<string, unknown>;
    config: Record<string, unknown>;
    methods: string[];
}): DeviceUiCapabilities {
    return {
        // The pin-mode UI writes Pill.SetConfig — require it advertised.
        pillPinMode: input.methods.includes('Pill.SetConfig'),
        // Advertised PillUart namespace proves the uart mode exists.
        pillUartMode: input.methods.includes('PillUart.GetConfig'),
        // The one assembled pill mode list — every entry proven by the device.
        pillModes: derivePillModes(input),
        // Cury devices report cury:N components (same signal composeCury uses).
        cury: hasComponent(input.status, 'cury'),
        ledSettings: hasLedUiComponent(input.config),
        wallDisplay: isWallDisplayInfo(input.info)
    };
}

// Every Pill firmware hardcodes these five modes as its baseline.
const PILL_PRODUCTION_MODES = [
    'onewire',
    'dht22',
    'analog_in',
    'ssr',
    'digital_io'
];

/**
 * Single home for the pill mode list the UI renders. Sources, all from the
 * device: its own enumeration when the firmware provides one; otherwise the
 * documented baseline plus modes proven by the advertised method table, a
 * live component, or the current config. Absent on non-Pill devices.
 */
function derivePillModes(input: {
    status: Record<string, unknown>;
    config: Record<string, unknown>;
    methods: string[];
}): string[] | undefined {
    if (!input.methods.includes('Pill.GetConfig')) return undefined;
    const pill = input.config['pill:0'] as
        | {mode?: unknown; _attrs?: Record<string, unknown>}
        | undefined;
    const enumerated = extractEnumeratedModes(pill?._attrs);
    const modes = enumerated ?? [...PILL_PRODUCTION_MODES];
    if (!enumerated) {
        if (input.methods.includes('PillUart.GetConfig'))
            pushUnique(modes, 'uart');
        if (hasComponent(input.status, 'pilluart')) pushUnique(modes, 'uart');
        if (hasComponent(input.status, 'ledstrip'))
            pushUnique(modes, 'ledstrip');
    }
    if (typeof pill?.mode === 'string') pushUnique(modes, pill.mode);
    return modes;
}

// The enumeration's attrs field name is undocumented; accept the shapes seen
// in the wild (modes / mode_options) until firmware docs pin one.
function extractEnumeratedModes(
    attrs: Record<string, unknown> | undefined
): string[] | undefined {
    if (!attrs || typeof attrs !== 'object') return undefined;
    for (const field of ['modes', 'mode_options']) {
        const candidate = attrs[field];
        if (
            Array.isArray(candidate) &&
            candidate.length > 0 &&
            candidate.every((v) => typeof v === 'string')
        ) {
            return [...candidate];
        }
    }
    return undefined;
}

function pushUnique(list: string[], value: string): void {
    if (!list.includes(value)) list.push(value);
}

function hasComponent(status: Record<string, unknown>, type: string): boolean {
    for (const key of Object.keys(status)) {
        if (key === type || key.startsWith(`${type}:`)) return true;
    }
    return false;
}

// LED settings ride a device-family `<family>_ui` component
// (powerstrip_ui, plugs_ui, pluguk_ui, plugpm_ui today). Detect the key
// suffix structurally; `:N`-normalized keys (plugs_ui:0) match too.
function hasLedUiComponent(config: Record<string, unknown>): boolean {
    for (const key of Object.keys(config)) {
        const baseKey = key.split(':')[0];
        if (!baseKey.endsWith('_ui')) continue;
        const value = config[key];
        if (value !== null && typeof value === 'object') return true;
    }
    return false;
}
