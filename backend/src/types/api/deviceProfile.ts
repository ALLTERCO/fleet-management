// What a device IS, as a caller receives it. The one declaration of the shape.
//
// Lives here, not beside the builder in `model/`, so the frontend and the host
// SDK reach it through @api/*. The SDK typed `profile` as `unknown` because it
// had nowhere to import this from, which left the last untyped field on
// HostDevice — a template could read it and had to guess every key.
//
// The builder and its ReadonlySet stay in model/deviceProfile; only the wire
// shape belongs to both tiers.

import type {DeviceCapabilities} from './deviceCapabilities';

// Only meaningful when device.list.kind === 'physical'.
// shelly_powered intentionally absent — no runtime signal to detect it
// today; add union + classifier branch together when one exists.
// xt1.service: null (not 'unknown') when app has no +<service> suffix.
export type DeviceTribe =
    | {kind: 'shelly_native'; app: string; gen: number}
    | {kind: 'xmod'; jti: string}
    | {kind: 'xt1'; jti: string; service: string | null};

// Presence of `addon` IS the boolean — null when no addon. Single SoT.
export interface DeviceProfileFlags {
    isBattery: boolean;
    isBluGateway: boolean;
    hasMediaUi: boolean;
    hasBluTrv: boolean;
    addon: {type: string} | null;
    hostsServiceUnit: boolean;
    hostsVirtualComponents: boolean;
    supportsZigbee: boolean;
    supportsMatter: boolean;
}

/**
 * What Fleet Manager worked out about the device, as it goes over the wire.
 *
 * Named `derived` because Shelly already owns the word `profile`: on
 * GetDeviceInfo it is a string naming the operating mode of a multi-profile
 * device ('switch' or 'cover' on a Plus2PM), and it reaches callers as
 * `info.profile`. Two unrelated things on one object cannot share a name.
 *
 * This one is nobody's report of itself — it is FM reading the device's
 * components and drawing a conclusion. If the conclusion is wrong, the
 * device's own words are still in `info` and `status`.
 *
 * `componentTypes` is an array here and a Set internally. A Set serializes to
 * `{}`, so a template reading it got an empty object until that was fixed.
 */
export interface DerivedDeviceProfile {
    tribe: DeviceTribe;
    componentTypes: readonly string[];
    rpcCapabilities: DeviceCapabilities;
    flags: DeviceProfileFlags;
    builtAtMs: number;
}
